import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_FLIP,
  LayerFlipParamsSchema,
  type LayerFlipParams,
  type LayerFlipResult,
} from "../commands/layer-flip.js";

/** `photoshop.layer.flip` — 레이어를 뒤집는다. */
export function createLayerFlipTool(
  engine: CommandEngine,
): ToolDefinition<LayerFlipParams, LayerFlipResult> {
  return {
    name: "photoshop.layer.flip",
    description:
      "레이어를 뒤집는다. axis 는 horizontal · vertical · both. " +
      "layerId 를 생략하면 활성 레이어. **문서 전체가 아니라 레이어 하나다** — " +
      "문서를 뒤집는 Tool 은 없다. " +
      "같은 축으로 두 번 부르면 제자리로 돌아온다. 잃는 것이 없어 edit 이다. " +
      "**캔버스가 아니라 레이어 자기 경계 기준으로 뒤집힌다**(실기 확인) — 그래서 " +
      "결과의 before · after 경계가 그대로이고, 경계로는 뒤집혔는지 알 수 없다. " +
      "값은 참고로 담을 뿐 성공 판정에 쓰지 않는다. 눈으로 확인하려면 " +
      "photoshop.layer.capture 다 — 다만 그쪽은 레이어 경계로 잘라 보여주므로 " +
      "내용이 대칭이면 구분되지 않는다. " +
      "잠긴 레이어에서는 실패할 수 있다 — photoshop.layer.get 의 locked 로 확인한다.",
    permission: "edit",
    inputSchema: LayerFlipParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerFlipResult>(
        { type: LAYER_FLIP, params: input },
        { requestId: context.requestId },
      ),
  };
}
