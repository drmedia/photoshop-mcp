import type { CommandHandler } from "@photoshop-mcp/command-engine";

/** `PING` Command 결과. */
export interface PingResult {
  /** Bridge 가 Photoshop 과 연결되어 있는지. */
  bridgeConnected: boolean;
}

export const PING = "PING";

/** Bridge 연결 상태를 확인한다. Photoshop 상태를 변경하지 않는다. */
export const pingCommand: CommandHandler<Record<string, never>, PingResult> = async (
  _command,
  context,
) => ({
  bridgeConnected: context.bridge.isConnected(),
});
