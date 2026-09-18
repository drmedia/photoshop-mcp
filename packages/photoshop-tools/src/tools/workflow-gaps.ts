import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  ADJUSTMENT_COLOR_BALANCE,
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
      "기본은 스마트 필터라 대상이 스마트 오브젝트로 바뀌며 id 와 type 이 달라진다.",
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
      "기본은 스마트 필터라 대상이 스마트 오브젝트로 바뀌며 id 와 type 이 달라진다.",
    MinimumMaximumParams,
  );
}
