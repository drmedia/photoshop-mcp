import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  CapabilityRequest,
  CapabilityResult,
  ExtensionCapabilityRegistry,
  ExtensionCommandEngine,
  ExtensionEventBus,
  ExtensionJobRegistry,
  ExtensionResourceRegistry,
  ExtensionContext,
  ExtensionManifest,
  ExtensionToolRegistry,
  Logger,
  PermissionLevel,
  PhotoshopMcpExtension,
  ToolRegistry,
} from "@photoshop-mcp/photoshop-bridge";
import {
  ErrorCode,
  ExtensionManifestSchema,
  PhotoshopMcpError,
  RESERVED_NAMESPACES,
  permissionToLevel,
} from "@photoshop-mcp/photoshop-bridge";
import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { EventBus } from "../events/bus.js";
import type { ResourceRegistry } from "../resources/registry.js";
import type { JobStore } from "../jobs/store.js";

/**
 * Extension Manager. (ROADMAP §9.2, ARCHITECTURE §14)
 *
 * `extensions/<name>/extension.json` 을 훑어 적재한다.
 *
 * 핵심 규칙은 namespace 격리다. Extension 은 자신의 namespace 로 시작하는 Tool 만
 * 등록할 수 있고, `photoshop.*` 이나 다른 Extension 의 namespace 를 쓸 수 없다.
 * (ARCHITECTURE §17, §23)
 */

/** 적재된 Extension 한 건. */
export interface LoadedExtension {
  manifest: ExtensionManifest;
  /** manifest 가 있던 디렉터리의 절대 경로. */
  directory: string;
  /** 이 Extension 이 등록한 Tool 이름. deactivate 진단에 쓴다. */
  registeredTools: string[];
  /** 이 Extension 이 등록한 Resource URI. unload 때 되돌린다. */
  registeredResources: string[];
  instance: PhotoshopMcpExtension;
}

export interface ExtensionManagerOptions {
  tools: ToolRegistry;
  commands: CommandEngine;
  /** 외부 처리기. (ARCHITECTURE §19) */
  capabilities: ExtensionCapabilityRegistry;
  /** 긴 작업. (ARCHITECTURE §25) */
  jobs: JobStore;
  /** Photoshop 과 Command 의 변화. (ARCHITECTURE §21) */
  events: EventBus;
  /** MCP Resource. (ARCHITECTURE §20) */
  resources: ResourceRegistry;
  logger: Logger;
}

/** 발견된 Extension 후보. 아직 검증·적재하지 않았다. */
export interface DiscoveredExtension {
  directory: string;
  manifestPath: string;
}

export class ExtensionManager {
  readonly #tools: ToolRegistry;
  readonly #commands: CommandEngine;
  readonly #capabilities: ExtensionCapabilityRegistry;
  readonly #jobs: JobStore;
  readonly #events: EventBus;
  readonly #resources: ResourceRegistry;
  readonly #logger: Logger;
  readonly #loaded = new Map<string, LoadedExtension>();

  constructor(options: ExtensionManagerOptions) {
    this.#tools = options.tools;
    this.#commands = options.commands;
    this.#capabilities = options.capabilities;
    this.#jobs = options.jobs;
    this.#events = options.events;
    this.#resources = options.resources;
    this.#logger = options.logger;
  }

  /** namespace 로 색인된 적재 목록. */
  list(): LoadedExtension[] {
    return [...this.#loaded.values()];
  }

  get(namespace: string): LoadedExtension | undefined {
    return this.#loaded.get(namespace);
  }

  get size(): number {
    return this.#loaded.size;
  }

  /**
   * 디렉터리에서 Extension 후보를 찾는다.
   *
   * 한 단계만 훑는다. `extensions/<name>/extension.json` 형태만 인정한다.
   * 디렉터리가 없으면 빈 배열을 돌려준다 — Extension 이 없는 것은 오류가 아니다.
   */
  async discover(root: string): Promise<DiscoveredExtension[]> {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      this.#logger.debug(`Extension 디렉터리가 없습니다: ${root}`);
      return [];
    }

    const found: DiscoveredExtension[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const directory = resolve(root, entry.name);
      const manifestPath = join(directory, "extension.json");
      try {
        await readFile(manifestPath, "utf8");
        found.push({ directory, manifestPath });
      } catch {
        // extension.json 이 없는 디렉터리는 Extension 이 아니다. 조용히 건너뛴다.
      }
    }
    return found;
  }

  /**
   * manifest 를 읽고 검증한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `EXTENSION_LOAD_FAILED` — 파일 없음 · JSON 오류 · 스키마 위반
   *   - `EXTENSION_NAMESPACE_CONFLICT` — 예약된 namespace 또는 이미 쓰이는 namespace
   */
  async validate(manifestPath: string): Promise<ExtensionManifest> {
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (error) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_LOAD_FAILED,
        `extension.json 을 읽을 수 없습니다: ${manifestPath}`,
        { cause: error, details: { manifestPath } },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (error) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_LOAD_FAILED,
        `extension.json 이 올바른 JSON 이 아닙니다: ${manifestPath}`,
        { cause: error, details: { manifestPath } },
      );
    }

    const parsed = ExtensionManifestSchema.safeParse(json);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_LOAD_FAILED,
        `extension.json 이 스키마를 만족하지 않습니다: ${manifestPath}`,
        { details: { manifestPath, issues: parsed.error.issues } },
      );
    }

    this.#assertNamespaceAvailable(parsed.data.namespace, manifestPath);
    return parsed.data;
  }

  /**
   * Extension 을 적재하고 활성화한다.
   *
   * 활성화 중 Tool 등록이 실패하면 이미 등록한 Tool 을 되돌린다.
   * 절반만 적재된 Extension 을 남기지 않기 위함이다.
   */
  async load(discovered: DiscoveredExtension): Promise<LoadedExtension> {
    const manifest = await this.validate(discovered.manifestPath);
    const entry = resolve(discovered.directory, manifest.main);

    let module: { default?: unknown; activate?: unknown; deactivate?: unknown };
    try {
      module = (await import(pathToFileURL(entry).href)) as typeof module;
    } catch (error) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_LOAD_FAILED,
        `Extension 진입점을 불러올 수 없습니다: ${entry}`,
        { cause: error, details: { namespace: manifest.namespace, entry } },
      );
    }

    const instance = toExtension(module);
    if (instance === null) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_LOAD_FAILED,
        `Extension 이 activate 를 내보내지 않습니다: ${entry}`,
        { details: { namespace: manifest.namespace, entry } },
      );
    }

    const loaded: LoadedExtension = {
      manifest,
      directory: discovered.directory,
      registeredTools: [],
      registeredResources: [],
      instance,
    };

    await this.#activate(loaded);
    this.#loaded.set(manifest.namespace, loaded);
    this.#logger.info(
      `Extension 적재: ${manifest.name} (${manifest.namespace}) Tool ${loaded.registeredTools.length}개`,
    );
    return loaded;
  }

  /** 디렉터리를 훑어 모두 적재한다. 하나가 실패해도 나머지는 계속 적재한다. */
  async loadAll(root: string): Promise<LoadedExtension[]> {
    const discovered = await this.discover(root);
    const loaded: LoadedExtension[] = [];

    for (const candidate of discovered) {
      try {
        loaded.push(await this.load(candidate));
      } catch (error) {
        // 하나가 잘못되어도 서버는 떠야 한다. (ARCHITECTURE §17 Invalid Extension isolation)
        const normalized = PhotoshopMcpError.from(error, ErrorCode.EXTENSION_LOAD_FAILED);
        this.#logger.error(`Extension 적재 실패: ${candidate.manifestPath}`, normalized.toJSON());
      }
    }
    return loaded;
  }

  /**
   * Extension 을 비활성화하고 등록을 되돌린다.
   *
   * @returns 적재되어 있지 않았으면 `false`.
   */
  async unload(namespace: string): Promise<boolean> {
    const loaded = this.#loaded.get(namespace);
    if (loaded === undefined) {
      return false;
    }

    try {
      await loaded.instance.deactivate?.();
    } catch (error) {
      // deactivate 가 실패해도 등록은 되돌린다. 남겨두면 Tool 이 고아가 된다.
      this.#logger.error(
        `Extension deactivate 실패: ${namespace}`,
        PhotoshopMcpError.from(error).toJSON(),
      );
    }

    for (const name of loaded.registeredTools) {
      this.#tools.unregister(name);
    }
    for (const uri of loaded.registeredResources) {
      this.#resources.unregister(uri);
    }
    // 리스너를 남기면 사라진 Extension 의 코드가 계속 불린다.
    const removed = this.#events.offOwner(namespace);
    this.#loaded.delete(namespace);
    this.#logger.info(
      `Extension 해제: ${namespace}${removed > 0 ? ` (구독 ${removed}개 정리)` : ""}`,
    );
    return true;
  }

  // -------------------------------------------------------------------------

  async #activate(loaded: LoadedExtension): Promise<void> {
    const context = this.#createContext(loaded);

    try {
      await loaded.instance.activate(context);
    } catch (error) {
      // 활성화 중 등록한 것을 되돌린다.
      for (const name of loaded.registeredTools) {
        this.#tools.unregister(name);
      }
      for (const uri of loaded.registeredResources) {
        this.#resources.unregister(uri);
      }
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_LOAD_FAILED,
        `Extension activate 가 실패했습니다: ${loaded.manifest.namespace}`,
        { cause: error, details: { namespace: loaded.manifest.namespace } },
      );
    }
  }

  /**
   * namespace 를 강제하는 Tool 레지스트리를 씌운 컨텍스트를 만든다.
   *
   * Extension 에 실제 레지스트리를 그대로 주면 `photoshop.*` 을 덮어쓸 수 있다.
   * 등록 시점에 이름을 검사하는 얇은 대리자를 준다.
   */
  #createContext(loaded: LoadedExtension): ExtensionContext {
    const { namespace } = loaded.manifest;
    const prefix = `${namespace}.`;
    const registry = this.#tools;

    // manifest 가 선언한 권한으로 가둔다. (ARCHITECTURE §22)
    //
    // 선언하지 않았으면 **아무 권한도 없다.** 최소 권한 원칙이다.
    // 기본값을 주면 권한을 적지 않은 Extension 이 조용히 편집 권한을 얻는다.
    const granted = grantedLevels(loaded.manifest);
    const scopedPolicy = this.#commands.policy.restrictTo(granted);

    const scoped: ExtensionToolRegistry = {
      register: (tool) => {
        if (!tool.name.startsWith(prefix)) {
          throw new PhotoshopMcpError(
            ErrorCode.EXTENSION_NAMESPACE_VIOLATION,
            "Extension 은 자신의 namespace 로만 Tool 을 등록할 수 있습니다. " +
              `기대: ${prefix}* / 실제: ${tool.name}`,
            { details: { namespace, toolName: tool.name } },
          );
        }
        // manifest 에 없는 권한을 요구하는 Tool 은 등록 자체를 막는다.
        // 호출 시점에 막으면 Tool 목록에는 떠 있는데 항상 실패하는 상태가 된다.
        if (!granted.includes(tool.permission)) {
          throw new PhotoshopMcpError(
            ErrorCode.PERMISSION_DENIED,
            `Extension 이 manifest 에 선언하지 않은 권한의 Tool 을 등록하려 합니다: ` +
              `${tool.name} 은 '${tool.permission}' 필요, 선언: ${granted.join(", ") || "(없음)"}`,
            {
              details: {
                namespace,
                toolName: tool.name,
                required: tool.permission,
                granted,
              },
            },
          );
        }
        registry.register(tool);
        loaded.registeredTools.push(tool.name);
      },
      has: (name) => registry.has(name),
    };

    // Command 호출에도 같은 상한을 씌운다.
    // Extension 은 Tool 을 거치지 않고 Command 를 직접 부를 수 있다. (ARCHITECTURE §3.2)
    const engine = this.#commands;
    const commands: ExtensionCommandEngine = {
      execute: (command, options) =>
        engine.execute(command as Parameters<typeof engine.execute>[0], {
          ...options,
          policy: scopedPolicy,
          namespace,
        }),
    };

    // Capability 실행은 external 이다. Command 와 같은 상한을 씌운다.
    // Extension 이 manifest 에 photoshop.external 을 선언하지 않았으면 실행할 수 없다.
    const source = this.#capabilities;
    const capabilities: ExtensionCapabilityRegistry = {
      list: () => source.list(),
      has: (capability) => source.has(capability),
      describe: (capability) => source.describe(capability),
      execute: async (
        capability,
        request: CapabilityRequest,
        options?: { signal?: AbortSignal },
      ): Promise<CapabilityResult> => {
        scopedPolicy.assert("external", {
          kind: "command",
          name: `capability:${capability}`,
          namespace,
        });
        return source.execute(capability, request, options ?? {});
      },
    };

    // Job 은 namespace 로 격리한다. 다른 Extension 의 Job 을 보거나 취소할 수 없다.
    const store = this.#jobs;
    const jobs: ExtensionJobRegistry = {
      start: (kind, run) => store.start(kind, run, { owner: namespace }),
      get: (id) => store.get(id, namespace),
    };

    // 구독은 namespace 로 묶어두고 unload 때 한꺼번에 해제한다.
    // Extension 이 사라졌는데 리스너가 남으면 죽은 코드가 계속 불린다.
    const bus = this.#events;
    const events: ExtensionEventBus = {
      on: (name, listener) => bus.on(name, listener, { owner: namespace }),
      recent: (query) => bus.recent(query ?? {}),
    };

    // Resource 도 namespace 로 가둔다. `milky://` 만 쓸 수 있다.
    // Tool 이름 규칙과 같은 이유다 — Core 나 다른 Extension 의 것을 덮어쓸 수 없다.
    const resourceRegistry = this.#resources;
    const scheme = `${namespace}://`;
    const resources: ExtensionResourceRegistry = {
      register: (definition) => {
        if (!definition.uri.startsWith(scheme)) {
          throw new PhotoshopMcpError(
            ErrorCode.EXTENSION_NAMESPACE_VIOLATION,
            "Extension 은 자신의 namespace 로만 Resource 를 등록할 수 있습니다. " +
              `기대: ${scheme}* / 실제: ${definition.uri}`,
            { details: { namespace, uri: definition.uri } },
          );
        }
        resourceRegistry.register(definition);
        loaded.registeredResources.push(definition.uri);
      },
      touch: (uri) => {
        // 남의 리소스가 바뀌었다고 알릴 수 없다.
        if (uri.startsWith(scheme)) {
          resourceRegistry.touch(uri);
        }
      },
    };

    return {
      manifest: loaded.manifest,
      tools: scoped,
      commands,
      capabilities,
      jobs,
      events,
      resources,
      logger: this.#logger,
    };
  }

  #assertNamespaceAvailable(namespace: string, manifestPath: string): void {
    if ((RESERVED_NAMESPACES as readonly string[]).includes(namespace)) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_NAMESPACE_CONFLICT,
        `예약된 namespace 입니다: ${namespace}`,
        { details: { namespace, manifestPath } },
      );
    }
    const existing = this.#loaded.get(namespace);
    if (existing !== undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.EXTENSION_NAMESPACE_CONFLICT,
        `이미 사용 중인 namespace 입니다: ${namespace}`,
        { details: { namespace, manifestPath, existing: existing.manifest.id } },
      );
    }
  }
}

/**
 * manifest 가 선언한 Permission Level.
 *
 * 선언이 없으면 빈 배열이다 — 아무 Command 도 실행할 수 없다.
 * 알 수 없는 문자열은 조용히 버린다. 스키마가 이미 거른 뒤이므로 여기 도달하지 않는다.
 */
function grantedLevels(manifest: ExtensionManifest): PermissionLevel[] {
  const levels: PermissionLevel[] = [];
  for (const permission of manifest.permissions ?? []) {
    const level = permissionToLevel(permission);
    if (level !== null && !levels.includes(level)) {
      levels.push(level);
    }
  }
  return levels;
}

/** 모듈이 내보낸 것에서 Extension 을 꺼낸다. default export 와 named export 를 모두 받는다. */
function toExtension(module: {
  default?: unknown;
  activate?: unknown;
  deactivate?: unknown;
}): PhotoshopMcpExtension | null {
  const candidate =
    typeof module.activate === "function"
      ? module
      : ((module.default ?? null) as { activate?: unknown; deactivate?: unknown } | null);

  if (candidate === null || typeof candidate.activate !== "function") {
    return null;
  }
  return candidate as unknown as PhotoshopMcpExtension;
}
