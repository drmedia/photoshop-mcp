import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
// 선택 영역 상태는 이미 정의되어 있다. 같은 모양을 두 번 적지 않는다.
import type { SelectionState } from "./state-read.js";

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

export const SELECTION_SAVE_CHANNEL = "SELECTION_SAVE_CHANNEL";
export const SELECTION_LOAD_CHANNEL = "SELECTION_LOAD_CHANNEL";
export const SELECTION_MODIFY = "SELECTION_MODIFY";
export const SELECTION_COLOR_RANGE = "SELECTION_COLOR_RANGE";
export const LAYER_STAMP_VISIBLE = "LAYER_STAMP_VISIBLE";

/** 알파 채널 이름. 경로 구분자를 막을 이유는 없지만 길이는 제한한다. */
const ChannelName = z.string().trim().min(1).max(64);

export const SaveChannelParams = z.object({ name: ChannelName }).strict();
export const LoadChannelParams = z
  .object({
    name: ChannelName,
    /** 불러오면서 반전한다. 하늘 채널 하나로 전경까지 얻을 수 있다. */
    invert: z.boolean().optional(),
  })
  .strict();

export const SelectionModifyParams = z
  .object({
    operation: z.enum(["feather", "expand", "contract", "smooth"]),
    /** 픽셀. feather 는 0.1–1000, 나머지는 1–500 이 Photoshop 의 범위다. */
    radius: z.number().min(0.1).max(1000),
  })
  .strict();

export const ColorRangeParams = z
  .object({
    range: z.enum(["highlights", "midtones", "shadows"]),
    /** 경계의 너그러움 0–200. 크면 더 넓게 잡힌다. */
    fuzziness: z.number().int().min(0).max(200).optional(),
  })
  .strict();

export const StampVisibleParams = z
  .object({ name: z.string().trim().min(1).max(255).optional() })
  .strict();

function forwardAny<TParams, TResult>(): CommandHandler<TParams, TResult> {
  return async (command, context) => context.bridge.executeCommand<TResult>(command);
}

export const selectionSaveChannelCommand = forwardAny<
  z.infer<typeof SaveChannelParams>,
  { name: string }
>();
export const selectionLoadChannelCommand = forwardAny<
  z.infer<typeof LoadChannelParams>,
  SelectionState
>();
export const selectionModifyCommand = forwardAny<
  z.infer<typeof SelectionModifyParams>,
  SelectionState
>();
export const selectionColorRangeCommand = forwardAny<
  z.infer<typeof ColorRangeParams>,
  SelectionState
>();
export const layerStampVisibleCommand = forwardAny<z.infer<typeof StampVisibleParams>, LayerInfo>();
