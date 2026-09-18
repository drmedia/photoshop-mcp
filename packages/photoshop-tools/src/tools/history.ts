import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  HISTORY_UNDO,
  HistoryUndoParamsSchema,
  type HistoryUndoParams,
  type HistoryUndoResult,
} from "../commands/history.js";

/** Phase 3 History Tool. (ROADMAP §7.3) */
export function createHistoryUndoTool(
  engine: CommandEngine,
): ToolDefinition<HistoryUndoParams, HistoryUndoResult> {
  return {
    name: "photoshop.history.undo",
    description: "직전 작업을 한 단계 되돌린다.",
    permission: "edit",
    inputSchema: HistoryUndoParamsSchema,
    handler: async (input, context) =>
      engine.execute<HistoryUndoResult>(
        { type: HISTORY_UNDO, params: input },
        { requestId: context.requestId },
      ),
  };
}
