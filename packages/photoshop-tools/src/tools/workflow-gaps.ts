import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import type { SelectionState } from "../commands/state-read.js";
import {
  ADJUSTMENT_COLOR_BALANCE,
  ColorRangeParams,
  LAYER_STAMP_VISIBLE,
  LoadChannelParams,
  SELECTION_COLOR_RANGE,
  SELECTION_LOAD_CHANNEL,
  SELECTION_MODIFY,
  SELECTION_SAVE_CHANNEL,
  SaveChannelParams,
  SelectionModifyParams,
  StampVisibleParams,
  ColorBalanceParams,
  FILTER_HIGH_PASS,
  FILTER_MINIMUM_MAXIMUM,
  HighPassParams,
  LAYER_FROM_BACKGROUND,
  LayerFromBackgroundParams,
  MinimumMaximumParams,
} from "../commands/workflow-gaps.js";

function tool<TSchema extends z.ZodTypeAny>(
  engine: CommandEngine,
  name: string,
  commandType: string,
  description: string,
  inputSchema: TSchema,
): ToolDefinition<z.infer<TSchema>, LayerInfo> {
  return {
    name,
    description,
    permission: "edit",
    inputSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: commandType, params: input as Record<string, unknown> },
        { requestId: context.requestId },
      ),
  };
}

export function createColorBalanceTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof ColorBalanceParams>, LayerInfo> {
  return tool(
    engine,
    "photoshop.adjustment.color_balance",
    ADJUSTMENT_COLOR_BALANCE,
    "Color Balance 조정 레이어를 만든다. shadows · midtones · highlights 각각 " +
      "[cyan↔red, magenta↔green, yellow↔blue] 세 값(-100~100)이다. 예를 들어 밤하늘의 " +
      "green cast 를 빼려면 midtones 의 두 번째 값을 음수로 준다. " +
      "preserveLuminosity(기본 true)는 색을 옮기면서 밝기를 유지한다. " +
      "선택 영역이 있으면 Photoshop 이 그것을 마스크로 만들어 붙이고 선택 영역을 소비한다.",
    ColorBalanceParams,
  );
}

export function createLayerFromBackgroundTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof LayerFromBackgroundParams>, LayerInfo> {
  return tool(
    engine,
    "photoshop.layer.from_background",
    LAYER_FROM_BACKGROUND,
    "배경 레이어를 일반 레이어로 바꾼다. 배경은 이름·불투명도·마스크를 가질 수 없어 " +
      "평탄화된 이미지로 시작하는 작업은 보통 이것이 첫 단계다. " +
      "id 가 바뀌므로 반환값의 id 를 그대로 쓴다. " +
      "배경 레이어가 없으면 아무것도 하지 않고 현재 레이어를 돌려준다 — 오류가 아니다.",
    LayerFromBackgroundParams,
  );
}

export function createHighPassTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof HighPassParams>, LayerInfo> {
  return tool(
    engine,
    "photoshop.filter.high_pass",
    FILTER_HIGH_PASS,
    "High Pass 필터. 가장자리만 남기고 나머지를 중간 회색으로 만든다. " +
      "**혼자서는 쓸모가 없다** — 복제한 레이어에 적용한 뒤 softLight 나 overlay 혼합으로 " +
      "겹쳐야 선명도가 올라간다. 선명화에는 radius 10~20 px 가 흔하다. " +
      "**기본은 픽셀에 직접 적용한다** — Photoshop 자신의 동작과 같고, 레이어 id 와 type 이 그대로라 여러 단계를 이어갈 때 추적하기 쉽다. 대신 되돌릴 수 없으므로 **비파괴가 필요하면 layer.duplicate 한 복제본에 적용한다.** asSmartFilter: true 를 주면 대상을 스마트 오브젝트로 바꿔 나중에 수정·제거할 수 있는 스마트 필터로 붙이지만, 그때는 id 와 type 이 달라지므로 반환값의 id 를 그대로 써야 한다. 조정 레이어와 그룹에는 적용할 수 없다.",
    HighPassParams,
  );
}

export function createMinimumMaximumTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof MinimumMaximumParams>, LayerInfo> {
  return tool(
    engine,
    "photoshop.filter.minimum_maximum",
    FILTER_MINIMUM_MAXIMUM,
    "Minimum(밝은 영역 축소) 또는 Maximum(확장) 필터. " +
      "천체사진의 별 축소가 minimum 을 아주 작은 radius(0.3~0.5 px)로 쓰는 것이다. " +
      "preserveShape 는 roundness(기본, 별에 적합) 또는 squareness. " +
      "**기본은 픽셀에 직접 적용한다** — Photoshop 자신의 동작과 같고, 레이어 id 와 type 이 그대로라 여러 단계를 이어갈 때 추적하기 쉽다. 대신 되돌릴 수 없으므로 **비파괴가 필요하면 layer.duplicate 한 복제본에 적용한다.** asSmartFilter: true 를 주면 대상을 스마트 오브젝트로 바꿔 나중에 수정·제거할 수 있는 스마트 필터로 붙이지만, 그때는 id 와 type 이 달라지므로 반환값의 id 를 그대로 써야 한다. 조정 레이어와 그룹에는 적용할 수 없다.",
    MinimumMaximumParams,
  );
}

function selectionTool<TSchema extends z.ZodTypeAny, TResult>(
  engine: CommandEngine,
  name: string,
  commandType: string,
  description: string,
  inputSchema: TSchema,
): ToolDefinition<z.infer<TSchema>, TResult> {
  return {
    name,
    description,
    permission: "edit",
    inputSchema,
    handler: async (input, context) =>
      engine.execute<TResult>(
        { type: commandType, params: input as Record<string, unknown> },
        { requestId: context.requestId },
      ),
  };
}

export function createSaveChannelTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof SaveChannelParams>, { name: string }> {
  return selectionTool(
    engine,
    "photoshop.selection.save_channel",
    SELECTION_SAVE_CHANNEL,
    "현재 선택 영역을 알파 채널로 저장한다. 선택은 다음 작업에서 쉽게 사라지므로 " +
      "(조정 레이어를 만들면 소비된다) 여러 번 쓸 선택은 저장해 두고 " +
      "selection.load_channel 로 불러온다. 선택 영역이 없으면 실패한다.",
    SaveChannelParams,
  );
}

export function createLoadChannelTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof LoadChannelParams>, SelectionState> {
  return selectionTool(
    engine,
    "photoshop.selection.load_channel",
    SELECTION_LOAD_CHANNEL,
    "저장해 둔 알파 채널에서 선택 영역을 불러온다. invert: true 를 주면 불러오면서 " +
      "반전하므로 하늘 채널 하나로 전경 선택까지 얻을 수 있다 — 채널을 둘 만들지 않아도 된다.",
    LoadChannelParams,
  );
}

export function createSelectionModifyTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof SelectionModifyParams>, SelectionState> {
  return selectionTool(
    engine,
    "photoshop.selection.modify",
    SELECTION_MODIFY,
    "이미 만든 선택 영역을 다듬는다. feather(경계를 부드럽게) · expand(확장) · " +
      "contract(축소) · smooth(요철 정리). selection.set 의 feather 는 만들 때만 " +
      "쓸 수 있으므로, 만들어 둔 선택의 경계를 나중에 조정하려면 이것을 쓴다. " +
      "선택 영역이 없으면 실패한다.",
    SelectionModifyParams,
  );
}

export function createColorRangeTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof ColorRangeParams>, SelectionState> {
  return selectionTool(
    engine,
    "photoshop.selection.color_range",
    SELECTION_COLOR_RANGE,
    "광도 구간으로 선택한다 — highlights(밝은 부분) · midtones · shadows. " +
      "이것이 광도 마스크다. 밝은 부분만 골라 은하수 중심부를 살리거나 어두운 " +
      "부분만 골라 노이즈를 다루는 데 쓴다. fuzziness(0–200, 기본 40)가 크면 더 " +
      "넓게 잡힌다. 만든 선택은 mask.create 의 fromSelection 이나 조정 레이어의 " +
      "자동 마스크로 이어 쓴다. **해당하는 픽셀이 없으면 hasSelection 이 false 다** — " +
      "오류가 아니다. 어두운 야경에서 highlights 를 고르면 실제로 비어 있다.",
    ColorRangeParams,
  );
}

export function createStampVisibleTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof StampVisibleParams>, LayerInfo> {
  return selectionTool(
    engine,
    "photoshop.layer.stamp_visible",
    LAYER_STAMP_VISIBLE,
    "보이는 레이어를 모두 합친 **복제본**을 새 레이어로 만든다. 원본 레이어들은 " +
      "그대로 남는다. 샤프닝처럼 '지금까지의 결과 전체'를 대상으로 삼아야 하는 " +
      "단계에서 쓴다. 숨긴 레이어는 포함되지 않으며, **보이는 레이어가 2장 이상**이어야 한다.",
    StampVisibleParams,
  );
}
