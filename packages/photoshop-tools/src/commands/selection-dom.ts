import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * DOM `Selection` 을 쓰는 선택 조작. (CORE_API §5)
 *
 * 기존 선택 Command 는 전부 batchPlay 다. 그때는 DOM 에 없어서가 아니라
 * **확인하지 않았기 때문**이었다 — Adobe 레퍼런스에 `Selection` 클래스가
 * 있고(25.0+) 스물두 개 멤버가 적혀 있다. (ROADMAP §49)
 */

export const SELECTION_TRANSLATE_BOUNDARY = "SELECTION_TRANSLATE_BOUNDARY";
export const SELECTION_SCALE_BOUNDARY = "SELECTION_SCALE_BOUNDARY";
export const SELECTION_ROTATE_BOUNDARY = "SELECTION_ROTATE_BOUNDARY";
export const SELECTION_POLYGON = "SELECTION_POLYGON";

/** `canvas.resize` · `layer.scale` 과 같은 아홉 가지. */
export const SelectionAnchorSchema = z.enum([
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

/** `layer.scale` · `layer.rotate` 와 같은 여섯 가지. */
export const SelectionInterpolationSchema = z.enum([
  "automatic",
  "bicubic",
  "bicubicSharper",
  "bicubicSmoother",
  "bilinear",
  "nearestNeighbor",
]);

/** `constants.SelectionType` 네 가지. 이름은 호출자가 읽기 쉬운 쪽으로 바꿨다. */
export const SelectionModeSchema = z.enum(["replace", "add", "subtract", "intersect"]);

const BoundsSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
});

/** 넷이 같은 결과 모양을 쓴다. */
export const SelectionResultSchema = z.object({
  hasSelection: z.boolean(),
  bounds: BoundsSchema.nullable(),
});

export const SelectionBoundaryResultSchema = SelectionResultSchema.extend({
  /** 변형 전 경계. 무엇이 얼마나 움직였는지 견줄 수 있어야 한다. */
  before: BoundsSchema.nullable(),
  /** 실제로 쓴 기준점. 생략했으면 `null`. */
  anchor: SelectionAnchorSchema.nullable(),
});

export type SelectionResult = z.infer<typeof SelectionResultSchema>;
export type SelectionBoundaryResult = z.infer<typeof SelectionBoundaryResultSchema>;

export const SelectionTranslateBoundaryParamsSchema = z
  .object({
    /** 가로 이동(픽셀). 양수가 오른쪽. */
    deltaX: z.number().optional(),
    /** 세로 이동(픽셀). 양수가 아래. */
    deltaY: z.number().optional(),
  })
  .strict()
  /* 둘 다 없으면 아무 일도 안 하고 성공을 돌려주게 된다. */
  .refine((value) => value.deltaX !== undefined || value.deltaY !== undefined, {
    message: "deltaX 와 deltaY 중 최소 하나는 있어야 합니다.",
  });

export const SelectionScaleBoundaryParamsSchema = z
  .object({
    /** 가로 배율(**퍼센트**). 기본 100. */
    horizontal: z.number().positive().max(10000).optional(),
    /** 세로 배율(**퍼센트**). 기본 100. */
    vertical: z.number().positive().max(10000).optional(),
    anchor: SelectionAnchorSchema.optional(),
    interpolation: SelectionInterpolationSchema.optional(),
  })
  .strict()
  .refine((value) => value.horizontal !== undefined || value.vertical !== undefined, {
    message: "horizontal 과 vertical 중 최소 하나는 있어야 합니다.",
  });

export const SelectionRotateBoundaryParamsSchema = z
  .object({
    /** 각도(도). **시계 방향이 양수**라고 레퍼런스가 명시한다. */
    angle: z.number().min(-360).max(360),
    anchor: SelectionAnchorSchema.optional(),
    interpolation: SelectionInterpolationSchema.optional(),
  })
  .strict();

export const SelectionPolygonParamsSchema = z
  .object({
    /** 꼭짓점. 문서 픽셀 좌표이고 **셋 이상**이어야 면적이 있다. */
    points: z
      .array(z.object({ x: z.number(), y: z.number() }).strict())
      .min(3)
      .max(1000),
    mode: SelectionModeSchema.optional(),
    /** 가장자리 페더(픽셀). */
    feather: z.number().min(0).max(1000).optional(),
    antiAlias: z.boolean().optional(),
  })
  .strict();

export type SelectionTranslateBoundaryParams = z.infer<
  typeof SelectionTranslateBoundaryParamsSchema
>;
export type SelectionScaleBoundaryParams = z.infer<typeof SelectionScaleBoundaryParamsSchema>;
export type SelectionRotateBoundaryParams = z.infer<typeof SelectionRotateBoundaryParamsSchema>;
export type SelectionPolygonParams = z.infer<typeof SelectionPolygonParamsSchema>;

function forward<TParams, TResult>(schema: z.ZodType<TResult>): CommandHandler<TParams, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
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

export const selectionTranslateBoundaryCommand = forward<
  SelectionTranslateBoundaryParams,
  SelectionBoundaryResult
>(SelectionBoundaryResultSchema);
export const selectionScaleBoundaryCommand = forward<
  SelectionScaleBoundaryParams,
  SelectionBoundaryResult
>(SelectionBoundaryResultSchema);
export const selectionRotateBoundaryCommand = forward<
  SelectionRotateBoundaryParams,
  SelectionBoundaryResult
>(SelectionBoundaryResultSchema);
export const selectionPolygonCommand = forward<SelectionPolygonParams, SelectionResult>(
  SelectionResultSchema,
);
