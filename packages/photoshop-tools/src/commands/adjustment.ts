import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 4 조정 Command. (ROADMAP §8.3)
 *
 * 픽셀을 직접 바꾸지 않고 **조정 레이어**를 만든다. 비파괴 방식이며
 * ROADMAP 이 "가능하면 Adjustment Layer 방식 우선" 으로 정해둔 바다.
 *
 * Plugin 은 이 파라미터로 batchPlay descriptor 를 조립한다.
 * LLM 이 descriptor 를 직접 만들지 않으므로 ARCHITECTURE §23 에 어긋나지 않는다.
 */

export const ADJUSTMENT_CURVES = "ADJUSTMENT_CURVES";
export const ADJUSTMENT_LEVELS = "ADJUSTMENT_LEVELS";
export const ADJUSTMENT_BRIGHTNESS_CONTRAST = "ADJUSTMENT_BRIGHTNESS_CONTRAST";

/** 적용 채널. 생략하면 합성 채널(RGB 전체). */
export const ChannelSchema = z.enum(["composite", "red", "green", "blue"]);
export type AdjustmentChannel = z.infer<typeof ChannelSchema>;

/** 조정 레이어 이름. 생략하면 Photoshop 기본 이름. */
const AdjustmentName = z.string().trim().min(1).max(255).optional();

const CurvePointSchema = z.object({
  /** 입력 밝기 0–255. */
  input: z.number().min(0).max(255),
  /** 출력 밝기 0–255. */
  output: z.number().min(0).max(255),
});

export type CurvePoint = z.infer<typeof CurvePointSchema>;

export const CurvesParamsSchema = z
  .object({
    channel: ChannelSchema.optional(),
    /**
     * 곡선 제어점. 최소 2개(양 끝), 최대 16개.
     *
     * Photoshop 의 곡선 편집과 같은 표현이다. 중간톤 대비를 올리려면
     * 어두운 쪽을 내리고 밝은 쪽을 올리는 S 자 점을 넣는다.
     */
    points: z.array(CurvePointSchema).min(2).max(16),
    name: AdjustmentName,
  })
  .strict()
  .superRefine((value, ctx) => {
    // 입력값은 오름차순이고 중복될 수 없다. Photoshop 이 거부하기 전에 막는다.
    for (let i = 1; i < value.points.length; i += 1) {
      const previous = value.points[i - 1];
      const current = value.points[i];
      if (previous === undefined || current === undefined) {
        continue;
      }
      if (current.input <= previous.input) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["points", i, "input"],
          message: "제어점의 input 은 오름차순이어야 하며 중복될 수 없습니다.",
        });
      }
    }
  });

export const LevelsParamsSchema = z
  .object({
    channel: ChannelSchema.optional(),
    /** 입력 검은점 0–253. */
    inputShadow: z.number().int().min(0).max(253).optional(),
    /** 입력 흰점 2–255. `inputShadow` 보다 커야 한다. */
    inputHighlight: z.number().int().min(2).max(255).optional(),
    /** 중간톤 감마 0.1–9.99. 1 이 기본. */
    gamma: z.number().min(0.1).max(9.99).optional(),
    /** 출력 검은점 0–255. */
    outputShadow: z.number().int().min(0).max(255).optional(),
    /** 출력 흰점 0–255. */
    outputHighlight: z.number().int().min(0).max(255).optional(),
    name: AdjustmentName,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.inputShadow !== undefined &&
      value.inputHighlight !== undefined &&
      value.inputShadow >= value.inputHighlight
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputHighlight"],
        message: "inputHighlight 는 inputShadow 보다 커야 합니다.",
      });
    }
  });

export const BrightnessContrastParamsSchema = z
  .object({
    /** -150 – 150. 0 이 기본. */
    brightness: z.number().int().min(-150).max(150).optional(),
    /** -50 – 100. 0 이 기본. */
    contrast: z.number().int().min(-50).max(100).optional(),
    name: AdjustmentName,
  })
  .strict();

export type CurvesParams = z.infer<typeof CurvesParamsSchema>;
export type LevelsParams = z.infer<typeof LevelsParamsSchema>;
export type BrightnessContrastParams = z.infer<typeof BrightnessContrastParamsSchema>;

/** Bridge 로 전달하고 결과(만들어진 조정 레이어)를 검증한다. */
function forward<TParams>(): CommandHandler<TParams, LayerInfo> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = LayerInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 레이어 스키마를 만족하지 않습니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

export const curvesCommand = forward<CurvesParams>();
export const levelsCommand = forward<LevelsParams>();
export const brightnessContrastCommand = forward<BrightnessContrastParams>();
