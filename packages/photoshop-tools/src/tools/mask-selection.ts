import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  MASK_CREATE,
  MASK_DISABLE,
  MASK_ENABLE,
  MaskCreateParamsSchema,
  MaskToggleParamsSchema,
  SELECTION_CLEAR,
  SELECTION_INVERT,
  SelectionParamsSchema,
  type MaskCreateParams,
  type MaskToggleParams,
  type SelectionParams,
  type SelectionResult,
} from "../commands/mask-selection.js";

/** Phase 4 마스크·선택 Tool. (ROADMAP §8.1, §8.2) */

export function createMaskCreateTool(
  engine: CommandEngine,
): ToolDefinition<MaskCreateParams, LayerInfo> {
  return {
    name: "photoshop.mask.create",
    description:
      "레이어에 마스크를 추가한다. from 은 revealAll(기본, 전부 보임) / hideAll(전부 가림) / fromSelection(현재 선택 영역). layerId 를 생략하면 활성 레이어. " +
      "결과의 hasMask · maskEnabled 로 실제로 붙었는지 확인할 수 있다. " +
      "배경 레이어는 마스크를 가질 수 없어 Photoshop 이 일반 레이어로 승격시키며 id 가 바뀐다.",
    permission: "edit",
    inputSchema: MaskCreateParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: MASK_CREATE, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createMaskEnableTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, LayerInfo> {
  return {
    name: "photoshop.mask.enable",
    description:
      "레이어 마스크를 활성화한다. layerId 를 생략하면 활성 레이어. " +
      "마스크가 없는 레이어에는 쓸 수 없다 — layer.list 의 hasMask 로 먼저 확인한다.",
    permission: "edit",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: MASK_ENABLE, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createMaskDisableTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, LayerInfo> {
  return {
    name: "photoshop.mask.disable",
    description:
      "레이어 마스크를 일시 해제한다. 마스크는 유지된다(hasMask 는 true, maskEnabled 만 false). " +
      "layerId 를 생략하면 활성 레이어.",
    permission: "edit",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: MASK_DISABLE, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createSelectionClearTool(
  engine: CommandEngine,
): ToolDefinition<SelectionParams, SelectionResult> {
  return {
    name: "photoshop.selection.clear",
    description: "선택 영역을 해제한다.",
    permission: "edit",
    inputSchema: SelectionParamsSchema,
    handler: async (input, context) =>
      engine.execute<SelectionResult>(
        { type: SELECTION_CLEAR, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createSelectionInvertTool(
  engine: CommandEngine,
): ToolDefinition<SelectionParams, SelectionResult> {
  return {
    name: "photoshop.selection.invert",
    description: "선택 영역을 반전한다. 선택 영역이 없으면 실패한다.",
    permission: "edit",
    inputSchema: SelectionParamsSchema,
    handler: async (input, context) =>
      engine.execute<SelectionResult>(
        { type: SELECTION_INVERT, params: input },
        { requestId: context.requestId },
      ),
  };
}
