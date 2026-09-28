import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_SET_LOCK,
  LayerSetLockParamsSchema,
  type LayerSetLockParams,
  type LayerSetLockResult,
} from "../commands/layer-lock.js";

/** `photoshop.layer.set_lock` — 레이어 잠금. */
export function createLayerSetLockTool(
  engine: CommandEngine,
): ToolDefinition<LayerSetLockParams, LayerSetLockResult> {
  return {
    name: "photoshop.layer.set_lock",
    description:
      "레이어 잠금을 건다. layerId 를 생략하면 활성 레이어. " +
      "lock 은 none(전부 풀기) · all(전부 잠금) · pixels(픽셀 편집) · " +
      "position(이동) · transparentPixels(투명 영역) 다섯 중 하나다. " +
      "**한 번에 하나만 걸 수 있다** — 실기에서 확인했다. Photoshop 이 잠금 속성 " +
      "하나를 쓰면 나머지를 전부 지우기 때문이다(예: pixels 를 건 뒤 position 을 " +
      "걸면 pixels 가 풀린다). 둘을 함께 걸고 싶어도 이 API 로는 되지 않는다. " +
      "**결과의 locks 는 건 뒤에 읽은 다섯 값이고 요청을 되풀이한 것이 아니다.** " +
      "다섯을 다 주는 이유는 **배경 레이어가 position 과 transparentPixels 를 " +
      "동시에 갖기 때문**이다 — 설정기로는 도달할 수 없는 상태라 단일 값으로 " +
      "요약하면 그 사실을 말할 수 없다. locks.any 는 읽기 전용 파생값이다. " +
      "**배경 레이어의 위치·투명 잠금은 풀 수 없다** — 대입이 조용히 무시되므로 " +
      "실패로 답한다. photoshop.layer.from_background 로 일반 레이어로 바꾼 뒤 쓴다. " +
      "지금 상태만 보려면 photoshop.layer.get 이 다섯 값을 모두 준다.",
    permission: "edit",
    inputSchema: LayerSetLockParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerSetLockResult>(
        { type: LAYER_SET_LOCK, params: input },
        { requestId: context.requestId },
      ),
  };
}
