import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_MERGE,
  LayerMergeParamsSchema,
  type LayerMergeParams,
  type LayerMergeResult,
} from "../commands/layer-merge.js";

/** `photoshop.layer.merge` — 레이어를 합친다. */
export function createLayerMergeTool(
  engine: CommandEngine,
): ToolDefinition<LayerMergeParams, LayerMergeResult> {
  return {
    name: "photoshop.layer.merge",
    description:
      "레이어를 합친다. **layerIds 를 몇 개 주느냐로 뜻이 달라진다** — " +
      "하나면 그 레이어를 아래로 병합하고(Merge Down), 둘 이상이면 그것들끼리 합친다. " +
      "생략하면 지금 선택돼 있는 것을 쓰는데, 그러면 결과가 선택 상태에 달리므로 " +
      "**되도록 layerIds 를 명시한다**. 어느 쪽이었는지는 결과의 merged 와 mergedDown 에 담긴다. " +
      "**되돌릴 수 없다** — 합쳐진 레이어들은 사라진다. 비파괴로 합친 그림만 " +
      "얻으려면 photoshop.layer.stamp_visible 이 맞다(원본이 남는다). " +
      "보이는 것을 전부 합치려면 photoshop.document.merge_visible 이다. " +
      "**숨긴 레이어는 조용히 아무 일도 안 한다**(실기 확인) — 오류 없이 레이어 수가 " +
      "그대로다. 전후 개수를 세어 변화가 없으면 실패로 답하므로, 그 오류를 보면 " +
      "photoshop.layer.set_visibility 로 먼저 보이게 한다. " +
      "맨 아래 레이어 하나로 아래로 병합은 할 수 없다 — 미리 거절한다. " +
      "하나라도 없는 id 가 있으면 아무것도 합치지 않고 실패한다.",
    permission: "destructive",
    inputSchema: LayerMergeParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerMergeResult>(
        { type: LAYER_MERGE, params: input },
        { requestId: context.requestId },
      ),
  };
}
