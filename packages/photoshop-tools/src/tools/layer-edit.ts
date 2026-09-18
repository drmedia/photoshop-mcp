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
  permission: ToolDefinition<TParams, LayerInfo>["permission"],
  inputSchema: ToolDefinition<TParams, LayerInfo>["inputSchema"],
  commandType: string,
  engine: CommandEngine,
): ToolDefinition<TParams, LayerInfo> {
  return {
    name,
    description,
    permission,
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
    "edit",
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
    "edit",
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
    "레이어 이름을 바꾼다. layerId 를 생략하면 활성 레이어를 대상으로 한다. " +
      "배경 레이어의 이름은 Photoshop 이 거부한다 — 그때는 문서가 바뀌지 않는다.",
    "edit",
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
    "edit",
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
    "edit",
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
    "레이어 불투명도를 0–100 으로 설정한다. layerId 를 생략하면 활성 레이어를 대상으로 한다. " +
      "**배경 레이어(isBackground: true)는 다르게 동작한다** — 배경은 반투명할 수 없기 때문이다. " +
      "Photoshop 이 일반 레이어로 승격시키면 id 와 이름이 바뀌므로 반환값의 id 를 그대로 쓴다. " +
      "거부하면 실패로 보고하며 문서는 바뀌지 않는다 — 그때는 layer.duplicate 로 복제본을 만들어 쓴다. " +
      "둘 중 어느 쪽이 될지는 Photoshop 이 정한다.",
    "edit",
    LayerOpacityParamsSchema,
    LAYER_OPACITY,
    engine,
  );
}
