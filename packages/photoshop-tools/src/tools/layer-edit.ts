import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_CREATE,
  LAYER_DUPLICATE,
  LAYER_OPACITY,
  LAYER_RENAME,
  LAYER_SELECT,
  LAYER_VISIBILITY,
  LayerCreateParamsSchema,
  LayerDuplicateParamsSchema,
  LayerOpacityParamsSchema,
  LayerRenameParamsSchema,
  LayerSelectParamsSchema,
  LayerVisibilityParamsSchema,
  type LayerCreateParams,
  type LayerDuplicateParams,
  type LayerOpacityParams,
  type LayerRenameParams,
  type LayerSelectParams,
  type LayerVisibilityParams,
} from "../commands/layer-edit.js";

/**
 * Phase 3 레이어 편집 Tool. (ROADMAP §7.1)
 *
 * Tool 과 Command 의 파라미터 형태는 같지만 스키마를 공유하지 않고 각자 검증한다.
 * Tool 은 MCP 경계, Command 는 Extension 경계라 책임이 다르다. (ARCHITECTURE §3.2)
 */

/** 편집 Tool 을 만드는 공통 틀. 결과는 변경 후 레이어 상태다. */
function createLayerTool<TParams>(
  name: string,
  description: string,
  inputSchema: ToolDefinition<TParams, LayerInfo>["inputSchema"],
  commandType: string,
  engine: CommandEngine,
): ToolDefinition<TParams, LayerInfo> {
  return {
    name,
    description,
    inputSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: commandType, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createLayerCreateTool(
  engine: CommandEngine,
): ToolDefinition<LayerCreateParams, LayerInfo> {
  return createLayerTool(
    "photoshop.layer.create",
    "새 픽셀 레이어를 만든다. 이름을 생략하면 Photoshop 기본 이름을 쓴다.",
    LayerCreateParamsSchema,
    LAYER_CREATE,
    engine,
  );
}

export function createLayerDuplicateTool(
  engine: CommandEngine,
): ToolDefinition<LayerDuplicateParams, LayerInfo> {
  return createLayerTool(
    "photoshop.layer.duplicate",
    "레이어를 복제한다. layerId 를 생략하면 활성 레이어를 복제한다.",
    LayerDuplicateParamsSchema,
    LAYER_DUPLICATE,
    engine,
  );
}

export function createLayerRenameTool(
  engine: CommandEngine,
): ToolDefinition<LayerRenameParams, LayerInfo> {
  return createLayerTool(
    "photoshop.layer.rename",
    "레이어 이름을 바꾼다. layerId 를 생략하면 활성 레이어를 대상으로 한다.",
    LayerRenameParamsSchema,
    LAYER_RENAME,
    engine,
  );
}

export function createLayerSelectTool(
  engine: CommandEngine,
): ToolDefinition<LayerSelectParams, LayerInfo> {
  return createLayerTool(
    "photoshop.layer.select",
    "레이어를 활성 레이어로 선택한다.",
    LayerSelectParamsSchema,
    LAYER_SELECT,
    engine,
  );
}

export function createLayerVisibilityTool(
  engine: CommandEngine,
): ToolDefinition<LayerVisibilityParams, LayerInfo> {
  return createLayerTool(
    "photoshop.layer.set_visibility",
    "레이어 표시 여부를 바꾼다. layerId 를 생략하면 활성 레이어를 대상으로 한다.",
    LayerVisibilityParamsSchema,
    LAYER_VISIBILITY,
    engine,
  );
}

export function createLayerOpacityTool(
  engine: CommandEngine,
): ToolDefinition<LayerOpacityParams, LayerInfo> {
  return createLayerTool(
    "photoshop.layer.set_opacity",
    "레이어 불투명도를 0–100 으로 설정한다. layerId 를 생략하면 활성 레이어를 대상으로 한다.",
    LayerOpacityParamsSchema,
    LAYER_OPACITY,
    engine,
  );
}
