import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 실제 편집 워크플로를 시험하다 드러난 공백. (ROADMAP §17.8)
 *
 * 천체사진 보정 23단계를 LLM 시점으로 돌려 보니 Tool 이 없어 막히는 지점이 여덟
 * 군데였다. 여기 있는 것들은 그중 값이 큰 순서로 채운 것이다.
 *
 * 전부 Photoshop 네이티브 기능이며 외부 프로그램을 쓰지 않는다.
 */

export const ADJUSTMENT_COLOR_BALANCE = "ADJUSTMENT_COLOR_BALANCE";
export const LAYER_FROM_BACKGROUND = "LAYER_FROM_BACKGROUND";
export const FILTER_HIGH_PASS = "FILTER_HIGH_PASS";
export const FILTER_MINIMUM_MAXIMUM = "FILTER_MINIMUM_MAXIMUM";

/** `[cyan↔red, magenta↔green, yellow↔blue]`. 각 −100~100. */
const Levels = z.tuple([
  z.number().min(-100).max(100),
  z.number().min(-100).max(100),
  z.number().min(-100).max(100),
]);

export const ColorBalanceParams = z
  .object({
    shadows: Levels.optional(),
    midtones: Levels.optional(),
    highlights: Levels.optional(),
    /** 색을 옮기면서 밝기를 유지할지. 기본 `true`. */
    preserveLuminosity: z.boolean().optional(),
    name: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // 셋 다 비면 아무것도 바뀌지 않는다. 조용히 빈 조정 레이어를 만들면
    // 호출자는 색이 바뀐 줄 안다.
    if (
      value.shadows === undefined &&
      value.midtones === undefined &&
      value.highlights === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "shadows · midtones · highlights 중 하나는 있어야 합니다.",
        path: ["midtones"],
      });
    }
  });

export const LayerFromBackgroundParams = z
  .object({ name: z.string().trim().min(1).max(255).optional() })
  .strict();

export const HighPassParams = z
  .object({
    layerId: z.number().int().optional(),
    /** 0.1–1000 px. 선명화에는 보통 10–20. */
    radius: z.number().min(0.1).max(1000),
    asSmartFilter: z.boolean().optional(),
  })
  .strict();

export const MinimumMaximumParams = z
  .object({
    layerId: z.number().int().optional(),
    /** 0.1–100 px. 별 축소에는 0.3–0.5 수준. */
    radius: z.number().min(0.1).max(100),
    mode: z.enum(["minimum", "maximum"]),
    preserveShape: z.enum(["roundness", "squareness"]).optional(),
    asSmartFilter: z.boolean().optional(),
  })
  .strict();

function forward<TParams>(): CommandHandler<TParams, LayerInfo> {
  return async (command, context) => context.bridge.executeCommand<LayerInfo>(command);
}

export const adjustmentColorBalanceCommand = forward<z.infer<typeof ColorBalanceParams>>();
export const layerFromBackgroundCommand = forward<z.infer<typeof LayerFromBackgroundParams>>();
export const filterHighPassCommand = forward<z.infer<typeof HighPassParams>>();
export const filterMinimumMaximumCommand = forward<z.infer<typeof MinimumMaximumParams>>();
