import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_GET,
  LayerGetParamsSchema,
  type LayerDetail,
  type LayerGetParams,
} from "../commands/layer-get.js";

/** `photoshop.layer.get` — 레이어 하나의 상세. */
export function createLayerGetTool(
  engine: CommandEngine,
): ToolDefinition<LayerGetParams, LayerDetail> {
  return {
    name: "photoshop.layer.get",
    description:
      "레이어 하나의 상세를 돌려준다. layerId 를 생략하면 활성 레이어. " +
      "photoshop.layer.list 는 레이어마다 한 줄이라 **경계를 담지 않는다** — " +
      "이것이 bounds 와 boundsNoEffects 를 준다. 외부 처리기가 돌려준 레이어가 " +
      "제자리에 놓였는지, 마스크를 구운 뒤 실제로 작아졌는지처럼 **위치와 크기를 " +
      "확인해야 하는 일**에 쓴다. bounds 는 효과를 포함하고 boundsNoEffects 는 뺀다. " +
      "그 밖에 locked(무엇이든 잠김) · allLocked(전부 잠김) · isClippingMask · " +
      "fillOpacity 를 준다 — fillOpacity 는 opacity 와 달라서 효과는 남기고 픽셀만 " +
      "투명해진다. " +
      "**빈 레이어는 bounds 가 전부 0 이다. null 이 아니다** — 픽셀이 하나도 없다는 " +
      "뜻이고, null 은 읽지 못했다는 뜻이라 서로 다르다. " +
      "**읽지 못한 값은 0 이나 false 가 아니라 null 이다** — 버전에 따라 없는 속성이 " +
      "있고, 없는 것을 기본값으로 채우면 틀린 사실을 말하게 된다. " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: LayerGetParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerDetail>(
        { type: LAYER_GET, params: input },
        { requestId: context.requestId },
      ),
  };
}
