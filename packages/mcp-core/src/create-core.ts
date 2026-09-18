import { CommandEngine, CommandRegistry } from "@photoshop-mcp/command-engine";
import type { PhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { MockPhotoshopBridge, ToolRegistry } from "@photoshop-mcp/photoshop-bridge";
import { registerPhotoshopCommands, registerPhotoshopTools } from "@photoshop-mcp/photoshop-tools";
import { PhotoshopMcpServer } from "./server/mcp-server.js";

export interface CreatePhotoshopMcpOptions {
  /**
   * 사용할 Bridge. 생략하면 {@link MockPhotoshopBridge} 를 사용한다.
   * Phase 2 에서 UXP Bridge 를 여기에 주입한다.
   */
  bridge?: PhotoshopBridge;
  name?: string;
  version?: string;
}

/** 조립된 Core 구성 요소. */
export interface PhotoshopMcp {
  bridge: PhotoshopBridge;
  commands: CommandRegistry;
  engine: CommandEngine;
  tools: ToolRegistry;
  server: PhotoshopMcpServer;
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

  const engine = new CommandEngine({ registry: commands, bridge });

  const tools = new ToolRegistry();
  registerPhotoshopTools(tools, engine);

  const server = new PhotoshopMcpServer({
    registry: tools,
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.version === undefined ? {} : { version: options.version }),
  });

  return { bridge, commands, engine, tools, server };
}
