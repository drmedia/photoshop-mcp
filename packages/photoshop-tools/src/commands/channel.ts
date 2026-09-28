import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 채널. (ROADMAP §56)
 *
 * **전부 DOM 이다.** `Channels` 컬렉션과 `Channel` 클래스, 그리고 읽기/쓰기인
 * `document.activeChannels` 로 다 된다 — batchPlay 를 한 줄도 쓰지 않는다.
 *
 * `channel.load_as_selection` 은 만들지 않았다. `selection.load_channel` 이
 * 이미 한다.
 */

export const CHANNEL_LIST = "CHANNEL_LIST";
export const CHANNEL_GET = "CHANNEL_GET";
export const CHANNEL_CREATE = "CHANNEL_CREATE";
export const CHANNEL_SELECT = "CHANNEL_SELECT";
export const CHANNEL_DUPLICATE = "CHANNEL_DUPLICATE";
export const CHANNEL_DELETE = "CHANNEL_DELETE";

const ChannelName = z.string().trim().min(1).max(255);

export const ChannelInfoSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  /** 색 성분 채널(R·G·B 등)인지. 알파 채널과 가르는 기준이다. */
  isComponent: z.boolean(),
  /** 못 읽으면 `null` 이고 `rawKind` 에 원본이 있다. */
  kind: z.string().nullable(),
  rawKind: z.string().optional(),
  visible: z.boolean().nullable(),
  opacity: z.number().nullable(),
});

export const ChannelDetailSchema = ChannelInfoSchema.extend({
  /** 256칸. 요청했고 읽혔을 때만 값이 있다. */
  histogram: z.array(z.number()).nullable(),
});

export const ChannelListResultSchema = z.object({ channels: z.array(ChannelInfoSchema) });
export const ChannelSelectResultSchema = z.object({ active: z.array(z.string()) });
export const ChannelDeleteResultSchema = z.object({
  deleted: z.string(),
  remaining: z.number().int(),
});

export type ChannelInfo = z.infer<typeof ChannelInfoSchema>;
export type ChannelDetail = z.infer<typeof ChannelDetailSchema>;
export type ChannelListResult = z.infer<typeof ChannelListResultSchema>;
export type ChannelSelectResult = z.infer<typeof ChannelSelectResultSchema>;
export type ChannelDeleteResult = z.infer<typeof ChannelDeleteResultSchema>;

export const ChannelListParamsSchema = z.object({}).strict();

/** 이름 **또는** 색인. 둘 다 주거나 둘 다 없으면 거절한다. */
const TargetSchema = {
  name: ChannelName.optional(),
  index: z.number().int().min(0).max(56).optional(),
};
const requireOneTarget = (value: { name?: string; index?: number }): boolean =>
  (value.name === undefined) !== (value.index === undefined);
const targetMessage = { message: "name 과 index 중 정확히 하나를 줍니다." };

export const ChannelGetParamsSchema = z
  .object({
    ...TargetSchema,
    /**
     * 256칸 히스토그램을 함께 받는다.
     *
     * 기본은 끔이다 — 모든 조회에 256개 숫자가 따라오면 목록을 읽기 어렵다.
     */
    histogram: z.boolean().optional(),
  })
  .strict()
  .refine(requireOneTarget, targetMessage);

export const ChannelCreateParamsSchema = z.object({ name: ChannelName.optional() }).strict();

export const ChannelSelectParamsSchema = z
  .object({
    /** 활성으로 만들 채널 이름들. 순서대로 담긴다. */
    names: z.array(ChannelName).min(1).max(56),
  })
  .strict();

export const ChannelDuplicateParamsSchema = z
  .object(TargetSchema)
  .strict()
  .refine(requireOneTarget, targetMessage);

export const ChannelDeleteParamsSchema = z
  .object(TargetSchema)
  .strict()
  .refine(requireOneTarget, targetMessage);

export type ChannelListParams = z.infer<typeof ChannelListParamsSchema>;
export type ChannelGetParams = z.infer<typeof ChannelGetParamsSchema>;
export type ChannelCreateParams = z.infer<typeof ChannelCreateParamsSchema>;
export type ChannelSelectParams = z.infer<typeof ChannelSelectParamsSchema>;
export type ChannelDuplicateParams = z.infer<typeof ChannelDuplicateParamsSchema>;
export type ChannelDeleteParams = z.infer<typeof ChannelDeleteParamsSchema>;

function forward<TParams, TResult>(
  schema: z.ZodType<TResult>,
  label: string,
): CommandHandler<TParams, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
        details: { issues: parsed.error.issues, received: raw },
        cause: parsed.error,
      });
    }
    return parsed.data;
  };
}

export const channelListCommand = forward<ChannelListParams, ChannelListResult>(
  ChannelListResultSchema,
  "채널 목록",
);
export const channelGetCommand = forward<ChannelGetParams, ChannelDetail>(
  ChannelDetailSchema,
  "채널 조회",
);
export const channelCreateCommand = forward<ChannelCreateParams, ChannelInfo>(
  ChannelInfoSchema,
  "채널 만들기",
);
export const channelSelectCommand = forward<ChannelSelectParams, ChannelSelectResult>(
  ChannelSelectResultSchema,
  "채널 선택",
);
export const channelDuplicateCommand = forward<ChannelDuplicateParams, ChannelInfo>(
  ChannelInfoSchema,
  "채널 복제",
);
export const channelDeleteCommand = forward<ChannelDeleteParams, ChannelDeleteResult>(
  ChannelDeleteResultSchema,
  "채널 삭제",
);
