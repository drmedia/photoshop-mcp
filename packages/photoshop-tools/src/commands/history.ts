import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 3 History. (ROADMAP §7.3)
 *
 * Undo · Redo 를 1단계씩 지원한다. 임의 지점 복원은 넣지 않았다 — 이름으로
 * 지점을 고르게 하면 같은 이름이 여러 개일 때 어디로 갈지 알 수 없다.
 */

export const HISTORY_UNDO = "HISTORY_UNDO";
export const HISTORY_REDO = "HISTORY_REDO";

export const HistoryUndoParamsSchema = z.object({}).strict();
export type HistoryUndoParams = z.infer<typeof HistoryUndoParamsSchema>;
export const HistoryRedoParamsSchema = z.object({}).strict();
export type HistoryRedoParams = z.infer<typeof HistoryRedoParamsSchema>;

export interface HistoryUndoResult {
  /** 되돌린 뒤의 현재 History 상태 이름. */
  currentState: string;
}

/** Undo 와 Redo 의 결과 모양은 같다 — 둘을 따로 배우게 하지 않는다. */
const HistoryUndoResultSchema = z.object({ currentState: z.string() });

/** `HISTORY_REDO` 의 결과. */
export type HistoryRedoResult = HistoryUndoResult;

/**
 * Undo 를 1단계 수행한다.
 *
 * 되돌릴 것이 없으면 Plugin 이 `HISTORY_EMPTY` 로 실패한다.
 * 그 자체는 오류지만 복구 가능한 상황이다.
 */
export const historyUndoCommand: CommandHandler<HistoryUndoParams, HistoryUndoResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = HistoryUndoResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 스키마를 만족하지 않습니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};

/**
 * Redo 를 1단계 수행한다.
 *
 * 다시 실행할 것이 없으면 Plugin 이 `HISTORY_EMPTY` 로 실패한다. **되돌린 뒤
 * 새로 편집하면 Photoshop 이 앞쪽 이력을 버리므로** 그때도 여기로 온다.
 */
export const historyRedoCommand: CommandHandler<HistoryRedoParams, HistoryRedoResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = HistoryUndoResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 스키마를 만족하지 않습니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
