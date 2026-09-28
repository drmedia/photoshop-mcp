import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  SELECTION_POLYGON,
  SELECTION_ROTATE_BOUNDARY,
  SELECTION_SCALE_BOUNDARY,
  SELECTION_TRANSLATE_BOUNDARY,
  SelectionPolygonParamsSchema,
  SelectionRotateBoundaryParamsSchema,
  SelectionScaleBoundaryParamsSchema,
  SelectionTranslateBoundaryParamsSchema,
  type SelectionBoundaryResult,
  type SelectionPolygonParams,
  type SelectionResult,
  type SelectionRotateBoundaryParams,
  type SelectionScaleBoundaryParams,
  type SelectionTranslateBoundaryParams,
} from "../commands/selection-dom.js";

/**
 * 경계 변형 셋이 공유하는 문장.
 *
 * **선택 자체만 움직이고 픽셀은 건드리지 않는다** — 레퍼런스가 "Does not
 * affect the active layer" 라고 적는다. 그래서 `layer.*` 변환과 갈린다.
 */
const BOUNDARY_NOTE =
  "**선택 경계만 움직이고 픽셀은 건드리지 않는다** — 레이어를 옮기려면 " +
  "photoshop.layer.translate · layer.scale · layer.rotate 쪽이다. " +
  "선택이 없으면 거절한다. 결과의 before 와 bounds 로 얼마나 움직였는지 확인한다. ";

function createSelectionTool<TParams, TResult>(
  name: string,
  description: string,
  schema: ToolDefinition<TParams, TResult>["inputSchema"],
  type: string,
  engine: CommandEngine,
): ToolDefinition<TParams, TResult> {
  return {
    name,
    description,
    permission: "edit",
    inputSchema: schema,
    handler: async (input, context) =>
      engine.execute<TResult>({ type, params: input }, { requestId: context.requestId }),
  };
}

/** `photoshop.selection.translate_boundary` — 선택 경계를 옮긴다. */
export function createSelectionTranslateBoundaryTool(
  engine: CommandEngine,
): ToolDefinition<SelectionTranslateBoundaryParams, SelectionBoundaryResult> {
  return createSelectionTool(
    "photoshop.selection.translate_boundary",
    "선택 경계를 옮긴다. deltaX · deltaY 는 **픽셀**이고 양수가 오른쪽·아래다. " +
      "최소 하나는 줘야 한다. " +
      BOUNDARY_NOTE +
      "마스크를 만들 위치를 미세하게 맞출 때 쓴다 — 선택을 다시 만들지 않아도 된다.",
    SelectionTranslateBoundaryParamsSchema,
    SELECTION_TRANSLATE_BOUNDARY,
    engine,
  );
}

/** `photoshop.selection.scale_boundary` — 선택 경계 크기를 바꾼다. */
export function createSelectionScaleBoundaryTool(
  engine: CommandEngine,
): ToolDefinition<SelectionScaleBoundaryParams, SelectionBoundaryResult> {
  return createSelectionTool(
    "photoshop.selection.scale_boundary",
    "선택 경계 크기를 바꾼다. horizontal · vertical 은 **퍼센트**이고 100 이 제자리다 — " +
      "픽셀 크기가 아니다. 최소 하나는 줘야 한다. " +
      BOUNDARY_NOTE +
      "anchor 는 어느 점을 고정할지다(9가지). interpolation 으로 보간을 고른다(6가지). " +
      "**가장자리를 고르게 넓히거나 좁히려면 photoshop.selection.modify 의 expand · " +
      "contract 가 맞다** — 이쪽은 비율로 늘리므로 모양이 달라진다.",
    SelectionScaleBoundaryParamsSchema,
    SELECTION_SCALE_BOUNDARY,
    engine,
  );
}

/** `photoshop.selection.rotate_boundary` — 선택 경계를 돌린다. */
export function createSelectionRotateBoundaryTool(
  engine: CommandEngine,
): ToolDefinition<SelectionRotateBoundaryParams, SelectionBoundaryResult> {
  return createSelectionTool(
    "photoshop.selection.rotate_boundary",
    "선택 경계를 돌린다. angle 은 **도**이고 -360 ~ 360 이다. " +
      "**시계 방향이 양수**라고 Adobe 레퍼런스가 명시한다. " +
      BOUNDARY_NOTE +
      "anchor 는 어느 점을 중심으로 돌릴지다(9가지). interpolation 으로 보간을 고른다(6가지). " +
      "기울어진 수평선을 따라 마스크를 맞출 때 쓴다 — 문서를 돌리는 " +
      "photoshop.document.rotate 와 달리 픽셀은 그대로다.",
    SelectionRotateBoundaryParamsSchema,
    SELECTION_ROTATE_BOUNDARY,
    engine,
  );
}

/** `photoshop.selection.polygon` — 다각형으로 선택한다. */
export function createSelectionPolygonTool(
  engine: CommandEngine,
): ToolDefinition<SelectionPolygonParams, SelectionResult> {
  return createSelectionTool(
    "photoshop.selection.polygon",
    "다각형으로 선택한다. points 는 문서 픽셀 좌표 {x, y} 배열이고 **셋 이상**이어야 " +
      "면적이 있다. 마지막 점과 첫 점은 자동으로 이어진다. " +
      "**photoshop.selection.set 의 rectangle · ellipse 로 만들 수 없는 모양**이다 — " +
      "하늘과 지상의 경계처럼 꺾인 선을 따라가야 할 때 쓴다. " +
      "mode 는 replace(기본) · add · subtract · intersect 로, 이미 있는 선택과 어떻게 " +
      "합칠지다. feather 는 가장자리 페더(픽셀), antiAlias 는 기본 true. " +
      "**피사체나 하늘은 photoshop.selection.subject · selection.sky 가 낫다** — " +
      "Photoshop 이 형태를 알아서 잡는다. 이쪽은 좌표를 직접 줄 때다.",
    SelectionPolygonParamsSchema,
    SELECTION_POLYGON,
    engine,
  );
}
