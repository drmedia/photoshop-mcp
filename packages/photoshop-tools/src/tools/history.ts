import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  HISTORY_REDO,
  HISTORY_UNDO,
  HistoryRedoParamsSchema,
  HistoryUndoParamsSchema,
  type HistoryRedoParams,
  type HistoryRedoResult,
  type HistoryUndoParams,
  type HistoryUndoResult,
} from "../commands/history.js";

/** Phase 3 History Tool. (ROADMAP §7.3) */
export function createHistoryUndoTool(
  engine: CommandEngine,
): ToolDefinition<HistoryUndoParams, HistoryUndoResult> {
  return {
    name: "photoshop.history.undo",
    description:
      "직전 작업을 한 단계 되돌린다. 결과의 currentState 는 되돌린 뒤의 이력 지점 " +
      "이름이다. 되돌릴 것이 없으면 실패한다. photoshop.history.redo 로 다시 실행한다.",
    permission: "edit",
    inputSchema: HistoryUndoParamsSchema,
    handler: async (input, context) =>
      engine.execute<HistoryUndoResult>(
        { type: HISTORY_UNDO, params: input },
        { requestId: context.requestId },
      ),
  };
}

/**
 * `photoshop.history.redo` — 한 단계 다시 실행한다.
 *
 * `undo` 의 거울이다. 결과 모양이 같아 둘을 따로 배우지 않아도 된다.
 */
export function createHistoryRedoTool(
  engine: CommandEngine,
): ToolDefinition<HistoryRedoParams, HistoryRedoResult> {
  return {
    name: "photoshop.history.redo",
    description:
      "되돌린 작업을 한 단계 다시 실행한다. photoshop.history.undo 의 거울이고 " +
      "결과 모양도 같다 — currentState 는 옮긴 뒤의 이력 지점 이름이다. " +
      "**되돌린 뒤 새로 편집하면 다시 실행할 것이 사라진다** — Photoshop 이 앞쪽 " +
      "이력을 버리기 때문이고 이 Tool 의 제약이 아니다. 그때는 실패로 답한다. " +
      "이미 가장 최근 상태여도 실패한다 — 아무 일도 안 하고 성공을 돌려주면 " +
      "호출자가 한 단계 갔다고 믿는다.",
    permission: "edit",
    inputSchema: HistoryRedoParamsSchema,
    handler: async (input, context) =>
      engine.execute<HistoryRedoResult>(
        { type: HISTORY_REDO, params: input },
        { requestId: context.requestId },
      ),
  };
}
