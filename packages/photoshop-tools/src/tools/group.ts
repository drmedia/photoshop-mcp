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
      "레이어 그룹을 만든다. layerIds 를 주면 그 레이어들을 그룹에 넣고, 생략하면 빈 그룹을 만든다.",
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
    inputSchema: GroupMoveLayerParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: GROUP_MOVE_LAYER, params: input },
        { requestId: context.requestId },
      ),
  };
}
