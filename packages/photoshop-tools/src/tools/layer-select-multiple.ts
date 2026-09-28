import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { ActiveLayerState } from "../commands/layer-active.js";
import {
  LAYER_SELECT_MULTIPLE,
  LayerSelectMultipleParamsSchema,
  type LayerSelectMultipleParams,
} from "../commands/layer-select-multiple.js";

/** `photoshop.layer.select_multiple` — 여러 장을 한 번에 선택한다. */
export function createLayerSelectMultipleTool(
  engine: CommandEngine,
): ToolDefinition<LayerSelectMultipleParams, ActiveLayerState> {
  return {
    name: "photoshop.layer.select_multiple",
    description:
      "레이어 여러 장을 한 번에 활성으로 만든다. photoshop.layer.select 는 하나만 고른다. " +
      "그룹으로 묶기 전이나 여러 장을 한꺼번에 다룰 때 쓴다. " +
      "결과는 photoshop.layer.get_active 와 같은 모양이다 — layer 는 편집 Tool 이 " +
      "layerId 없이 대상으로 삼는 것이고 layers 는 선택된 전부다. " +
      "**넘긴 순서는 유지되지 않는다.** 실기에서 확인했다 — Photoshop 이 아래→위 " +
      "레이어 순서로 정규화하므로 첫 번째로 준 것이 편집 대상이 아닐 수 있다. " +
      "선택한 뒤 다시 읽어서 실제 순서를 돌려주므로 편집 대상은 결과의 layer 로 " +
      "확인하고, 특정 레이어를 노려야 하면 편집 Tool 에 layerId 를 명시한다. " +
      "**하나라도 없으면 아무것도 선택하지 않고 실패한다** — 일부만 선택된 채로 " +
      "끝나면 호출자가 무엇이 선택됐는지 모른다. 같은 id 를 두 번 주는 것도 거절한다.",
    permission: "edit",
    inputSchema: LayerSelectMultipleParamsSchema,
    handler: async (input, context) =>
      engine.execute<ActiveLayerState>(
        { type: LAYER_SELECT_MULTIPLE, params: input },
        { requestId: context.requestId },
      ),
  };
}
