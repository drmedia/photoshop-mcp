import type { CommandHandler } from "@photoshop-mcp/command-engine";
import {
  BlendModeSchema,
  ErrorCode,
  LayerInfoSchema,
  PhotoshopMcpError,
} from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * ROADMAP §8.6 — 실기에서 드러난 공백을 메우는 Command.
 *
 * 기능 추가가 아니라 **이미 있는 기능이 쓸 수 없던 상태**를 고치는 것이다.
 * 선택 영역을 만들 수 없어 `mask.create({ from: "fromSelection" })` 이 죽은 코드였고,
 * 혼합 모드가 없어 비파괴 보정의 절반이 불가능했다.
 */

export const SELECTION_SET = "SELECTION_SET";
export const LAYER_BLEND_MODE = "LAYER_BLEND_MODE";
export const ADJUSTMENT_HUE_SATURATION = "ADJUSTMENT_HUE_SATURATION";
export const ADJUSTMENT_VIBRANCE = "ADJUSTMENT_VIBRANCE";

const TargetLayer = z.number().int().optional();
const AdjustmentName = z.string().trim().min(1).max(255).optional();

/** 픽셀 좌표. 문서 좌상단이 원점. */
const BoundsSchema = z
  .object({
    left: z.number().min(0),
    top: z.number().min(0),
    right: z.number().min(0),
    bottom: z.number().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.right <= value.left) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["right"],
        message: "right 는 left 보다 커야 합니다.",
      });
    }
    if (value.bottom <= value.top) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bottom"],
        message: "bottom 은 top 보다 커야 합니다.",
      });
    }
  });

export const SelectionSetParamsSchema = z
  .object({
    /**
     * 선택 영역 모양.
     *
     * - `rectangle` · `ellipse` — `bounds` 필요
     * - `canvas` — 문서 전체
     * - `layerTransparency` — 레이어의 불투명한 픽셀. `layerId` 로 대상 지정
     */
    shape: z.enum(["rectangle", "ellipse", "canvas", "layerTransparency"]),
    bounds: BoundsSchema.optional(),
    layerId: TargetLayer,
    /** 가장자리 페더(px). */
    feather: z.number().min(0).max(1000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsBounds = value.shape === "rectangle" || value.shape === "ellipse";
    if (needsBounds && value.bounds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bounds"],
        message: `${value.shape} 에는 bounds 가 필요합니다.`,
      });
    }
    if (!needsBounds && value.bounds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bounds"],
        message: `${value.shape} 에는 bounds 를 쓰지 않습니다.`,
      });
    }
  });

export const LayerBlendModeParamsSchema = z
  .object({
    layerId: TargetLayer,
    /**
     * 혼합 모드.
     *
     * `passThrough` 는 그룹 전용이라 여기서 받지 않는다. 그룹의 기본값이며
     * 일반 레이어에 주면 Photoshop 이 거부한다. 조회 결과에는 나타날 수 있다.
     */
    blendMode: BlendModeSchema.exclude(["passThrough"]),
  })
  .strict();

export const HueSaturationParamsSchema = z
  .object({
    /** -180 – 180. */
    hue: z.number().int().min(-180).max(180).optional(),
    /** -100 – 100. */
    saturation: z.number().int().min(-100).max(100).optional(),
    /** -100 – 100. */
    lightness: z.number().int().min(-100).max(100).optional(),
    name: AdjustmentName,
  })
  .strict();

export const VibranceParamsSchema = z
  .object({
    /** -100 – 100. 채도가 낮은 색을 우선 올린다. */
    vibrance: z.number().int().min(-100).max(100).optional(),
    /** -100 – 100. 전체 채도. */
    saturation: z.number().int().min(-100).max(100).optional(),
    name: AdjustmentName,
  })
  .strict();

export type SelectionSetParams = z.infer<typeof SelectionSetParamsSchema>;
export type LayerBlendModeParams = z.infer<typeof LayerBlendModeParamsSchema>;
export type HueSaturationParams = z.infer<typeof HueSaturationParamsSchema>;
export type VibranceParams = z.infer<typeof VibranceParamsSchema>;

export interface SelectionSetResult {
  hasSelection: boolean;
}

const SelectionSetResultSchema = z.object({ hasSelection: z.boolean() });

function forwardLayer<TParams>(): CommandHandler<TParams, LayerInfo> {
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

export const selectionSetCommand: CommandHandler<SelectionSetParams, SelectionSetResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = SelectionSetResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 스키마를 만족하지 않습니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};

export const layerBlendModeCommand = forwardLayer<LayerBlendModeParams>();
export const hueSaturationCommand = forwardLayer<HueSaturationParams>();
export const vibranceCommand = forwardLayer<VibranceParams>();
