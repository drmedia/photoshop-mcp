import { CommandEngine, CommandRegistry } from "@photoshop-mcp/command-engine";
import type { PhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import {
  MockPhotoshopBridge,
  PermissionPolicy,
  ToolRegistry,
  UXPPhotoshopBridge,
} from "@photoshop-mcp/photoshop-bridge";
import type { Logger } from "@photoshop-mcp/photoshop-bridge";
import {
  registerCapabilityTools,
  registerWindowCaptureTool,
  registerDiagnosticsTool,
  registerEventTools,
  registerJobTools,
  registerWorkflowTools,
  registerPhotoshopCommands,
  registerPhotoshopTools,
} from "@photoshop-mcp/photoshop-tools";
import { CapabilityRegistry } from "./capabilities/registry.js";
import { PhotoshopWindowCapturer } from "./capture/window.js";
import { ExtensionManager } from "./extensions/manager.js";
import { EventBus } from "./events/bus.js";
import { ResourceRegistry, affectedResources } from "./resources/registry.js";
import { JobStore } from "./jobs/store.js";
import { WorkflowRegistry } from "./workflows/registry.js";
import { createConsoleLogger } from "./extensions/logger.js";
import { PhotoshopMcpServer } from "./server/mcp-server.js";

export interface CreatePhotoshopMcpOptions {
  /**
   * 사용할 Bridge. 생략하면 {@link MockPhotoshopBridge} 를 사용한다.
   * Phase 2 에서 UXP Bridge 를 여기에 주입한다.
   */
  bridge?: PhotoshopBridge;
  name?: string;
  version?: string;
  /** 진단 로그. 생략하면 stderr 로 쓰는 기본 로거를 쓴다. */
  logger?: Logger;
  /**
   * Permission 정책. 생략하면 기본 정책(`read` · `edit` 만 허용).
   *
   * `external` 과 `destructive` 는 명시적으로 켜야 한다. (ARCHITECTURE §22)
   */
  policy?: PermissionPolicy;
}

/** 조립된 Core 구성 요소. */
export interface PhotoshopMcp {
  bridge: PhotoshopBridge;
  commands: CommandRegistry;
  engine: CommandEngine;
  tools: ToolRegistry;
  server: PhotoshopMcpServer;
  /** 적용된 Permission 정책. */
  policy: PermissionPolicy;
  /** Extension 적재. `loadAll(dir)` 로 Extension 을 붙인다. (ROADMAP §9.2) */
  extensions: ExtensionManager;
  /** 외부 처리기. `loadConfig(path)` 로 Provider 를 등록한다. (ROADMAP §12) */
  capabilities: CapabilityRegistry;
  /** 긴 작업. MCP 60초 타임아웃을 넘는 것은 여기로 보낸다. (ROADMAP §14) */
  jobs: JobStore;
  /** 선언으로 정의한 Tool 순서. `loadConfig(path)` 로 등록한다. (ROADMAP §11) */
  workflows: WorkflowRegistry;
  /** Photoshop 과 Command 의 변화. (ROADMAP §15) */
  events: EventBus;
  /** MCP Resource. 문서·레이어 등을 맥락으로 노출한다. (ROADMAP §16) */
  resources: ResourceRegistry;
  logger: Logger;
}

/**
 * Core Resource 를 등록한다. (ROADMAP §16, ARCHITECTURE §20)
 *
 * 모두 읽기 전용이며 읽을 때마다 실제 상태를 조회한다. 캐시하지 않는다 —
 * Photoshop 상태는 계속 바뀐다.
 *
 * Tool 과 데이터가 겹치지만 쓰임이 다르다. Tool 은 행동이고 Resource 는 맥락이다.
 * 클라이언트가 미리 읽어 대화에 붙일 수 있다.
 */
function registerCoreResources(input: {
  resources: ResourceRegistry;
  engine: CommandEngine;
  capabilities: CapabilityRegistry;
  extensions: () => { manifest: { namespace: string; name: string; version: string } }[];
}): void {
  const { resources, engine, capabilities } = input;
  const run = <T>(type: string): Promise<T> => engine.execute<T>({ type, params: {} });

  resources.register({
    uri: "photoshop://document/current",
    name: "현재 문서",
    description: "활성 Photoshop 문서의 이름·크기·비트 심도·색상 모드",
    read: async () => run("DOCUMENT_GET"),
  });
  resources.register({
    uri: "photoshop://layers",
    name: "레이어 목록",
    description: "활성 문서의 레이어. 위에서부터, opacity·parentId·blendMode 포함",
    read: async () => ({ layers: await run("LAYER_LIST") }),
  });
  resources.register({
    uri: "photoshop://selection",
    name: "선택 영역",
    description: "선택 영역 유무와 경계",
    read: async () => run("SELECTION_GET"),
  });
  resources.register({
    uri: "photoshop://history",
    name: "History",
    description: "History 항목과 현재 지점. 되돌려도 목록은 줄지 않는다",
    read: async () => run("HISTORY_LIST"),
  });
  resources.register({
    uri: "photoshop://capabilities",
    name: "외부 처리기",
    description: "설정된 외부 처리기와 사용 가능 여부",
    // Photoshop 연결이 없어도 읽을 수 있다. 설정 확인은 연결과 무관하다.
    read: async () => ({ providers: await capabilities.describeAsync() }),
  });
  resources.register({
    uri: "photoshop://extensions",
    name: "Extension",
    description: "적재된 Extension 과 버전",
    read: () =>
      Promise.resolve({
        extensions: input.extensions().map((loaded) => ({
          namespace: loaded.manifest.namespace,
          name: loaded.manifest.name,
          version: loaded.manifest.version,
        })),
      }),
  });
}

/**
 * Core 조립.
 *
 * Bridge → Command Engine → Tool Registry → MCP Server 순서로 연결한다.
 * 실행(진입점·프로세스 관리)은 `@photoshop-mcp/mcp-server` 가 담당한다.
 */
export function createPhotoshopMcp(options: CreatePhotoshopMcpOptions = {}): PhotoshopMcp {
  // 로거를 먼저 만든다. 아래 구성 요소들이 모두 이것을 받는다.
  const logger = options.logger ?? createConsoleLogger();

  const bridge = options.bridge ?? new MockPhotoshopBridge();

  const commands = new CommandRegistry();
  registerPhotoshopCommands(commands);

  const policy = options.policy ?? new PermissionPolicy();

  const events = new EventBus({ logger });
  const resources = new ResourceRegistry({ logger });

  const engine = new CommandEngine({
    registry: commands,
    bridge,
    policy,
    // Command 수명 이벤트. Photoshop 연결이 없어도 발생한다.
    onEvent: (name, data) => {
      events.emit(name, data);

      // correlation ID 추적. (ROADMAP §17 Logging)
      //
      // 기본적으로 조용하다. stdout 은 MCP 전송이 점유하고 stderr 도 시끄러우면
      // 진짜 오류가 묻힌다. PHOTOSHOP_MCP_DEBUG=1 일 때만 나온다.
      // 문서를 바꾼 Command 는 관련 Resource 가 낡았다고 알린다. (ROADMAP §16)
      //
      // MCP 에 임의 이벤트를 미는 통로는 없지만 resources/updated 는 있다.
      // 구독한 클라이언트는 폴링 없이 안다.
      if (name === "command.completed") {
        resources.touch(...affectedResources(String(data["command"] ?? "")));
      }

      const id = String(data["requestId"] ?? "?");
      const command = String(data["command"] ?? "?");
      if (name === "command.failed") {
        // 실패는 디버그가 아니어도 남긴다. 조용히 실패하면 원인을 못 찾는다.
        logger.warn(`[${id}] ${command} 실패: ${String(data["code"] ?? "")}`);
      } else {
        const suffix = data["durationMs"] === undefined ? "" : ` (${String(data["durationMs"])}ms)`;
        logger.debug(`[${id}] ${command} ${name.replace("command.", "")}${suffix}`);
      }
    },
  });

  const tools = new ToolRegistry(policy);
  registerPhotoshopTools(tools, engine);

  const server = new PhotoshopMcpServer({
    registry: tools,
    resources,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.version === undefined ? {} : { version: options.version }),
  });

  // 외부 처리기의 입출력은 승인된 작업 폴더 안으로 가둔다. (ROADMAP §8.5)
  // Bridge 를 직접 알면 계층이 섞이므로 조회 함수만 주입한다.
  const jobs = new JobStore({ logger });

  const capabilities = new CapabilityRegistry({
    logger,
    resolveWorkspace: async () => {
      try {
        const status = await engine.execute<{ approved: boolean; path: string | null }>({
          type: "WORKSPACE_STATUS",
          params: {},
        });
        return status.approved ? status.path : null;
      } catch {
        // Photoshop 이 연결되지 않았거나 권한이 없으면 승인되지 않은 것으로 본다.
        return null;
      }
    },
  });

  const extensions = new ExtensionManager({
    tools,
    commands: engine,
    capabilities,
    jobs,
    events,
    resources,
    logger,
  });

  // Resource 는 capabilities · extensions 를 들여다보므로 그들이 만들어진 뒤에 등록한다.
  registerCoreResources({
    resources,
    engine,
    capabilities,
    extensions: () => extensions.list(),
  });

  registerCapabilityTools(tools, capabilities);

  registerWindowCaptureTool(tools, new PhotoshopWindowCapturer());
  registerJobTools(tools, jobs);
  registerEventTools(tools, events);

  const workflows = new WorkflowRegistry({ tools, jobs, logger });
  registerWorkflowTools(tools, workflows);

  // 진단은 다른 모든 구성 요소를 들여다보므로 마지막에 붙인다.
  registerDiagnosticsTool(tools, {
    bridgeConnected: () => bridge.isConnected(),
    bridgeState: () => (bridge.isConnected() ? "connected" : "disconnected"),
    /* 아는 둘만 이름을 붙이고 주입된 Bridge 는 `null` 이다. 짐작해서 "uxp"
     * 라고 답하면 그 거짓이 가장 필요할 때 나온다. */
    bridgeKind: () => {
      if (bridge instanceof MockPhotoshopBridge) {
        return "mock";
      }
      return bridge instanceof UXPPhotoshopBridge ? "uxp" : null;
    },
    allowedPermissions: () => policy.allowed,
    toolCount: () => tools.size,
    commandCount: () => commands.size,
    providers: async () => capabilities.describeAsync(),
    workflows: () => workflows.list(),
    extensions: () =>
      extensions.list().map((loaded) => ({
        namespace: loaded.manifest.namespace,
        name: loaded.manifest.name,
        tools: loaded.registeredTools,
      })),
    jobCounts: () => {
      const counts: Record<string, number> = {};
      for (const record of jobs.list()) {
        counts[record.state] = (counts[record.state] ?? 0) + 1;
      }
      return counts;
    },
    eventCount: () => events.size,
  });

  return {
    bridge,
    commands,
    engine,
    tools,
    server,
    extensions,
    capabilities,
    jobs,
    workflows,
    events,
    resources,
    logger,
    policy,
  };
}
