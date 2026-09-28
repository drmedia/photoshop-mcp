import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 레이어 변환 셋. (CORE_API §5)
 *
 * **단위는 Adobe 레퍼런스의 예제 코드가 답을 준다.** 타입 서명만 보면
 * `number | PercentValue | PixelValue` 라 알 수 없다.
 *
 * ```text
 * translate(-200, 0)   맨 숫자는 픽셀
 * scale(80, 80)        맨 숫자는 퍼센트
 * rotate(-90)          맨 숫자는 도
 * ```
 */

export const LAYER_TRANSLATE = "LAYER_TRANSLATE";
export const LAYER_SCALE = "LAYER_SCALE";
export const LAYER_ROTATE = "LAYER_ROTATE";

/** `canvas.resize` 와 같은 아홉 가지. */
export const TransformAnchorSchema = z.enum([
  "topLeft",
  "topCenter",
  "topRight",
  "middleLeft",
  "middleCenter",
  "middleRight",
  "bottomLeft",
  "bottomCenter",
  "bottomRight",
]);

/** `constants.InterpolationMethod` 여섯 가지. */
export const InterpolationSchema = z.enum([
  "automatic",
  "bicubic",
  "bicubicSharper",
  "bicubicSmoother",
  "bilinear",
  "nearestNeighbor",
]);

const TargetLayer = z.number().int().positive().optional();

export const LayerTranslateParamsSchema = z
  .object({
    layerId: TargetLayer,
    /** 가로 이동(픽셀). 양수가 오른쪽. */
    horizontal: z.number().optional(),
    /** 세로 이동(픽셀). 양수가 아래. */
    vertical: z.number().optional(),
  })
  .strict()
  /* 둘 다 없으면 아무 일도 안 하고 성공을 돌려주게 된다. */
  .refine((value) => value.horizontal !== undefined || value.vertical !== undefined, {
    message: "horizontal 과 vertical 중 최소 하나는 있어야 합니다.",
  });

export const LayerScaleParamsSchema = z
  .object({
    layerId: TargetLayer,
    /** 가로 배율(**퍼센트**). 100 이 제자리. */
    width: z.number().positive().max(10000),
    /** 세로 배율(**퍼센트**). */
    height: z.number().positive().max(10000),
    anchor: TransformAnchorSchema.optional(),
    interpolation: InterpolationSchema.optional(),
  })
  .strict();

export const LayerRotateParamsSchema = z
  .object({
    layerId: TargetLayer,
    /** 각도(도). */
    angle: z.number().min(-360).max(360),
    anchor: TransformAnchorSchema.optional(),
    interpolation: InterpolationSchema.optional(),
  })
  .strict();

export type LayerTranslateParams = z.infer<typeof LayerTranslateParamsSchema>;
export type LayerScaleParams = z.infer<typeof LayerScaleParamsSchema>;
export type LayerRotateParams = z.infer<typeof LayerRotateParamsSchema>;

const BoundsSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  width: z.number(),
  height: z.number(),
});

/**
 * 셋이 같은 모양을 돌려준다.
 *
 * **무엇이 얼마나 움직였는지가 경계에 드러난다** — `flip` 과 달리 여기서는
 * 경계가 실제로 바뀐다. 요청과 실제를 호출자가 스스로 견준다.
 */
export const LayerTransformResultSchema = z.object({
  layer: LayerInfoSchema,
  before: BoundsSchema.nullable(),
  after: BoundsSchema.nullable(),
  /** 실제로 쓴 기준점. 생략했으면 `null`. */
  anchor: TransformAnchorSchema.nullable(),
});

export type LayerTransformResult = z.infer<typeof LayerTransformResultSchema>;

function forward<TParams>(): CommandHandler<TParams, LayerTransformResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = LayerTransformResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 예상과 다릅니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

export const layerTranslateCommand = forward<LayerTranslateParams>();
export const layerScaleCommand = forward<LayerScaleParams>();
export const layerRotateCommand = forward<LayerRotateParams>();
