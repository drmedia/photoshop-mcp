import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  ADJUSTMENT_HUE_SATURATION,
  ADJUSTMENT_VIBRANCE,
  HueSaturationParamsSchema,
  LAYER_BLEND_MODE,
  LayerBlendModeParamsSchema,
  SELECTION_SET,
  SelectionSetParamsSchema,
  VibranceParamsSchema,
  type HueSaturationParams,
  type LayerBlendModeParams,
  type SelectionSetParams,
  type SelectionSetResult,
  type VibranceParams,
} from "../commands/gap-tools.js";

/** ROADMAP §8.6 Tool. */

export function createSelectionSetTool(
  engine: CommandEngine,
): ToolDefinition<SelectionSetParams, SelectionSetResult> {
  return {
    name: "photoshop.selection.set",
    description:
      "선택 영역을 만든다. shape 는 rectangle / ellipse (bounds 필요) / canvas (문서 전체) / " +
      "layerTransparency (레이어의 불투명한 픽셀). bounds 는 픽셀 좌표 {left, top, right, bottom}. " +
      "feather 로 가장자리를 부드럽게 할 수 있다. 만든 선택은 mask.create 의 fromSelection 으로 쓸 수 있다. 다만 **조정 레이어를 만들면 Photoshop 이 선택 영역을 마스크로 소비**하므로 그 뒤에는 남아 있지 않다.",
    permission: "edit",
    inputSchema: SelectionSetParamsSchema,
    handler: async (input, context) =>
      engine.execute<SelectionSetResult>(
        { type: SELECTION_SET, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createLayerBlendModeTool(
  engine: CommandEngine,
): ToolDefinition<LayerBlendModeParams, LayerInfo> {
  return {
    name: "photoshop.layer.set_blend_mode",
    description:
      "레이어 혼합 모드를 바꾼다. normal · multiply · screen · overlay · softLight · luminosity 등. " +
      "layerId 를 생략하면 활성 레이어. 배경 레이어는 Photoshop 이 거부하며 그때는 문서가 바뀌지 않는다.",
    permission: "edit",
    inputSchema: LayerBlendModeParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: LAYER_BLEND_MODE, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createHueSaturationTool(
  engine: CommandEngine,
): ToolDefinition<HueSaturationParams, LayerInfo> {
  return {
    name: "photoshop.adjustment.hue_saturation",
    description:
      "Hue/Saturation 조정 레이어를 만든다. hue -180~180, saturation -100~100, lightness -100~100." +
      " 선택 영역이 있으면 Photoshop 이 그것을 마스크로 만들어 붙이고 **선택 영역을 소비한다** — 이후 mask.create 의 fromSelection 은 실패한다.",
    permission: "edit",
    inputSchema: HueSaturationParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: ADJUSTMENT_HUE_SATURATION, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createVibranceTool(
  engine: CommandEngine,
): ToolDefinition<VibranceParams, LayerInfo> {
  return {
    name: "photoshop.adjustment.vibrance",
    description:
      "Vibrance 조정 레이어를 만든다. vibrance 는 채도가 낮은 색을 우선 올린다. 둘 다 -100~100." +
      " 선택 영역이 있으면 Photoshop 이 그것을 마스크로 만들어 붙이고 **선택 영역을 소비한다** — 이후 mask.create 의 fromSelection 은 실패한다.",
    permission: "edit",
    inputSchema: VibranceParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: ADJUSTMENT_VIBRANCE, params: input },
        { requestId: context.requestId },
      ),
  };
}
