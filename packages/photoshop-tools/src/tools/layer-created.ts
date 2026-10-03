import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  LAYER_DELETE_CREATED,
  LAYER_LIST_CREATED,
  LayerDeleteCreatedParamsSchema,
  type LayerDeleteCreatedResult,
  LayerListCreatedParamsSchema,
  type LayerListCreatedResult,
} from "../commands/layer-created.js";

/** `photoshop.layer.list_created` — 이 세션이 만든 레이어. (ROADMAP §101) */
export function createLayerListCreatedTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof LayerListCreatedParamsSchema>, LayerListCreatedResult> {
  return {
    name: "photoshop.layer.list_created",
    description:
      "**이 서버의 Command 가 만든** 레이어를 활성 문서에서 모아 보여 준다 — 사용자가 손으로 만들었거나 " +
      "원래 있던 레이어는 나오지 않는다. 지우기 전에 무엇이 지워질지 확인하는 용도다. " +
      "플러그인을 다시 띄우면 기록이 사라진다.",
    permission: "read",
    inputSchema: LayerListCreatedParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerListCreatedResult>(
        { type: LAYER_LIST_CREATED, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.layer.delete_created` — 이 세션이 만든 레이어를 지운다. (ROADMAP §101) */
export function createLayerDeleteCreatedTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof LayerDeleteCreatedParamsSchema>, LayerDeleteCreatedResult> {
  return {
    name: "photoshop.layer.delete_created",
    description:
      "보정 시험으로 쌓인 임시 레이어를 정리한다. **이 서버의 Command 가 만든 레이어만** 지운다 — " +
      "원래 있던 것과 사용자가 만든 것은 id 를 줘도 건드리지 않고 notCreated 로 알린다. " +
      "layerIds 를 생략하면 만든 것 전부, 주면 그 가운데서만. 먼저 photoshop.layer.list_created 로 " +
      "확인한다. 범위가 한정되어 edit 이며 photoshop.history.undo 로 되살릴 수 있다. " +
      "결과의 deleted 는 지운 뒤 목록을 다시 읽어 확인한 값이다. " +
      "**그룹을 지우면 안의 레이어는 남는다** — 자식도 이 서버가 만든 것이면 함께 지워진다.",
    permission: "edit",
    inputSchema: LayerDeleteCreatedParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerDeleteCreatedResult>(
        { type: LAYER_DELETE_CREATED, params: input },
        { requestId: context.requestId },
      ),
  };
}
