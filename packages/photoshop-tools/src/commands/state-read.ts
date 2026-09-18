import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 읽기 전용 상태 조회. (ROADMAP §16)
 *
 * MCP Resource (`photoshop://selection` · `photoshop://history`) 를 뒷받침한다.
 * 리소스를 만들면서 뒷받침할 데이터가 없다는 것을 알았다 — 선택 영역과 History 는
 * 바꾸는 Command 만 있고 읽는 Command 가 없었다.
 *
 * 데이터 없는 리소스를 만들지 않는다. 있는 척하면 호출자가 쓰다가 빈 것을 받는다.
 */

export const SELECTION_GET = "SELECTION_GET";
export const HISTORY_LIST = "HISTORY_LIST";

export const EmptyParams = z.object({}).strict();

export const SelectionStateSchema = z.object({
  hasSelection: z.boolean(),
  /** 선택 영역의 경계. 선택이 없거나 알 수 없으면 `null`. */
  bounds: z
    .object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
    .nullable(),
});

export const HistoryStateSchema = z.object({
  /**
   * History 항목. 오래된 것부터.
   *
   * Photoshop 은 되돌려도 목록이 줄지 않고 현재 지점만 움직인다.
   * 그래서 `currentIndex` 를 함께 준다. (Phase 3 실기에서 확인한 동작)
   */
  states: z.array(z.string()),
  currentIndex: z.number().int(),
  currentState: z.string(),
});

export type SelectionState = z.infer<typeof SelectionStateSchema>;
export type HistoryState = z.infer<typeof HistoryStateSchema>;

function forward<TResult>(
  schema: z.ZodType<TResult>,
): CommandHandler<Record<string, never>, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 스키마를 만족하지 않습니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

export const selectionGetCommand = forward<SelectionState>(SelectionStateSchema);
export const historyListCommand = forward<HistoryState>(HistoryStateSchema);
