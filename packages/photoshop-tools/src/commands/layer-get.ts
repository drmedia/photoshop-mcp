import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { LayerInfoSchema } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_GET` — 레이어 하나의 상세. (CORE_API §5 P1)
 *
 * `layer.list` 는 레이어마다 한 줄이라 **경계를 담지 않는다.** 실기에서 가장
 * 아쉬웠던 것이 그것이었다 — 외부 처리기가 돌려준 레이어가 135px 위로
 * 밀렸는데 확인할 방법이 없어 가로 띠를 여러 번 재서 알아냈다(ROADMAP §28).
 */

export const LAYER_GET = "LAYER_GET";

export const LayerGetParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. 다른 편집 Tool 과 같은 규칙이다. */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type LayerGetParams = z.infer<typeof LayerGetParamsSchema>;

const BoundsSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  width: z.number(),
  height: z.number(),
});

/**
 * **못 읽은 것은 `null` 이다.**
 *
 * 버전에 따라 없는 속성이 있고, 없는 것을 `0` 이나 `false` 로 채우면 틀린
 * 사실을 말하게 된다 — `isBackground` · `rawBitDepth` 와 같은 원칙이다.
 */
export const LayerDetailSchema = z.object({
  layer: LayerInfoSchema,
  /** 효과를 포함한 경계. 네 값을 모두 읽었을 때만 담긴다. */
  bounds: BoundsSchema.nullable(),
  boundsNoEffects: BoundsSchema.nullable(),
  /** 무엇이든 잠겼는지. */
  locked: z.boolean().nullable(),
  /** 전부 잠겼는지. */
  allLocked: z.boolean().nullable(),
  isClippingMask: z.boolean().nullable(),
  /** 0–100. `opacity` 와 다르다 — 효과는 남기고 픽셀만 투명해진다. */
  fillOpacity: z.number().nullable(),
});

export type LayerDetail = z.infer<typeof LayerDetailSchema>;

export const layerGetCommand: CommandHandler<LayerGetParams, LayerDetail> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerDetailSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `레이어 상세가 예상과 다릅니다: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  return parsed.data;
};
