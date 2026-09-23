import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  LAYER_DELETE,
  LayerDeleteParamsSchema,
  type LayerDeleteResult,
} from "../commands/layer-delete.js";

/** `photoshop.layer.delete` — 레이어를 지운다. (ROADMAP §17.18) */
export function createLayerDeleteTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof LayerDeleteParamsSchema>, LayerDeleteResult> {
  return {
    name: "photoshop.layer.delete",
    description:
      "레이어를 지운다. **id 를 명시한다 — 이름이나 패턴을 받지 않는다.** " +
      "photoshop.layer.list 로 무엇을 지울지 먼저 고른 뒤 id 를 준다. " +
      "여러 개를 한 번에 받는다. " +
      "작업을 없애는 것이 목적이므로 destructive 다 — 기본 설정에서는 막혀 있고 " +
      "사용자가 PHOTOSHOP_MCP_ALLOW 로 켜야 한다. photoshop.history.undo 로 되살릴 수 " +
      "있지만 History 가 바닥나면 돌아오지 않는다. " +
      "문서의 레이어를 전부 지우려 하면 거절한다 — Photoshop 은 빈 문서를 허용하지 않는다. " +
      "결과의 deleted 는 요청이 아니라 **지운 뒤 목록을 다시 읽어 확인한 값**이다. " +
      "**그룹을 지우면 안의 레이어는 남는다** — 그룹만 없어지고 자식들이 상위로 " +
      "올라온다. 내용까지 지우려면 자식 id 를 함께 준다. 실기에서 그룹 하나를 " +
      "지웠는데 조정 레이어 넷이 최상위에 남았다.",
    permission: "destructive",
    inputSchema: LayerDeleteParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerDeleteResult>(
        { type: LAYER_DELETE, params: input },
        { requestId: context.requestId },
      ),
  };
}
