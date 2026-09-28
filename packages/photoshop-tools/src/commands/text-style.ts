import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 텍스트 세부 — 자간 · 행간 · 단락 · 워프 · 변환. (ROADMAP §60)
 *
 * **전부 DOM 이다** — `TextItem`(24.1+) 의 `characterStyle` ·
 * `paragraphStyle` · `warpStyle` 과 변환 메서드 셋으로 다 된다.
 *
 * **단위가 레퍼런스에 적혀 있다.** `tracking` 은 **1/1000 em**, `leading` ·
 * 들여쓰기 · 문단 간격은 **72ppi 기준 픽셀**이다.
 */

export const TEXT_GET = "TEXT_GET";
export const TEXT_SET_TRACKING = "TEXT_SET_TRACKING";
export const TEXT_SET_LEADING = "TEXT_SET_LEADING";
export const TEXT_SET_PARAGRAPH = "TEXT_SET_PARAGRAPH";
export const TEXT_WARP = "TEXT_WARP";
export const TEXT_CONVERT_TO_POINT = "TEXT_CONVERT_TO_POINT";
export const TEXT_CONVERT_TO_PARAGRAPH = "TEXT_CONVERT_TO_PARAGRAPH";
export const TEXT_CONVERT_TO_SHAPE = "TEXT_CONVERT_TO_SHAPE";

const TargetLayer = z.number().int().positive().optional();

export const TextDetailSchema = z.object({
  layer: LayerInfoSchema,
  contents: z.string().nullable(),
  isPointText: z.boolean().nullable(),
  isParagraphText: z.boolean().nullable(),
  orientation: z.string().nullable(),
  clickPoint: z.object({ x: z.number(), y: z.number() }).nullable(),
  character: z.object({
    font: z.string().nullable(),
    size: z.number().nullable(),
    /** 72ppi 기준 픽셀. `useAutoLeading` 이 켜져 있으면 의미가 없다. */
    leading: z.number().nullable(),
    useAutoLeading: z.boolean().nullable(),
    /** **1/1000 em** 이다. */
    tracking: z.number().nullable(),
    baselineShift: z.number().nullable(),
    horizontalScale: z.number().nullable(),
    verticalScale: z.number().nullable(),
    fauxBold: z.boolean().nullable(),
    fauxItalic: z.boolean().nullable(),
  }),
  paragraph: z.object({
    justification: z.string().nullable(),
    firstLineIndent: z.number().nullable(),
    leftIndent: z.number().nullable(),
    rightIndent: z.number().nullable(),
    spaceBefore: z.number().nullable(),
    spaceAfter: z.number().nullable(),
    hyphenation: z.boolean().nullable(),
  }),
  warp: z.object({
    style: z.string().nullable(),
    bend: z.number().nullable(),
    horizontalDistortion: z.number().nullable(),
    verticalDistortion: z.number().nullable(),
    direction: z.string().nullable(),
  }),
});

export const TextShapeResultSchema = z.object({
  layer: LayerInfoSchema,
  previousType: z.string(),
});

export type TextDetail = z.infer<typeof TextDetailSchema>;
export type TextShapeResult = z.infer<typeof TextShapeResultSchema>;

export const TextTargetParamsSchema = z.object({ layerId: TargetLayer }).strict();

export const TextSetTrackingParamsSchema = z
  .object({
    layerId: TargetLayer,
    /** **1/1000 em.** 레퍼런스 범위는 −1000 ~ 1000. */
    tracking: z.number().min(-1000).max(1000),
  })
  .strict();

export const TextSetLeadingParamsSchema = z
  .object({
    layerId: TargetLayer,
    /** 72ppi 기준 픽셀. 레퍼런스 범위는 0 ~ 4999.99. */
    leading: z.number().min(0).max(4999.99).optional(),
    /**
     * 자동 행간.
     *
     * **켜져 있으면 `leading` 을 넣어도 화면이 안 바뀐다** — 그래서 `leading`
     * 만 주면 플러그인이 먼저 끈다.
     */
    auto: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.leading !== undefined || value.auto !== undefined, {
    message: "leading 과 auto 중 최소 하나는 있어야 합니다.",
  });

/** 레퍼런스의 `Justification` 일곱. */
export const JustificationSchema = z.enum([
  "left",
  "center",
  "right",
  "leftJustified",
  "centerJustified",
  "rightJustified",
  "fullyJustified",
]);

/** 들여쓰기·간격은 전부 72ppi 기준 픽셀, 범위 −1296 ~ 1296. */
const Spacing = z.number().min(-1296).max(1296).optional();

export const TextSetParagraphParamsSchema = z
  .object({
    layerId: TargetLayer,
    justification: JustificationSchema.optional(),
    firstLineIndent: Spacing,
    leftIndent: Spacing,
    rightIndent: Spacing,
    spaceBefore: Spacing,
    spaceAfter: Spacing,
    hyphenation: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.keys(value).some((key) => key !== "layerId" && value[key as never] !== undefined),
    { message: "바꿀 항목을 최소 하나는 줍니다." },
  );

/** 레퍼런스의 `WarpStyle` 열여섯. */
export const WarpStyleSchema = z.enum([
  "none",
  "arc",
  "arcLower",
  "arcUpper",
  "arch",
  "bulge",
  "shellLower",
  "shellUpper",
  "flag",
  "wave",
  "fish",
  "rise",
  "fishEye",
  "inflate",
  "squeeze",
  "twist",
]);

export const TextWarpParamsSchema = z
  .object({
    layerId: TargetLayer,
    /** `none` 을 주면 워프를 푼다. */
    style: WarpStyleSchema,
    /** 휘는 정도(%). −100 ~ 100. */
    bend: z.number().min(-100).max(100).optional(),
    horizontalDistortion: z.number().min(-100).max(100).optional(),
    verticalDistortion: z.number().min(-100).max(100).optional(),
    direction: z.enum(["horizontal", "vertical"]).optional(),
  })
  .strict();

export type TextTargetParams = z.infer<typeof TextTargetParamsSchema>;
export type TextSetTrackingParams = z.infer<typeof TextSetTrackingParamsSchema>;
export type TextSetLeadingParams = z.infer<typeof TextSetLeadingParamsSchema>;
export type TextSetParagraphParams = z.infer<typeof TextSetParagraphParamsSchema>;
export type TextWarpParams = z.infer<typeof TextWarpParamsSchema>;

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

export const textGetCommand = forward<TextTargetParams, TextDetail>(
  TextDetailSchema,
  "텍스트 조회",
);
export const textSetTrackingCommand = forward<TextSetTrackingParams, TextDetail>(
  TextDetailSchema,
  "자간",
);
export const textSetLeadingCommand = forward<TextSetLeadingParams, TextDetail>(
  TextDetailSchema,
  "행간",
);
export const textSetParagraphCommand = forward<TextSetParagraphParams, TextDetail>(
  TextDetailSchema,
  "단락",
);
export const textWarpCommand = forward<TextWarpParams, TextDetail>(TextDetailSchema, "워프");
export const textConvertToPointCommand = forward<TextTargetParams, TextDetail>(
  TextDetailSchema,
  "점 텍스트로 변환",
);
export const textConvertToParagraphCommand = forward<TextTargetParams, TextDetail>(
  TextDetailSchema,
  "단락 텍스트로 변환",
);
export const textConvertToShapeCommand = forward<TextTargetParams, TextShapeResult>(
  TextShapeResultSchema,
  "모양으로 변환",
);
