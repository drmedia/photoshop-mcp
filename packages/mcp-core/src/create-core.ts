import { CommandEngine, CommandRegistry } from "@photoshop-mcp/command-engine";
import type { PhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import {
  MockPhotoshopBridge,
  PermissionPolicy,
  ToolRegistry,
} from "@photoshop-mcp/photoshop-bridge";
import type { Logger } from "@photoshop-mcp/photoshop-bridge";
import {
  registerCapabilityTools,
  registerDiagnosticsTool,
  registerEventTools,
  registerJobTools,
  registerWorkflowTools,
  registerPhotoshopCommands,
  registerPhotoshopTools,
} from "@photoshop-mcp/photoshop-tools";
import { CapabilityRegistry } from "./capabilities/registry.js";
import { ExtensionManager } from "./extensions/manager.js";
import { EventBus } from "./events/bus.js";
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
  logger: Logger;
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
    logger,
  });

  registerCapabilityTools(tools, capabilities);
  registerJobTools(tools, jobs);
  registerEventTools(tools, events);

  const workflows = new WorkflowRegistry({ tools, jobs, logger });
  registerWorkflowTools(tools, workflows);

  // 진단은 다른 모든 구성 요소를 들여다보므로 마지막에 붙인다.
  registerDiagnosticsTool(tools, {
    bridgeConnected: () => bridge.isConnected(),
    bridgeState: () => (bridge.isConnected() ? "connected" : "disconnected"),
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
    logger,
    policy,
  };
}
