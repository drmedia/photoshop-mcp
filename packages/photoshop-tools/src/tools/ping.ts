import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { SERVER_NAME, SERVER_VERSION } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { PING, type PingResult } from "../commands/ping.js";

export const PingInputSchema = z.object({}).strict();

export interface PingToolResult {
  status: "ok";
  server: string;
  version: string;
  bridgeConnected: boolean;
}

/** `photoshop.ping` — 서버 생존 확인과 Bridge 연결 상태 보고. */
export function createPingTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, PingToolResult> {
  return {
    name: "photoshop.ping",
    description: "Photoshop MCP 서버의 상태와 Photoshop Bridge 연결 여부를 반환한다.",
    permission: "read",
    inputSchema: PingInputSchema,
    handler: async (_input, context) => {
      const result = await engine.execute<PingResult>(
        { type: PING, params: {} },
        { requestId: context.requestId },
      );
      return {
        status: "ok",
        server: SERVER_NAME,
        version: SERVER_VERSION,
        bridgeConnected: result.bridgeConnected,
      };
    },
  };
}
