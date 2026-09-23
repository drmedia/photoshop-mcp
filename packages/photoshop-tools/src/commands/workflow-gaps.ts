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
export const SELECTION_LUMINOSITY = "SELECTION_LUMINOSITY";
export const LAYER_STAMP_VISIBLE = "LAYER_STAMP_VISIBLE";

/** 알파 채널 이름. 경로 구분자를 막을 이유는 없지만 길이는 제한한다. */
const ChannelName = z.string().trim().min(1).max(64);

export const SaveChannelParams = z.object({ name: ChannelName }).strict();
export const LoadChannelParams = z
  .object({
    name: ChannelName,
    /** 불러오면서 반전한다. 하늘 채널 하나로 전경까지 얻을 수 있다. */
    invert: z.boolean().optional(),
    /**
     * 기존 선택과 어떻게 합칠지. 생략하면 덮어쓴다(`new`).
     *
     * `intersect` 는 **더 좁은 마스크**를 만든다. 광도 마스크 관례의
     * `Darks 2` 가 이것이다 — 반전한 휘도를 채널에 저장해 두고 자기 자신과
     * 교차한다. 교집합할 선택이 없으면 실패한다.
     */
    mode: z.enum(["new", "intersect"]).optional(),
  })
  .strict();

/**
 * 합성 휘도를 선택으로 가져온다.
 *
 * `invert` 는 어두운 쪽을 고른다 — 광도 마스크의 Darks 다. 채널을 둘 만들지
 * 않아도 되는 것은 `load_channel` 과 같다.
 */
export const SelectionLuminosityParams = z
  .object({
    invert: z.boolean().optional(),
    /**
     * 기존 선택과 어떻게 합칠지. 생략하면 덮어쓴다(`new`).
     *
     * `intersect` 는 **더 좁은 광도 마스크**를 만든다 — 휘도를 자기 자신과
     * 교차하면 가장 밝은 쪽만 남는다. 광도 마스크 관례의 `Lights 2` 가 이것이다.
     * 교집합할 선택이 없으면 실패한다.
     */
    mode: z.enum(["new", "intersect"]).optional(),
  })
  .strict();

export const selectionLuminosityCommand = forwardAny<
  z.infer<typeof SelectionLuminosityParams>,
  SelectionState
>();

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

export const MASK_GRADIENT = "MASK_GRADIENT";

/** 픽셀 좌표. 문서 좌상단이 원점. */
const Point = z.object({ x: z.number().min(0), y: z.number().min(0) }).strict();

export const MaskGradientParams = z
  .object({
    layerId: z.number().int().optional(),
    /**
     * 그라디언트가 시작하는 점. 기본은 여기가 검은색(가려지는 쪽)이다.
     *
     * `type` 에 따라 뜻이 다르다 — `linear` 에서는 **시작점**, `radial` 에서는
     * **중심**이다.
     */
    from: Point,
    /**
     * 끝나는 점. 기본은 여기가 흰색(보이는 쪽)이다.
     *
     * `radial` 에서는 중심에서 이 점까지가 **반지름**이다. 방향은 뜻이 없고
     * 거리만 쓰인다.
     */
    to: Point,
    /**
     * 그라디언트 모양. (ROADMAP §17.22)
     *
     * - `linear` (기본) — 한 방향으로 변한다
     * - `radial` — 중심에서 바깥으로 동심원으로 변한다
     *
     * ## 왜 `radial` 이 필요했나
     *
     * 빛 공해는 **광원에서 멀어질수록 약해진다.** 2차원 감쇠라 선형 그라디언트
     * 하나로는 구조적으로 맞출 수 없다 — 은하수 사진 보정에서 가로·세로 마스크를
     * 차례로 걸었더니 중간 행은 ±1레벨로 맞았는데 모서리가 ±8 남았다.
     *
     * 그룹 마스크와 레이어 마스크를 곱해 우회했지만 조정 레이어가 넷 더 들었다.
     * 방사형은 같은 일을 하나로 한다.
     *
     * 완벽한 모델은 아니다. Photoshop 의 방사형은 중심에서 반지름까지 **선형
     * 보간**이고 실제 대기 산란은 그렇지 않다. 그래도 선형보다 가깝다.
     *
     * `angle` · `reflected` · `diamond` 는 넣지 않았다. 쓸 자리를 아직 만나지
     * 못했고, 열거형을 넓히면 Tool 설명이 길어져 호출자가 고르기 어려워진다.
     */
    type: z.enum(["linear", "radial"]).optional(),
    /**
     * 흑백을 뒤집는다.
     *
     * **`radial` 에서는 대개 필요하다.** 기본은 중심이 검은색인데, 광원 쪽에서
     * 효과를 강하게 주려면 중심이 흰색이어야 한다.
     */
    reverse: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // 같은 점이면 그라디언트가 성립하지 않는다. Photoshop 은 조용히 아무것도
    // 하지 않을 수 있어 호출자가 적용된 줄 안다.
    if (value.from.x === value.to.x && value.from.y === value.to.y) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          value.type === "radial"
            ? "from 과 to 가 같은 점입니다. 반지름이 0 입니다."
            : "from 과 to 가 같은 점입니다. 그라디언트에는 길이가 필요합니다.",
        path: ["to"],
      });
    }
  });

export const maskGradientCommand = forwardAny<z.infer<typeof MaskGradientParams>, LayerInfo>();
