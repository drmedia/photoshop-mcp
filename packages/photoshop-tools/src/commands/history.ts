import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 3 History. (ROADMAP §7.3)
 *
 * 복잡한 History 관리보다 Undo 1단계를 우선 지원한다.
 * History 상태 조회나 임의 지점 복원은 이후 Phase 에서 검토한다.
 */

export const HISTORY_UNDO = "HISTORY_UNDO";

export const HistoryUndoParamsSchema = z.object({}).strict();
export type HistoryUndoParams = z.infer<typeof HistoryUndoParamsSchema>;

export interface HistoryUndoResult {
  /** 되돌린 뒤의 현재 History 상태 이름. */
  currentState: string;
}

const HistoryUndoResultSchema = z.object({ currentState: z.string() });

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
