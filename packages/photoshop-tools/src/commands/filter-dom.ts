import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * DOM `layer.apply*` 로 거는 필터. (ROADMAP §53)
 *
 * **레퍼런스를 먼저 봤다.** Adobe Layer 레퍼런스에 `apply*` 가 서른여덟 개
 * 있고(23.5+) descriptor 를 잡을 이유가 없다. 다만 **없는 것도 분명했다** —
 * `applySmartSharpen` · 표면 흐림 · 노이즈 감소는 목록에 없다.
 *
 * 범위는 Photoshop 대화상자의 슬라이더 범위다 — 눈에 보이는 값이고
 * descriptor 의미를 짐작한 것이 아니다.
 */

export const FILTER_SHARPEN = "FILTER_SHARPEN";
export const FILTER_UNSHARP_MASK = "FILTER_UNSHARP_MASK";
export const FILTER_MOTION_BLUR = "FILTER_MOTION_BLUR";
export const FILTER_DUST_AND_SCRATCHES = "FILTER_DUST_AND_SCRATCHES";

const Target = z.number().int().optional();
/** 기본은 픽셀 직접 적용이다 — 기존 필터와 같다. */
const SmartFilter = z.boolean().optional();

export const FilterSharpenParamsSchema = z
  .object({
    layerId: Target,
    /**
     * `sharpen`(기본) · `edges` · `more`.
     *
     * **셋 다 인자를 받지 않는다** — 레퍼런스의 `applySharpen` ·
     * `applySharpenEdges` · `applySharpenMore` 가 그렇다. 강도를 조절하려면
     * `filter.unsharp_mask` 쪽이다.
     */
    mode: z.enum(["sharpen", "edges", "more"]).optional(),
    asSmartFilter: SmartFilter,
  })
  .strict();

export const FilterUnsharpMaskParamsSchema = z
  .object({
    layerId: Target,
    /** 강도(%). 대화상자 범위는 1 ~ 500. */
    amount: z.number().min(1).max(500),
    /** 반경(px). 대화상자 범위는 0.1 ~ 1000. */
    radius: z.number().min(0.1).max(1000),
    /** 한계값(레벨). 0 ~ 255. **0 이면 노이즈까지 선명해진다.** */
    threshold: z.number().int().min(0).max(255).optional(),
    asSmartFilter: SmartFilter,
  })
  .strict();

export const FilterMotionBlurParamsSchema = z
  .object({
    layerId: Target,
    /** 각도(도). −360 ~ 360. */
    angle: z.number().min(-360).max(360),
    /** 거리(px). 대화상자 범위는 1 ~ 2000. */
    distance: z.number().min(1).max(2000),
    asSmartFilter: SmartFilter,
  })
  .strict();

export const FilterDustAndScratchesParamsSchema = z
  .object({
    layerId: Target,
    /** 반경(px). 대화상자 범위는 1 ~ 100. */
    radius: z.number().int().min(1).max(100),
    /** 한계값(레벨). 0 ~ 255. **0 이면 전체가 뭉개진다.** */
    threshold: z.number().int().min(0).max(255).optional(),
    asSmartFilter: SmartFilter,
  })
  .strict();

export type FilterSharpenParams = z.infer<typeof FilterSharpenParamsSchema>;
export type FilterUnsharpMaskParams = z.infer<typeof FilterUnsharpMaskParamsSchema>;
export type FilterMotionBlurParams = z.infer<typeof FilterMotionBlurParamsSchema>;
export type FilterDustAndScratchesParams = z.infer<typeof FilterDustAndScratchesParamsSchema>;

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

export const filterSharpenCommand = forwardLayer<FilterSharpenParams>();
export const filterUnsharpMaskCommand = forwardLayer<FilterUnsharpMaskParams>();
export const filterMotionBlurCommand = forwardLayer<FilterMotionBlurParams>();
export const filterDustAndScratchesCommand = forwardLayer<FilterDustAndScratchesParams>();
