import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  ADJUSTMENT_BLACK_WHITE,
  ADJUSTMENT_CHANNEL_MIXER,
  ADJUSTMENT_EXPOSURE,
  ADJUSTMENT_PHOTO_FILTER,
  AdjustmentBlackWhiteParamsSchema,
  AdjustmentChannelMixerParamsSchema,
  AdjustmentExposureParamsSchema,
  AdjustmentPhotoFilterParamsSchema,
  type AdjustmentBlackWhiteParams,
  type AdjustmentChannelMixerParams,
  type AdjustmentExposureParams,
  type AdjustmentPhotoFilterParams,
} from "../commands/adjustment-extra.js";

/**
 * 조정 레이어 넷. (ROADMAP §52)
 *
 * 전부 **조정 레이어**로 만든다. 픽셀을 직접 고치지 않으므로 값을 나중에
 * 바꿀 수 있고 `edit` 이다.
 */

/** 넷이 공유하는 문장. */
const COMMON =
  "조정 레이어로 만든다 — 픽셀을 굽지 않으므로 나중에 값을 고칠 수 있다. " +
  "**활성 레이어 위에 쌓인다.** 아래 있는 모든 레이어에 걸리므로 특정 레이어에만 " +
  "걸려면 photoshop.group.create 로 묶거나 클리핑을 쓴다. name 으로 이름을 준다. ";

function create<TParams>(
  name: string,
  description: string,
  schema: ToolDefinition<TParams, LayerInfo>["inputSchema"],
  type: string,
  engine: CommandEngine,
): ToolDefinition<TParams, LayerInfo> {
  return {
    name,
    description,
    permission: "edit",
    inputSchema: schema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>({ type, params: input }, { requestId: context.requestId }),
  };
}

/** `photoshop.adjustment.exposure` */
export function createAdjustmentExposureTool(
  engine: CommandEngine,
): ToolDefinition<AdjustmentExposureParams, LayerInfo> {
  return create(
    "photoshop.adjustment.exposure",
    "노출 조정 레이어를 만든다. exposure 는 **스톱**(−20~20)이고 주로 하이라이트를 " +
      "움직인다. offset(−0.5~0.5)은 그림자를, gammaCorrection(0.01~9.99)은 중간톤을 " +
      "움직인다. **`gamma` 가 아니라 `gammaCorrection` 이다.** " +
      "**32비트 HDR 이 아니어도 쓸 수 있지만 계조가 쉽게 깨진다** — 8비트에서 크게 " +
      "올리면 밴딩이 생긴다. 일반적인 밝기 보정은 photoshop.adjustment.curves 나 " +
      "levels 쪽이 안전하고, 이쪽은 선형적으로 노출을 다시 잡아야 할 때다. " +
      COMMON,
    AdjustmentExposureParamsSchema,
    ADJUSTMENT_EXPOSURE,
    engine,
  );
}

/** `photoshop.adjustment.black_white` */
export function createAdjustmentBlackWhiteTool(
  engine: CommandEngine,
): ToolDefinition<AdjustmentBlackWhiteParams, LayerInfo> {
  return create(
    "photoshop.adjustment.black_white",
    "흑백 조정 레이어를 만든다. red · yellow · green · cyan · blue · magenta 여섯 값이 " +
      "**각 색이 회색으로 얼마나 밝게 옮겨질지**를 정한다(−200~300). 기본은 각각 " +
      "40 · 60 · 40 · 60 · 20 · 80 이다. blue 를 내리면 하늘이 어두워진다. " +
      "useTint 를 켜면 결과에 색조가 입혀진다 — **색은 Photoshop 기본값이고 " +
      "지정하는 통로는 없다**(descriptor 를 잡을 때 색이 나오지 않았다). " +
      "**채도를 0 으로 내리는 것과 다르다** — 이쪽은 색마다 밝기를 따로 정한다. " +
      COMMON,
    AdjustmentBlackWhiteParamsSchema,
    ADJUSTMENT_BLACK_WHITE,
    engine,
  );
}

/** `photoshop.adjustment.photo_filter` */
export function createAdjustmentPhotoFilterTool(
  engine: CommandEngine,
): ToolDefinition<AdjustmentPhotoFilterParams, LayerInfo> {
  return create(
    "photoshop.adjustment.photo_filter",
    "포토 필터 조정 레이어를 만든다. 렌즈 앞에 색유리를 대는 것과 같다. " +
      "**color 는 Lab 이다** — {luminance 0~100, a −128~127, b −128~127}. " +
      "Photoshop 패널의 필터 드롭다운(Warming Filter 85 등)은 이름이 아니라 Lab 색으로 " +
      "나가므로 이름을 받는 통로가 없다. b 를 음수로 주면 차가워지고 양수면 따뜻해진다. " +
      "density 는 농도(1~100), preserveLuminosity 는 켜면 색만 옮기고 밝기를 유지한다. " +
      "**색 캐스트를 빼는 용도로는 photoshop.adjustment.color_balance 가 더 정밀하다** — " +
      "그쪽은 그림자·중간톤·하이라이트를 따로 다룬다. 이쪽은 전체에 한 겹 씌운다. " +
      COMMON,
    AdjustmentPhotoFilterParamsSchema,
    ADJUSTMENT_PHOTO_FILTER,
    engine,
  );
}

/** `photoshop.adjustment.channel_mixer` */
export function createAdjustmentChannelMixerTool(
  engine: CommandEngine,
): ToolDefinition<AdjustmentChannelMixerParams, LayerInfo> {
  return create(
    "photoshop.adjustment.channel_mixer",
    "채널 혼합 조정 레이어를 만든다. **출력 채널 하나를 세 입력 채널의 합으로 다시 만든다.** " +
      "red · green · blue 각각에 {red, green, blue, constant} 를 퍼센트로 준다(−200~200). " +
      "만들 때 기본은 항등행렬이다 — red 는 {red:100}, green 은 {green:100}, blue 는 {blue:100}. " +
      "**monochrome: true 면 gray 하나만 준다** — red·green·blue 를 함께 주면 거절한다. " +
      "Photoshop 이 오류 없이 한쪽만 쓰기 때문이다. " +
      "천체사진에서 채널별 감도 차이를 맞추거나 특정 채널의 노이즈를 다른 채널로 " +
      "덮을 때 쓴다. **색을 옮기는 것이 목적이면 photoshop.adjustment.color_balance** 쪽이 " +
      "직관적이다 — 이쪽은 채널을 섞으므로 의도하지 않은 색이 쉽게 나온다. " +
      COMMON,
    AdjustmentChannelMixerParamsSchema,
    ADJUSTMENT_CHANNEL_MIXER,
    engine,
  );
}
