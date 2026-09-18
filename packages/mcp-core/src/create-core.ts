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
  registerJobTools,
  registerPhotoshopCommands,
  registerPhotoshopTools,
} from "@photoshop-mcp/photoshop-tools";
import { CapabilityRegistry } from "./capabilities/registry.js";
import { ExtensionManager } from "./extensions/manager.js";
import { JobStore } from "./jobs/store.js";
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
  logger: Logger;
}

/**
 * Core 조립.
 *
 * Bridge → Command Engine → Tool Registry → MCP Server 순서로 연결한다.
 * 실행(진입점·프로세스 관리)은 `@photoshop-mcp/mcp-server` 가 담당한다.
 */
export function createPhotoshopMcp(options: CreatePhotoshopMcpOptions = {}): PhotoshopMcp {
  const bridge = options.bridge ?? new MockPhotoshopBridge();

  const commands = new CommandRegistry();
  registerPhotoshopCommands(commands);

  const policy = options.policy ?? new PermissionPolicy();

  const engine = new CommandEngine({ registry: commands, bridge, policy });

  const tools = new ToolRegistry(policy);
  registerPhotoshopTools(tools, engine);

  const logger = options.logger ?? createConsoleLogger();

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

  registerCapabilityTools(tools, capabilities);
  registerJobTools(tools, jobs);

  const extensions = new ExtensionManager({
    tools,
    commands: engine,
    capabilities,
    jobs,
    logger,
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
    logger,
    policy,
  };
}
