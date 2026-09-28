import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_LINK,
  LAYER_UNLINK,
  LayerLinkParamsSchema,
  LayerUnlinkParamsSchema,
  type LayerLinkParams,
  type LayerLinkResult,
  type LayerUnlinkParams,
} from "../commands/layer-link.js";

/** `photoshop.layer.link` — 두 레이어를 연결한다. */
export function createLayerLinkTool(
  engine: CommandEngine,
): ToolDefinition<LayerLinkParams, LayerLinkResult> {
  return {
    name: "photoshop.layer.link",
    description:
      "두 레이어를 연결한다. layerId 를 생략하면 활성 레이어이고 targetId 가 상대다. " +
      "**연결된 레이어들은 함께 움직이고 함께 변형된다** — layer.translate · " +
      "layer.scale · layer.rotate 를 하나에 걸면 연결된 것들이 따라온다. " +
      "**그룹과 다르다** — 트리 구조가 바뀌지 않고 순서도 그대로다. 묶어서 관리하려면 " +
      "photoshop.group.create 쪽이다. " +
      "**연결은 대칭이고 전이적이다**(실기 확인) — A-B 를 묶고 A-C 를 묶으면 " +
      "B 가 A·C 를 본다. 셋 이상을 묶으려면 같은 레이어에 대고 여러 번 부른다. " +
      "자기 자신과는 연결할 수 없어 거절한다. " +
      "**결과의 linked 는 linkedLayers 를 읽은 값이고 자기 자신은 들어 있지 않다** — " +
      "요청을 되풀이한 것이 아니므로 실제로 무엇이 묶였는지 여기서 확인한다. " +
      "연결을 끊으려면 photoshop.layer.unlink 다.",
    permission: "edit",
    inputSchema: LayerLinkParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerLinkResult>(
        { type: LAYER_LINK, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.layer.unlink` — 레이어의 연결을 끊는다. */
export function createLayerUnlinkTool(
  engine: CommandEngine,
): ToolDefinition<LayerUnlinkParams, LayerLinkResult> {
  return {
    name: "photoshop.layer.unlink",
    description:
      "레이어의 연결을 끊는다. layerId 를 생략하면 활성 레이어. " +
      "**그 레이어를 연결 집합에서 빼는 것**이지 집합 전체를 푸는 것이 아니다 — " +
      "셋이 묶여 있었다면 나머지 둘은 그대로 연결돼 있다. " +
      "연결이 없던 레이어에 불러도 오류가 아니다. " +
      "결과의 linked 로 남은 연결을 확인한다 — 끊겼으면 비어 있다.",
    permission: "edit",
    inputSchema: LayerUnlinkParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerLinkResult>(
        { type: LAYER_UNLINK, params: input },
        { requestId: context.requestId },
      ),
  };
}
