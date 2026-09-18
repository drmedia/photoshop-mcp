import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_GET_ACTIVE,
  LayerGetActiveParams,
  type ActiveLayerState,
} from "../commands/layer-active.js";

/** `photoshop.layer.get_active` — 지금 선택된 레이어 조회. */
export function createLayerGetActiveTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, ActiveLayerState> {
  return {
    name: "photoshop.layer.get_active",
    description:
      "지금 선택되어 있는 레이어를 반환한다. layerId 를 생략한 편집 Tool 이 무엇을 " +
      "대상으로 삼을지 미리 확인할 때 쓴다. Photoshop 은 레이어를 여러 개 선택할 수 " +
      "있으므로 layers 에 전부를, layer 에 편집 Tool 이 실제로 쓰는 첫 번째를 담는다. " +
      "선택된 레이어가 없으면 layer 는 null 이고 layers 는 빈 배열이다 — 오류가 아니다.",
    permission: "read",
    inputSchema: LayerGetActiveParams,
    handler: async (_input, context) =>
      engine.execute<ActiveLayerState>(
        { type: LAYER_GET_ACTIVE, params: {} },
        { requestId: context.requestId },
      ),
  };
}
