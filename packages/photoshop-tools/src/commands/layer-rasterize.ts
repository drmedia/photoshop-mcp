import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_RASTERIZE` — 레이어를 픽셀로 굽는다. (CORE_API §5 P2)
 *
 * **`smart_object.rasterize` 가 아니라 `layer.rasterize` 다.** 실제 API 가
 * `Layer.rasterize(target)` 이고 스마트 오브젝트만의 일이 아니다 — 텍스트 ·
 * 모양 · 레이어 스타일도 같은 메서드로 굽는다.
 */

export const LAYER_RASTERIZE = "LAYER_RASTERIZE";

/**
 * `constants.RasterizeType` 열 가지 중 **여섯만** 연다.
 *
 * `linkedLayers` · `placed` · `video` · `layerClippingPath` 는 이 서버의
 * 쓰임과 멀다. 안 쓰는 값이 스키마에 있으면 호출자가 무엇이 중요한지 모른다.
 */
export const RasterizeTargetSchema = z.enum([
  "entireLayer",
  "layerStyle",
  "textContents",
  "shape",
  "vectorMask",
  "fillContent",
]);

export const LayerRasterizeParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
    /** 무엇을 구울지. 생략하면 `entireLayer`. */
    target: RasterizeTargetSchema.optional(),
  })
  .strict();

export type LayerRasterizeParams = z.infer<typeof LayerRasterizeParamsSchema>;

export const LayerRasterizeResultSchema = z.object({
  layer: LayerInfoSchema,
  /** 굽기 전 레이어 종류. 무엇이 사라졌는지 여기서 읽는다. */
  previousType: z.string(),
  /** 굽기 전 id. **바뀌었으면 결과의 `layer.id` 를 이어 쓴다.** */
  previousId: z.number().int(),
  target: RasterizeTargetSchema,
});

export type LayerRasterizeResult = z.infer<typeof LayerRasterizeResultSchema>;

export const layerRasterizeCommand: CommandHandler<
  LayerRasterizeParams,
  LayerRasterizeResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerRasterizeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
