import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  GROUP_CREATE,
  GROUP_MOVE_LAYER,
  GroupCreateParamsSchema,
  GroupMoveLayerParamsSchema,
  type GroupCreateParams,
  type GroupMoveLayerParams,
} from "../commands/group.js";

/** Phase 3 그룹 Tool. (ROADMAP §7.2) */

export function createGroupCreateTool(
  engine: CommandEngine,
): ToolDefinition<GroupCreateParams, LayerInfo> {
  return {
    name: "photoshop.group.create",
    description:
      "레이어 그룹을 만든다. layerIds 를 주면 그 레이어들을 그룹에 넣고, 생략하면 빈 그룹을 만든다. " +
      "**새 그룹은 기본적으로 최상위에 생긴다.** 그룹 안에 만들려면 parentId 로 명시한다. " +
      "Photoshop 자체는 활성 레이어가 있는 곳에 만들지만 이 Tool 은 그 자리를 보장한다 — " +
      "호출자가 활성 레이어 위치를 추적하지 않아도 결과가 같다. " +
      "layerIds 와 parentId 는 함께 쓸 수 없다. 레이어를 묶으면 그 레이어들이 있던 자리에 생긴다. " +
      "결과의 parentId 로 실제 위치를 확인할 수 있다.",
    permission: "edit",
    inputSchema: GroupCreateParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: GROUP_CREATE, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createGroupMoveLayerTool(
  engine: CommandEngine,
): ToolDefinition<GroupMoveLayerParams, LayerInfo> {
  return {
    name: "photoshop.group.move_layer",
    description:
      "레이어를 그룹 안으로 옮긴다. groupId 에 null 을 주면 그룹에서 꺼내 최상위로 옮긴다.",
    permission: "edit",
    inputSchema: GroupMoveLayerParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: GROUP_MOVE_LAYER, params: input },
        { requestId: context.requestId },
      ),
  };
}
