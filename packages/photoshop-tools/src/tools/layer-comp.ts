import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_COMP_APPLY,
  LAYER_COMP_CREATE,
  LAYER_COMP_DELETE,
  LAYER_COMP_GET,
  LAYER_COMP_LIST,
  LAYER_COMP_RECAPTURE,
  LayerCompApplyParamsSchema,
  LayerCompCreateParamsSchema,
  LayerCompDeleteParamsSchema,
  LayerCompGetParamsSchema,
  LayerCompListParamsSchema,
  LayerCompRecaptureParamsSchema,
  type LayerCompApplyParams,
  type LayerCompCreateParams,
  type LayerCompDeleteParams,
  type LayerCompDeleteResult,
  type LayerCompGetParams,
  type LayerCompInfo,
  type LayerCompListParams,
  type LayerCompListResult,
  type LayerCompRecaptureParams,
} from "../commands/layer-comp.js";

/**
 * 레이어 컴프 Tool. (ROADMAP §57)
 *
 * 레이어의 표시 여부 · 위치 · 모양을 한 벌로 저장해 두고 오간다.
 */

/** 이름·색인으로 고르는 Tool 이 공유하는 문장. */
const TARGET =
  "name 또는 index 중 **정확히 하나**를 준다. index 는 photoshop.layer_comp.list 의 순서다. " +
  "**이름은 유일하지 않다** — 같은 이름이 여럿이면 거절하므로 그때는 index 를 쓴다. ";

function create<TParams, TResult>(
  name: string,
  description: string,
  permission: ToolDefinition<TParams, TResult>["permission"],
  schema: ToolDefinition<TParams, TResult>["inputSchema"],
  type: string,
  engine: CommandEngine,
): ToolDefinition<TParams, TResult> {
  return {
    name,
    description,
    permission,
    inputSchema: schema,
    handler: async (input, context) =>
      engine.execute<TResult>({ type, params: input }, { requestId: context.requestId }),
  };
}

/** `photoshop.layer_comp.list` */
export function createLayerCompListTool(
  engine: CommandEngine,
): ToolDefinition<LayerCompListParams, LayerCompListResult> {
  return create(
    "photoshop.layer_comp.list",
    "활성 문서의 레이어 컴프를 전부 돌려준다. " +
      "**레이어 컴프는 레이어의 표시 여부 · 위치 · 모양(레이어 스타일)을 한 벌로 " +
      "저장해 둔 것**이다 — 같은 문서로 여러 안을 만들어 오갈 때 쓴다. " +
      "appearance · position · visibility 는 그 컴프가 **무엇을 기억하는지**이고, " +
      "selected 는 지금 패널에서 골라져 있는지다. 문서를 바꾸지 않는다.",
    "read",
    LayerCompListParamsSchema,
    LAYER_COMP_LIST,
    engine,
  );
}

/** `photoshop.layer_comp.get` */
export function createLayerCompGetTool(
  engine: CommandEngine,
): ToolDefinition<LayerCompGetParams, LayerCompInfo> {
  return create(
    "photoshop.layer_comp.get",
    "레이어 컴프 하나를 돌려준다. " + TARGET + "문서를 바꾸지 않는다.",
    "read",
    LayerCompGetParamsSchema,
    LAYER_COMP_GET,
    engine,
  );
}

/** `photoshop.layer_comp.create` */
export function createLayerCompCreateTool(
  engine: CommandEngine,
): ToolDefinition<LayerCompCreateParams, LayerCompInfo> {
  return create(
    "photoshop.layer_comp.create",
    "**지금 문서 상태**를 레이어 컴프로 저장한다. name · comment 로 이름과 설명을 준다. " +
      "appearance(레이어 스타일) · position(위치) · visibility(표시 여부) · " +
      "childComp(스마트 오브젝트 안의 컴프)로 **무엇을 기억할지** 고른다 — " +
      "생략하면 Photoshop 기본이고 보통 표시 여부만 기록된다. " +
      "**결과는 요청값이 아니라 만든 뒤 다시 읽은 값이다** — 무엇이 실제로 켜졌는지 " +
      "여기서 확인한다. " +
      "photoshop.history.undo 와 다른 물건이다 — History 는 시간 순서이고 이쪽은 " +
      "이름 붙인 여러 안을 나란히 둔다.",
    "edit",
    LayerCompCreateParamsSchema,
    LAYER_COMP_CREATE,
    engine,
  );
}

/** `photoshop.layer_comp.apply` */
export function createLayerCompApplyTool(
  engine: CommandEngine,
): ToolDefinition<LayerCompApplyParams, LayerCompInfo> {
  return create(
    "photoshop.layer_comp.apply",
    "저장해 둔 레이어 컴프를 문서에 건다. " +
      TARGET +
      "**레이어의 표시 여부 · 위치 · 모양이 그 컴프가 기억한 대로 바뀐다** — " +
      "그 컴프가 기억하지 않는 항목은 건드리지 않는다(list 의 appearance · " +
      "position · visibility 로 무엇을 기억하는지 먼저 본다). " +
      "**지금 상태를 잃고 싶지 않으면 먼저 photoshop.layer_comp.create 로 저장한다** — " +
      "적용은 현재 배치를 덮어쓴다.",
    "edit",
    LayerCompApplyParamsSchema,
    LAYER_COMP_APPLY,
    engine,
  );
}

/** `photoshop.layer_comp.recapture` */
export function createLayerCompRecaptureTool(
  engine: CommandEngine,
): ToolDefinition<LayerCompRecaptureParams, LayerCompInfo> {
  return create(
    "photoshop.layer_comp.recapture",
    "레이어 컴프를 **지금 문서 상태로 덮어쓴다**. " +
      TARGET +
      "**저장해 둔 배치가 사라지고 History 말고 되돌릴 길이 없다** — 그래서 " +
      "destructive 다. 새 안을 만들려는 것이면 photoshop.layer_comp.create 가 맞다. " +
      "그쪽은 기존 컴프를 건드리지 않는다.",
    "destructive",
    LayerCompRecaptureParamsSchema,
    LAYER_COMP_RECAPTURE,
    engine,
  );
}

/** `photoshop.layer_comp.delete` */
export function createLayerCompDeleteTool(
  engine: CommandEngine,
): ToolDefinition<LayerCompDeleteParams, LayerCompDeleteResult> {
  return create(
    "photoshop.layer_comp.delete",
    "레이어 컴프를 지운다. " +
      TARGET +
      "**저장해 둔 배치를 버리는 일이다** — 문서의 레이어는 그대로 남고 " +
      "기록만 사라진다. 지운 뒤 개수를 다시 읽어 확인한 것만 답한다.",
    "destructive",
    LayerCompDeleteParamsSchema,
    LAYER_COMP_DELETE,
    engine,
  );
}
