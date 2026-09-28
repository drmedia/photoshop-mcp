import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 가이드. (ROADMAP §59)
 *
 * **전부 DOM 이다** — `document.guides`(23.0+) 와 `Guide` 클래스로 다 된다.
 */

export const GUIDE_LIST = "GUIDE_LIST";
export const GUIDE_CREATE = "GUIDE_CREATE";
export const GUIDE_DELETE = "GUIDE_DELETE";

export const GuideInfoSchema = z.object({
  index: z.number().int(),
  id: z.number().nullable(),
  /** `horizontal` · `vertical`. 못 읽으면 `null` 이고 `rawDirection` 에 원본이 있다. */
  direction: z.string().nullable(),
  rawDirection: z.string().optional(),
  /** 눈금자 원점에서의 위치(픽셀). 소수가 올 수 있다. */
  coordinate: z.number().nullable(),
});

export const GuideListResultSchema = z.object({ guides: z.array(GuideInfoSchema) });
export const GuideDeleteResultSchema = z.object({
  deleted: GuideInfoSchema,
  remaining: z.number().int(),
});

export type GuideInfo = z.infer<typeof GuideInfoSchema>;
export type GuideListResult = z.infer<typeof GuideListResultSchema>;
export type GuideDeleteResult = z.infer<typeof GuideDeleteResultSchema>;

export const GuideListParamsSchema = z.object({}).strict();

export const GuideCreateParamsSchema = z
  .object({
    direction: z.enum(["horizontal", "vertical"]),
    /**
     * 눈금자 원점에서의 위치(픽셀).
     *
     * **캔버스 좌표가 아니다** — 사용자가 눈금자 원점을 옮겼으면 어긋난다.
     * 음수도 캔버스 밖도 Photoshop 이 받으므로 막지 않는다.
     */
    coordinate: z.number().min(-300000).max(300000),
  })
  .strict();

export const GuideDeleteParamsSchema = z
  .object({
    /** `guide.list` 의 순서. **지울 때마다 밀린다.** */
    index: z.number().int().min(0).max(9999).optional(),
    /**
     * `guide.list` 의 `id`.
     *
     * **색인과 달리 안정적이다** — 실기에서 하나를 지우니 뒤의 색인이 밀렸다.
     * 여러 개를 지울 때는 이쪽이 안전하다. (ROADMAP §59)
     */
    id: z.number().int().optional(),
  })
  .strict()
  .refine((value) => (value.index === undefined) !== (value.id === undefined), {
    message: "index 와 id 중 정확히 하나를 줍니다.",
  });

export type GuideListParams = z.infer<typeof GuideListParamsSchema>;
export type GuideCreateParams = z.infer<typeof GuideCreateParamsSchema>;
export type GuideDeleteParams = z.infer<typeof GuideDeleteParamsSchema>;

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

export const guideListCommand = forward<GuideListParams, GuideListResult>(
  GuideListResultSchema,
  "가이드 목록",
);
export const guideCreateCommand = forward<GuideCreateParams, GuideInfo>(
  GuideInfoSchema,
  "가이드 만들기",
);
export const guideDeleteCommand = forward<GuideDeleteParams, GuideDeleteResult>(
  GuideDeleteResultSchema,
  "가이드 삭제",
);
