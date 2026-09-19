import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  LAYER_REORDER,
  LayerReorderParamsSchema,
  type LayerReorderResult,
} from "../commands/layer-reorder.js";

/** `photoshop.layer.reorder` — 레이어 순서를 바꾼다. (ROADMAP §17.23) */
export function createLayerReorderTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof LayerReorderParamsSchema>, LayerReorderResult> {
  return {
    name: "photoshop.layer.reorder",
    description:
      "레이어 순서를 바꾼다. top · bottom · up · down 은 **같은 부모 안에서만** 움직이며 " +
      "그룹 경계를 넘지 않는다 — 그룹을 넘나드는 이동은 photoshop.group.move_layer 가 한다. " +
      "above · below 는 referenceId 의 바로 위/아래로 옮기며 **부모가 바뀔 수 있다**. " +
      "조정 레이어는 자기 아래 전체에 걸리므로 순서가 결과를 바꾼다 — " +
      "예를 들어 채도 조정을 맨 위로 올리면 그 아래 모든 보정이 반영된 뒤에 적용된다. " +
      "맨 위에서 up 을 하는 것은 오류가 아니다. **결과의 moved 로 실제로 움직였는지 확인한다** — " +
      "배경 레이어처럼 Photoshop 이 옮기지 않는 것이 있다. " +
      "index 와 siblings 는 요청이 아니라 옮긴 뒤 실제로 읽은 값이며 0 이 맨 위다.",
    permission: "edit",
    inputSchema: LayerReorderParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerReorderResult>(
        { type: LAYER_REORDER, params: input },
        { requestId: context.requestId },
      ),
  };
}
