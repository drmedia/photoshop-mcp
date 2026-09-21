import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { listBlockers, type Blocker } from "@photoshop-mcp/photoshop-tools";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { readOptionsFromEnv } from "./run.js";

/**
 * `photoshop-mcp doctor` — 지금 무엇이 막혀 있는지 터미널에서 본다. (ROADMAP §18)
 *
 * ## 왜 필요한가
 *
 * `photoshop.diagnostics` 가 같은 정보를 이미 준다. 그런데 **그건 MCP 클라이언트가
 * 붙은 뒤에야 부를 수 있다.** 설치 중에 막히면 그 시점에는 클라이언트가 없다.
 *
 * 실기에서 `.mcp.json` 에 `PHOTOSHOP_MCP_ALLOW` 가 없어 `external` Tool 이 전부
 * 막혀 있었는데, 실제로 불러 보고 나서야 알았다 — 정보가 없어서가 아니라
 * 볼 자리가 없어서였다.
 *
 * ## 무엇을 알 수 없는가
 *
 * **터미널에서 돌린 doctor 는 MCP 클라이언트가 넘길 환경 변수를 모른다.**
 * `.mcp.json` 의 `env` 는 클라이언트가 서버를 띄울 때만 적용된다. 그래서 권한은
 * "지금 이렇다" 가 아니라 **"이렇게 넣으세요"** 로 낸다. 이 구분을 흐리면
 * 사용자가 doctor 가 통과했으니 됐다고 믿게 된다.
 *
 * 판정은 `listBlockers()` 하나만 쓴다. 두 벌을 만들면 `diagnostics` 와 doctor 가
 * 다른 말을 하게 되고, 그때 어느 쪽을 믿어야 할지 알 수 없다.
 */

export interface DoctorCheck {
  name: string;
  /** `ok` 통과 · `warn` 알아 둘 것 · `fail` 고쳐야 하는 것. */
  level: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** `fail` 이 하나라도 있으면 거짓. 종료 코드가 된다. */
  healthy: boolean;
  /**
   * MCP 클라이언트 설정에 넣을 조각. 넣을 것이 없으면 `null`.
   *
   * **고칠 것이 있을 때만 낸다.** 매번 JSON 을 쏟으면 기동 로그를 줄인 이유가
   * 되돌아온다 — 늘 나오는 것은 읽히지 않는다.
   */
  snippet: string | null;
}

const MIN_NODE_MAJOR = 22;

/** 권한 때문에 막힌 것들. 다른 검사가 이미 내는 항목과 겹치지 않게 한다. */
const PERMISSION_CODES = new Set(["no_external", "no_destructive"]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** 포트가 비어 있는지 본다. 이미 쓰고 있으면 서버가 기동에 실패한다. */
async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => {
      resolve(false);
    });
    probe.once("listening", () => {
      probe.close(() => {
        resolve(true);
      });
    });
    probe.listen(port, "127.0.0.1");
  });
}

export async function runDoctor(
  env: Record<string, string | undefined> = process.env,
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const add = (name: string, level: DoctorCheck["level"], detail: string): void => {
    checks.push({ name, level, detail });
  };

  const options = readOptionsFromEnv(env);

  // ── 실행 환경 ──────────────────────────────────────────────────────
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  add(
    "Node",
    major >= MIN_NODE_MAJOR ? "ok" : "fail",
    major >= MIN_NODE_MAJOR
      ? `v${process.versions.node}`
      : `v${process.versions.node} — 개발·테스트 도구가 ${MIN_NODE_MAJOR} 이상을 요구합니다`,
  );

  // ── 포트 ───────────────────────────────────────────────────────────
  const free = await portFree(options.port);
  add(
    "Bridge 포트",
    free ? "ok" : "warn",
    free
      ? `${options.port} 비어 있음`
      : `${options.port} 을 이미 쓰고 있습니다. 서버가 이미 떠 있다면 정상이고, ` +
          "아니라면 새 서버가 EADDRINUSE 로 기동에 실패합니다",
  );

  // ── 외부 처리기 ────────────────────────────────────────────────────
  if (!(await exists(options.capabilityConfig))) {
    add(
      "외부 처리기",
      "warn",
      `${options.capabilityConfig} 이 없습니다. photoshop-mcp init 으로 만들 수 있습니다`,
    );
  } else {
    try {
      const parsed = JSON.parse(await readFile(options.capabilityConfig, "utf8")) as {
        providers?: { id?: string; executable?: string }[];
      };
      const providers = parsed.providers ?? [];
      // 선언만 보지 않고 **실행 파일이 실제로 있는지** 확인한다.
      // 경로가 틀린 설정은 쓸 때가 되어서야 드러난다.
      const missing: string[] = [];
      for (const provider of providers) {
        if (provider.executable !== undefined && !(await exists(provider.executable))) {
          missing.push(`${provider.id ?? "?"} → ${provider.executable}`);
        }
      }
      add(
        "외부 처리기",
        missing.length === 0 ? "ok" : "fail",
        missing.length === 0
          ? `${providers.length}개 선언, 실행 파일 모두 있음`
          : `실행 파일을 찾을 수 없습니다: ${missing.join(" · ")}`,
      );
    } catch (error) {
      add(
        "외부 처리기",
        "fail",
        `${options.capabilityConfig} 을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── Extension ─────────────────────────────────────────────────────
  // Mock Bridge 로 실제 적재해 본다. 선언만 보면 import 실패를 놓친다.
  const probe = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: options.policy,
  });
  if (await exists(options.extensionsDir)) {
    const loaded = await probe.extensions.loadAll(options.extensionsDir);
    add(
      "Extension",
      "ok",
      loaded.length === 0
        ? `${options.extensionsDir} 에 적재된 것이 없습니다`
        : loaded
            .map((item) => `${item.manifest.namespace}(${item.registeredTools.length})`)
            .join(" · "),
    );
  } else {
    add("Extension", "ok", `${options.extensionsDir} 이 없습니다 — Extension 없이 동작합니다`);
  }

  // ── 권한 ───────────────────────────────────────────────────────────
  /* **여기서 본 환경 변수가 MCP 클라이언트가 넘길 것과 같다는 보장이 없다.**
   * `.mcp.json` 의 `env` 는 클라이언트가 서버를 띄울 때만 적용된다. */
  const declared = env["PHOTOSHOP_MCP_ALLOW"];
  const permissionBlockers = listBlockers({
    connected: null,
    allowed: options.policy.allowed,
    providers: [],
    extensions: [],
    // 권한 항목만 고른다. `no_providers` 는 위 "외부 처리기" 검사가 이미 냈다 —
    // 접두사로 거르면 그것까지 걸려 같은 말이 두 번 나온다.
  }).filter((item: Blocker) => PERMISSION_CODES.has(item.code));

  add(
    "권한",
    permissionBlockers.length === 0 ? "ok" : "warn",
    declared === undefined
      ? `PHOTOSHOP_MCP_ALLOW 가 이 셸에 없습니다 (기본 ${options.policy.allowed.join(", ")}). ` +
          "MCP 클라이언트 설정의 env 가 이 값을 덮으므로, 여기 결과는 참고용입니다"
      : `이 셸 기준 ${options.policy.allowed.join(", ")}`,
  );
  for (const blocker of permissionBlockers) {
    add(`  ${blocker.label}`, "warn", blocker.detail);
  }

  await probe.server.stop().catch(() => undefined);

  return {
    checks,
    healthy: !checks.some((check) => check.level === "fail"),
    // 권한이 이미 맞으면 낼 것이 없다.
    snippet: permissionBlockers.some((item) => item.code === "no_external")
      ? clientSnippet()
      : null,
  };
}

/**
 * MCP 클라이언트 설정 조각.
 *
 * **`destructive` 는 넣지 않는다.** 덮어쓰기(`document.save`) · 평탄화 ·
 * 액션 실행이 거기 있어서 기본으로 열 것이 아니다. 필요한 사람이 스스로
 * 더하게 둔다.
 *
 * 경로는 **이 파일이 있는 위치에서** 만든다. 문서에 적어 두면 옮겼을 때
 * 틀린 경로를 복사하게 된다.
 */
function clientSnippet(): string {
  // JSON 에 역슬래시가 들어가면 이스케이프가 필요하고 손으로 고칠 때 틀린다.
  // Node 는 Windows 에서도 `/` 를 받는다.
  const bin = fileURLToPath(new URL("../bin/photoshop-mcp.js", import.meta.url))
    .split("\\")
    .join("/");
  const config = {
    mcpServers: {
      photoshop: {
        command: "node",
        args: [bin],
        env: {
          PHOTOSHOP_MCP_BRIDGE: "uxp",
          PHOTOSHOP_MCP_ALLOW: "read,edit,external",
        },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

const MARK: Record<DoctorCheck["level"], string> = { ok: "OK  ", warn: "주의", fail: "실패" };

/** CLI 진입점. 종료 코드로 답한다 — CI 에서도 쓸 수 있게. */
export async function main(): Promise<void> {
  const report = await runDoctor();
  for (const check of report.checks) {
    console.error(`[${MARK[check.level]}] ${check.name.padEnd(12)} ${check.detail}`);
  }
  console.error(
    report.healthy
      ? "\n고쳐야 할 것은 없습니다. 주의 항목은 기본값이거나 참고용입니다."
      : "\n실패 항목을 고친 뒤 다시 실행하세요.",
  );

  if (report.snippet !== null) {
    console.error(
      "\nMCP 클라이언트 설정에 이렇게 넣으면 external 이 열립니다." +
        "\n  Claude Code — 프로젝트의 .mcp.json" +
        "\n  Claude Desktop — claude_desktop_config.json" +
        "\n설정을 고친 뒤에는 MCP 서버를 다시 연결해야 적용됩니다.\n",
    );
    console.error(report.snippet);
  }

  process.exitCode = report.healthy ? 0 : 1;
}
