import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, rename, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type {
  CapabilityRequest,
  CapabilityResult,
  ExtensionCapabilityRegistry,
  Logger,
  ProviderAvailability,
  ProviderConfig,
} from "@photoshop-mcp/photoshop-bridge";
import {
  CapabilityConfigSchema,
  ErrorCode,
  FilenameSchema,
  PhotoshopMcpError,
  assertConfigConsistent,
  buildArgs,
} from "@photoshop-mcp/photoshop-bridge";

import { convertFitsToTiff } from "./fits.js";

/**
 * Capability Registry. (ARCHITECTURE §19, ROADMAP §12)
 *
 * Extension 은 특정 프로그램이 아니라 기능을 요청한다.
 *
 * ## 이 계층이 지키는 것
 *
 * - 실행 파일 경로는 **설정에서만** 온다. 호출자가 정할 수 없다.
 * - 인자는 Provider 정의가 검증된 파라미터로 조립한다. (ARCHITECTURE §23.2 와 같은 원칙)
 * - `shell: false` 로 실행한다. 인자 배열이 그대로 전달되므로 shell 주입이 없다.
 * - 입출력은 **승인된 작업 폴더 안의 파일 이름**으로만 지정한다. (ROADMAP §8.5)
 *   경로를 받으면 external 권한이 임의 파일 읽기·쓰기로 넓어진다.
 *
 * ## 아직 없는 것
 *
 * 동기 실행만 한다. 진행률 보고와 취소는 Job System(Phase 10) 이다.
 * `timeoutMs` 로 무한정 매달리는 것만 막는다.
 */

/** 승인된 작업 폴더 경로를 알아내는 함수. 없으면 `null`. */
export type WorkspaceResolver = () => Promise<string | null>;

export interface CapabilityRegistryOptions {
  logger: Logger;
  /**
   * 입출력 파일을 가둘 폴더를 알아낸다.
   *
   * Photoshop 플러그인의 `WORKSPACE_STATUS` 를 호출하도록 조립 시점에 주입한다.
   * 레지스트리가 Bridge 를 직접 알면 계층이 섞인다.
   */
  resolveWorkspace: WorkspaceResolver;
  /** 프로세스 실행기. 테스트에서 교체한다. */
  runner?: ProcessRunner;
}

/** 프로세스 실행 결과. */
export interface ProcessOutcome {
  code: number | null;
  /** 진단용. 성공해도 경고가 담길 수 있다. */
  stderr: string;
  stdout: string;
  timedOut: boolean;
  /** 취소 신호로 죽였는지. */
  cancelled?: boolean;
}

export type ProcessRunner = (
  executable: string,
  args: readonly string[],
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<ProcessOutcome>;

/** 기본 실행기. shell 을 쓰지 않는다. */
export const spawnRunner: ProcessRunner = (executable, args, options) =>
  new Promise<ProcessOutcome>((resolvePromise) => {
    // shell: false 가 기본이다. 명시해서 의도를 남긴다.
    const child = spawn(executable, [...args], { shell: false, windowsHide: true });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;

    // 취소 신호가 오면 실제로 프로세스를 죽인다. 신호만 받고 계속 돌면
    // 취소가 거짓말이 된다 — 상태는 cancelled 인데 CPU 는 계속 먹는다.
    const onAbort = (): void => {
      cancelled = true;
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    // 출력이 무한정 쌓이지 않도록 자른다. 진단에는 앞부분이면 충분하다.
    const LIMIT = 64 * 1024;
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < LIMIT) {
        stdout += chunk.toString("utf8");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < LIMIT) {
        stderr += chunk.toString("utf8");
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);

    const finish = (outcome: ProcessOutcome): void => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolvePromise(outcome);
    };

    child.once("error", (error) => {
      finish({ code: null, stdout, stderr: `${stderr}${String(error)}`, timedOut, cancelled });
    });
    child.once("close", (code) => {
      finish({ code, stdout, stderr, timedOut, cancelled });
    });
  });

export class CapabilityRegistry implements ExtensionCapabilityRegistry {
  readonly #providers = new Map<string, ProviderConfig>();
  readonly #logger: Logger;
  readonly #resolveWorkspace: WorkspaceResolver;
  readonly #runner: ProcessRunner;

  constructor(options: CapabilityRegistryOptions) {
    this.#logger = options.logger;
    this.#resolveWorkspace = options.resolveWorkspace;
    this.#runner = options.runner ?? spawnRunner;
  }

  /**
   * Provider 를 등록한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `INVALID_PARAMETER` — args 가 선언되지 않은 자리표시자를 쓰는 등 설정 오류
   *   - `DUPLICATE_COMMAND` — 같은 id 가 이미 등록됨
   */
  register(config: ProviderConfig): void {
    if (this.#providers.has(config.id)) {
      throw new PhotoshopMcpError(
        ErrorCode.DUPLICATE_COMMAND,
        `이미 등록된 Provider 입니다: ${config.id}`,
        { details: { provider: config.id } },
      );
    }
    // 설정 오류는 실행 시점이 아니라 등록 시점에 잡는다.
    assertConfigConsistent(config);
    this.#providers.set(config.id, config);
  }

  /**
   * 설정 파일을 읽어 등록한다.
   *
   * 파일이 없으면 조용히 넘어간다 — 외부 처리기가 없는 것은 정상이다.
   * 하나가 잘못되어도 나머지는 등록하고 서버는 계속 뜬다.
   *
   * @returns 등록된 Provider 수.
   */
  async loadConfig(path: string): Promise<number> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      this.#logger.debug(`Capability 설정이 없습니다: ${path}`);
      return 0;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.#logger.error(
        `Capability 설정이 올바른 JSON 이 아닙니다: ${path}`,
        error instanceof Error ? error.message : String(error),
      );
      return 0;
    }

    const result = CapabilityConfigSchema.safeParse(parsed);
    if (!result.success) {
      this.#logger.error(
        `Capability 설정이 스키마를 만족하지 않습니다: ${path}`,
        result.error.issues,
      );
      return 0;
    }

    let registered = 0;
    for (const provider of result.data.providers) {
      try {
        this.register(provider);
        registered += 1;
      } catch (error) {
        this.#logger.error(
          `Provider 등록 실패: ${provider.id}`,
          PhotoshopMcpError.from(error).toJSON(),
        );
      }
    }
    if (registered > 0) {
      this.#logger.info(`Capability Provider ${registered}개 등록: ${path}`);
    }
    return registered;
  }

  /** 등록된 Provider 가 있는 Capability 이름. */
  list(): string[] {
    return [...new Set([...this.#providers.values()].map((p) => p.capability))].sort();
  }

  has(capability: string): boolean {
    return [...this.#providers.values()].some((p) => p.capability === capability);
  }

  get size(): number {
    return this.#providers.size;
  }

  /**
   * Provider 상태.
   *
   * 사용할 수 없으면 **이유를 함께 준다.** 무엇이 왜 안 되는지 알 수 없으면
   * 사용자가 고칠 수 없다.
   */
  describe(capability?: string): ProviderAvailability[] {
    const configs = [...this.#providers.values()]
      .filter((p) => capability === undefined || p.capability === capability)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return configs.map((config) => ({
      id: config.id,
      capability: config.capability,
      label: config.label ?? config.id,
      // 동기 메서드라 파일 확인을 하지 않는다. 확인이 필요하면 describeAsync 를 쓴다.
      available: true,
      reason: null,
      executable: config.executable,
      priority: config.priority ?? 0,
      parameters: Object.keys(config.params ?? {}),
      extraOutputs: Object.keys(config.outputs ?? {}),
    }));
  }

  /** 실행 파일 존재까지 확인한 Provider 상태. */
  async describeAsync(capability?: string): Promise<ProviderAvailability[]> {
    return Promise.all(
      this.describe(capability).map(async (entry) => {
        const reason = await executableProblem(entry.executable);
        return { ...entry, available: reason === null, reason };
      }),
    );
  }

  /**
   * Capability 를 실행한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `COMMAND_NOT_SUPPORTED` — 그 Capability 의 Provider 가 없음
   *   - `WORKSPACE_NOT_APPROVED` — 작업 폴더가 승인되지 않음
   *   - `INVALID_PARAMETER` — 파일 이름이나 파라미터가 올바르지 않음
   *   - `COMMAND_FAILED` — 프로세스가 0 이 아닌 코드로 끝남
   *   - `COMMAND_TIMEOUT` — 제한 시간 초과
   */
  async execute(
    capability: string,
    request: CapabilityRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<CapabilityResult> {
    const config = this.#select(capability, request.provider);

    const problem = await executableProblem(config.executable);
    if (problem !== null) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `Provider '${config.id}' 를 실행할 수 없습니다: ${problem}`,
        { details: { provider: config.id, executable: config.executable, reason: problem } },
      );
    }

    const folder = await this.#requireWorkspace();
    const inputPath = resolveInside(folder, request.input, "input");

    // 주 출력과 추가 출력을 함께 해석한다. 전부 승인된 폴더 안이어야 한다.
    const outputPaths: Record<string, string> = {
      output: resolveInside(folder, request.output, "output"),
    };
    for (const [name, filename] of Object.entries(request.outputs ?? {})) {
      outputPaths[name] = resolveInside(folder, filename, `outputs.${name}`);
    }

    // 선언하지 않은 추가 출력을 조용히 무시하지 않는다. 오타를 알아야 한다.
    const declaredOutputs = new Set(Object.keys(config.outputs ?? {}));
    const undeclared = Object.keys(request.outputs ?? {}).filter(
      (name) => !declaredOutputs.has(name),
    );
    if (undeclared.length > 0) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        `Provider '${config.id}' 가 만들지 않는 출력입니다: ${undeclared.join(", ")}. ` +
          `만드는 것: ${[...declaredOutputs].join(", ") || "(주 출력뿐)"}`,
        { details: { provider: config.id, undeclared, declared: [...declaredOutputs] } },
      );
    }

    await assertReadable(inputPath, request.input);

    const args = buildArgs({
      config,
      inputPath,
      outputPaths,
      ...(request.params === undefined ? {} : { params: request.params }),
    });
    const timeoutMs = config.timeoutMs ?? 10 * 60 * 1000;

    this.#logger.info(`Capability 실행: ${capability} via ${config.id}`);
    const started = Date.now();
    const outcome = await this.#runner(config.executable, args, {
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    const durationMs = Date.now() - started;

    if (outcome.cancelled === true) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_FAILED,
        `Provider '${config.id}' 실행이 취소되었습니다.`,
        { recoverable: true, details: { provider: config.id, cancelled: true } },
      );
    }

    if (outcome.timedOut) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_TIMEOUT,
        `Provider '${config.id}' 가 ${Math.round(timeoutMs / 1000)}초 안에 끝나지 않았습니다.`,
        { details: { provider: config.id, timeoutMs, stderr: tail(outcome.stderr) } },
      );
    }

    if (outcome.code !== 0) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_FAILED,
        `Provider '${config.id}' 가 실패했습니다 (종료 코드 ${outcome.code ?? "없음"}).`,
        {
          details: {
            provider: config.id,
            exitCode: outcome.code,
            stderr: tail(outcome.stderr),
            stdout: tail(outcome.stdout),
          },
        },
      );
    }

    const names: Record<string, string> = { output: request.output, ...(request.outputs ?? {}) };

    // 처리기가 다른 이름·형식으로 만들었으면 요청한 것으로 맞춘다.
    //
    // GraXpert 3.0.2 는 `-output out.tif` 를 줘도 `out.tif.fits` 를 만든다. 출력 형식
    // 옵션이 없어 호출 쪽에서 우회할 수 없다. 그리고 Photoshop 은 FITS 를 못 읽는다.
    // 그래서 이 보정을 Provider 선언으로 표현한다 — 처리기마다 다른 버릇을 Command 나
    // Workflow 가 알게 하지 않기 위해서다.
    const converted: Record<string, string> = {};
    if (config.outputSuffix !== undefined || config.convert !== undefined) {
      for (const [key, path] of Object.entries(outputPaths)) {
        const actual = `${path}${config.outputSuffix ?? ""}`;
        const label = `${names[key] ?? key}${config.outputSuffix ?? ""}`;
        await assertReadable(
          actual,
          label,
          `Provider '${config.id}' 가 성공했다고 보고했지만 출력 파일이 없습니다`,
        );

        if (config.convert === "fitsToTiff") {
          const info = await convertFitsToTiff(actual, path);
          converted[key] = `${info.width}x${info.height} ${info.normalization.mode}`;
          this.#logger.info(`FITS → TIFF: ${label} → ${names[key] ?? key} (${converted[key]})`);
        } else if (actual !== path) {
          await rename(actual, path);
        }

        // 중간 파일은 지운다. 남기면 작업 폴더가 쓰지 못할 파일로 찬다 —
        // 실기에서 실패한 실행이 남긴 파일이 1.7GB 까지 쌓인 적이 있다.
        if (actual !== path) {
          await rm(actual, { force: true });
        }
      }
    }

    // 종료 코드가 0 이어도 출력이 없으면 실패다. 다음 단계가 없는 파일을 읽게 두지 않는다.
    // 추가 출력도 함께 확인한다 — 하나만 만들어지고 끝나는 경우가 있다.
    for (const [key, path] of Object.entries(outputPaths)) {
      await assertReadable(
        path,
        names[key] ?? key,
        `Provider '${config.id}' 가 성공했다고 보고했지만 출력 파일이 없습니다`,
      );
    }

    return {
      capability,
      provider: config.id,
      outputPath: outputPaths["output"] as string,
      outputPaths,
      durationMs,
      ...(Object.keys(converted).length === 0 ? {} : { converted }),
    };
  }

  // -------------------------------------------------------------------------

  /** 우선순위가 가장 높은 Provider. `preferred` 를 주면 그것만 찾는다. */
  #select(capability: string, preferred?: string): ProviderConfig {
    const candidates = [...this.#providers.values()]
      .filter((p) => p.capability === capability)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    if (candidates.length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `'${capability}' 를 제공하는 Provider 가 없습니다. 사용 가능: ${this.list().join(", ") || "(없음)"}`,
        { details: { capability, available: this.list() } },
      );
    }

    if (preferred === undefined) {
      return candidates[0] as ProviderConfig;
    }

    const chosen = candidates.find((p) => p.id === preferred);
    if (chosen === undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `Provider '${preferred}' 는 '${capability}' 를 제공하지 않습니다. ` +
          `제공하는 것: ${candidates.map((p) => p.id).join(", ")}`,
        { details: { capability, requested: preferred, available: candidates.map((p) => p.id) } },
      );
    }
    return chosen;
  }

  async #requireWorkspace(): Promise<string> {
    const folder = await this.#resolveWorkspace();
    if (folder === null || folder.length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.WORKSPACE_NOT_APPROVED,
        "외부 처리기의 입출력은 승인된 작업 폴더 안에서만 가능합니다. " +
          "Photoshop 의 'Photoshop MCP' 패널에서 폴더를 승인해 주세요.",
        { recoverable: true },
      );
    }
    return folder;
  }
}

/** 승인된 폴더 안의 경로로 만든다. 파일 이름만 받는다. */
function resolveInside(folder: string, filename: string, field: string): string {
  const parsed = FilenameSchema.safeParse(filename);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `${field} 는 승인된 폴더 안의 파일 이름이어야 합니다: ${filename}`,
      { details: { field, filename, issues: parsed.error.issues } },
    );
  }

  const full = join(folder, parsed.data);
  // 스키마가 이미 막지만 한 겹 더 확인한다. 이 성질이 깨지면 external 권한이
  // 임의 파일 접근으로 넓어진다.
  const base = resolve(folder);
  if (!isAbsolute(full) || !resolve(full).startsWith(base)) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `${field} 가 승인된 폴더를 벗어납니다: ${filename}`,
      { details: { field, filename, folder } },
    );
  }
  return full;
}

/** 실행할 수 없는 이유. 실행 가능하면 `null`. */
async function executableProblem(executable: string): Promise<string | null> {
  if (!isAbsolute(executable)) {
    // 상대 경로는 서버의 작업 디렉터리에 따라 달라진다. 설정에 절대 경로를 요구한다.
    return "실행 파일은 절대 경로여야 합니다.";
  }
  try {
    await access(executable, constants.X_OK);
    return null;
  } catch {
    try {
      await access(executable, constants.F_OK);
      return "실행 권한이 없습니다.";
    } catch {
      return "실행 파일을 찾을 수 없습니다.";
    }
  }
}

async function assertReadable(path: string, filename: string, message?: string): Promise<void> {
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new PhotoshopMcpError(
      ErrorCode.COMMAND_FAILED,
      `${message ?? "파일을 읽을 수 없습니다"}: ${filename}`,
      { details: { path, filename } },
    );
  }
}

/** 진단용으로 끝부분만 남긴다. 오류는 보통 마지막에 나온다. */
function tail(text: string, limit = 2000): string {
  return text.length <= limit ? text : `…${text.slice(-limit)}`;
}
