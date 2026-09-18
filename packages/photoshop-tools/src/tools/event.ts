import type { EventQuery, EventRecord, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Event 조회 Tool. (ROADMAP §15)
 *
 * MCP 에는 임의 이벤트를 클라이언트로 밀어주는 통로가 없다. LLM 은 구독하지 않고
 * **조회한다.** 마지막으로 본 `seq` 를 넘기면 그 이후 것만 받는다.
 */

export const EventRecentInputSchema = z
  .object({
    /** 이 일련번호보다 큰 것만. 폴링할 때 마지막으로 본 seq 를 넘긴다. */
    after: z.number().int().min(0).optional(),
    /** 이름 앞부분. `photoshop.` 이나 `command.` 처럼 쓴다. */
    prefix: z.string().trim().min(1).max(100).optional(),
    /** 최대 개수. 생략하면 50. */
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export type EventRecentInput = z.infer<typeof EventRecentInputSchema>;

/** 이벤트 조회에 필요한 최소 표면. `EventBus` 가 이 모양을 만족한다. */
export interface EventReader {
  recent(query: EventQuery): EventRecord[];
  readonly lastSeq: number;
}

/** `photoshop.event.recent` — 최근 이벤트 조회. */
export function createEventRecentTool(
  events: EventReader,
): ToolDefinition<EventRecentInput, unknown> {
  return {
    name: "photoshop.event.recent",
    description:
      "최근에 일어난 일을 조회한다. Photoshop 의 변화(`photoshop.*`)와 " +
      "Command 수명(`command.started` · `command.completed` · `command.failed`)이 담긴다. " +
      "반환된 lastSeq 를 다음 호출의 after 로 넘기면 새로 생긴 것만 받는다. " +
      "해석하지 못한 Photoshop 알림은 photoshop.unknown 으로 원본과 함께 기록된다. " +
      "**주의: Photoshop 27.8 에서는 photoshop.* 이벤트가 전달되지 않는다.** " +
      "command.* 만 신뢰할 수 있다.",
    permission: "read",
    inputSchema: EventRecentInputSchema,
    handler: (input) => {
      const records = events.recent({
        ...(input.after === undefined ? {} : { after: input.after }),
        ...(input.prefix === undefined ? {} : { prefix: input.prefix }),
        limit: input.limit ?? 50,
      });
      return Promise.resolve({
        events: records,
        /** 다음 폴링에 넘길 값. 조회 결과가 비어 있어도 알 수 있어야 한다. */
        lastSeq: events.lastSeq,
      });
    },
  };
}
