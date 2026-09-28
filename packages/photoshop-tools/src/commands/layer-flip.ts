import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_FLIP` — 레이어를 뒤집는다. (CORE_API §5 P2)
 *
 * **Tool 을 둘로 나누지 않았다.** DOM 이 `flip(axis)` 하나이고 축이 셋이다 —
 * `flip_horizontal` / `flip_vertical` 로 나누면 `both` 를 쓸 수 없다.
 */

export const LAYER_FLIP = "LAYER_FLIP";

/** `constants.FlipAxis` 의 셋. */
export const FlipAxisSchema = z.enum(["horizontal", "vertical", "both"]);

export const LayerFlipParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
    axis: FlipAxisSchema,
  })
  .strict();

export type LayerFlipParams = z.infer<typeof LayerFlipParamsSchema>;

const BoundsSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  width: z.number(),
  height: z.number(),
});

export const LayerFlipResultSchema = z.object({
  layer: LayerInfoSchema,
  axis: FlipAxisSchema,
  /**
   * 뒤집기 전후 경계.
   *
   * **경계로는 뒤집혔는지 알 수 없다** — 레이어 자기 경계 안에서 뒤집히면
   * 그대로다. 값을 담되 "바뀌었으니 성공" 이라고 말하지 않는다.
   */
  before: BoundsSchema.nullable(),
  after: BoundsSchema.nullable(),
});

export type LayerFlipResult = z.infer<typeof LayerFlipResultSchema>;

export const layerFlipCommand: CommandHandler<LayerFlipParams, LayerFlipResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerFlipResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
