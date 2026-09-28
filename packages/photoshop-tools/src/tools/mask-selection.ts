import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  MASK_CREATE,
  MASK_DISABLE,
  MASK_APPLY,
  MASK_SELECT,
  MASK_ENABLE,
  MaskCreateParamsSchema,
  MaskSelectParamsSchema,
  MaskToggleParamsSchema,
  SELECTION_CLEAR,
  SELECTION_INVERT,
  SelectionParamsSchema,
  type MaskCreateParams,
  type MaskSelectParams,
  type MaskSelectResult,
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

export function createMaskApplyTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, LayerInfo> {
  return {
    name: "photoshop.mask.apply",
    description:
      "레이어 마스크를 픽셀에 굽고 없앤다. layerId 를 생략하면 활성 레이어. " +
      "**가려 둔 것이 실제로 사라진다** — 마스크는 픽셀을 가릴 뿐이라 끄거나 " +
      "지우면 다시 드러난다. 가려진 곳이 투명해지고 마스크 없는 픽셀 레이어가 " +
      "된다. 마스크가 없는 레이어에는 쓸 수 없다 — layer.list 의 hasMask 로 " +
      "먼저 확인한다. History 로 되돌릴 수 있다.",
    permission: "destructive",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: MASK_APPLY, params: input },
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

/**
 * `photoshop.mask.select` — 편집 대상을 마스크와 픽셀 사이에서 바꾼다.
 *
 * **양방향을 한 Tool 이 갖는다.** 둘로 나누면 돌아오는 쪽을 빠뜨릴 수 있고,
 * 그러면 그 뒤의 모든 편집이 조용히 마스크에 걸린다.
 */
export function createMaskSelectTool(
  engine: CommandEngine,
): ToolDefinition<MaskSelectParams, MaskSelectResult> {
  return {
    name: "photoshop.mask.select",
    description:
      "편집 대상을 레이어 마스크로 옮긴다. target: pixels 로 되돌린다. " +
      "layerId 를 생략하면 활성 레이어. **필터와 조정은 지금 선택된 채널에 걸린다** — " +
      "마스크를 대상으로 두면 filter.gaussian_blur 가 마스크 경계를 부드럽게 하고 " +
      "adjustment.curves 가 마스크의 세기를 조절한다. 마스크 자체를 다듬는 길이다. " +
      "**끝나면 반드시 target: pixels 로 되돌린다** — 옮겨 둔 채로 두면 뒤따르는 " +
      "편집이 전부 마스크에 걸리고 오류는 나지 않는다. " +
      "마스크가 없는 레이어에는 거절한다 — photoshop.mask.create 로 먼저 만든다. " +
      "대상을 스스로 정하는 mask.dab · mask.gradient 는 이 Tool 과 무관하다. " +
      "**결과의 verified 는 Photoshop 에 물어 확인한 값이고 요청값을 되풀이한 것이 " +
      "아니다** — pixels 면 구성 채널이 활성임을, mask 면 활성이 아님을 확인했다는 뜻이다. " +
      "activeChannels 는 pixels 일 때 구성 채널 이름이고 mask 일 때는 null 이다.",
    permission: "edit",
    inputSchema: MaskSelectParamsSchema,
    handler: async (input, context) =>
      engine.execute<MaskSelectResult>(
        { type: MASK_SELECT, params: input },
        { requestId: context.requestId },
      ),
  };
}
