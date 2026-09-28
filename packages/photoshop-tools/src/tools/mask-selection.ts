import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  MASK_CREATE,
  MASK_DISABLE,
  MASK_APPLY,
  MASK_DELETE,
  MASK_LINK,
  MASK_UNLINK,
  MASK_INVERT,
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
  type MaskInvertResult,
  type MaskSelectResult,
  type MaskLinkResult,
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

/**
 * `photoshop.mask.delete` — 마스크를 버린다. (ROADMAP §50)
 *
 * `apply` 와 짝이고 **descriptor 에서 `apply` 플래그 하나만 다르다.**
 */
export function createMaskDeleteTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, LayerInfo> {
  return {
    name: "photoshop.mask.delete",
    description:
      "레이어 마스크를 버린다. layerId 를 생략하면 활성 레이어. " +
      "**가려 둔 픽셀이 전부 되살아난다** — 굽는 photoshop.mask.apply 와 반대다. " +
      "셋을 가른다: apply 는 가린 픽셀이 사라지고, delete 는 가린 픽셀이 " +
      "되살아나며 마스크만 사라지고, photoshop.mask.disable 은 아무것도 " +
      "사라지지 않고 다시 켤 수 있다. " +
      "**destructive 인 이유는 픽셀이 아니라 마스크다** — mask.dab · mask.gradient 로 " +
      "다듬어 쌓은 것이 한 번에 사라진다. 잠깐 꺼 보려는 것이면 mask.disable 이다. " +
      "마스크가 없는 레이어는 거절한다 — layer.list 의 hasMask 로 먼저 확인한다.",
    permission: "destructive",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: MASK_DELETE, params: input },
        { requestId: context.requestId },
      ),
  };
}

/**
 * 연결 셋 공유 문장. (ROADMAP §51)
 */
const LINK_NOTE =
  "마스크가 레이어에 연결되어 있으면 **레이어를 옮길 때 마스크도 함께 움직인다**. " +
  "끊으면 따로 논다 — 마스크는 그 자리에 두고 안쪽 그림만 옮기고 싶을 때다. " +
  "layerId 를 생략하면 활성 레이어. 마스크가 없는 레이어는 거절한다. " +
  "**결과의 linked 는 걸고 나서 다시 읽은 값이고 applied 가 실제로 들어갔는지 말한다** — " +
  "읽지 못하면 둘 다 null 이다. 마스크를 없애는 것이 아니므로 photoshop.mask.delete · " +
  "photoshop.mask.disable 과 다른 축이다. ";

export function createMaskLinkTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, MaskLinkResult> {
  return {
    name: "photoshop.mask.link",
    description: "레이어 마스크를 레이어에 연결한다. " + LINK_NOTE,
    permission: "edit",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<MaskLinkResult>(
        { type: MASK_LINK, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createMaskUnlinkTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, MaskLinkResult> {
  return {
    name: "photoshop.mask.unlink",
    description:
      "레이어 마스크의 연결을 끊는다. " +
      LINK_NOTE +
      "photoshop.layer.translate 로 레이어만 옮기려면 먼저 이것을 부른다.",
    permission: "edit",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<MaskLinkResult>(
        { type: MASK_UNLINK, params: input },
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

/**
 * `photoshop.mask.invert` — 마스크를 반전한다.
 *
 * `{_obj:"invert"}` 에 타깃이 없어 편집 대상을 잠깐 옮겼다 되돌린다.
 * 어디에 남겼는지를 `editTarget` 으로 드러낸다.
 */
export function createMaskInvertTool(
  engine: CommandEngine,
): ToolDefinition<MaskToggleParams, MaskInvertResult> {
  return {
    name: "photoshop.mask.invert",
    description:
      "레이어 마스크를 반전한다. 가려지던 곳이 드러나고 드러나던 곳이 가려진다. " +
      "layerId 를 생략하면 활성 레이어. 마스크가 없으면 거절한다. " +
      "**광도 마스크를 만든 뒤 반대쪽이 필요할 때 쓴다** — selection.luminosity 를 " +
      "다시 불러 마스크를 새로 만드는 것보다 짧고, 이미 손으로 다듬어 둔 마스크를 " +
      "잃지 않는다. 선택 영역을 뒤집는 selection.invert 와 다른 물건이다. " +
      "되돌리려면 한 번 더 부른다 — History 로도 되돌아간다. " +
      "**결과의 editTarget 은 반전 뒤 편집 대상이다.** 이 Tool 은 대상을 잠깐 " +
      "마스크로 옮겼다 부르기 전 상태로 되돌리는데, 어디에 남겼는지를 알아야 " +
      "뒤따르는 필터·조정이 어디에 걸리는지 알 수 있다.",
    permission: "edit",
    inputSchema: MaskToggleParamsSchema,
    handler: async (input, context) =>
      engine.execute<MaskInvertResult>(
        { type: MASK_INVERT, params: input },
        { requestId: context.requestId },
      ),
  };
}
