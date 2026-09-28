import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  PATH_CREATE,
  PATH_DELETE,
  PATH_FILL,
  PATH_GET,
  PATH_LIST,
  PATH_SELECT,
  PATH_STROKE,
  PATH_TO_SELECTION,
  PathCreateParamsSchema,
  PathDeleteParamsSchema,
  PathFillParamsSchema,
  PathGetParamsSchema,
  PathListParamsSchema,
  PathSelectParamsSchema,
  PathStrokeParamsSchema,
  PathToSelectionParamsSchema,
  type PathCreateParams,
  type PathDeleteParams,
  type PathDeleteResult,
  type PathFillParams,
  type PathGetParams,
  type PathInfo,
  type PathListParams,
  type PathListResult,
  type PathSelectParams,
  type PathStrokeParams,
  type PathToSelectionParams,
  type PathToSelectionResult,
} from "../commands/path.js";

/**
 * 패스 Tool. (ROADMAP §58)
 *
 * **전부 DOM 이다** — descriptor 를 한 번도 잡지 않았다.
 */

const TARGET =
  "name 또는 index 중 **정확히 하나**를 준다. index 는 photoshop.path.list 의 순서다. " +
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

/** `photoshop.path.list` */
export function createPathListTool(
  engine: CommandEngine,
): ToolDefinition<PathListParams, PathListResult> {
  return create(
    "photoshop.path.list",
    "활성 문서의 패스를 전부 돌려준다. **패스는 해상도에 매이지 않는 벡터 윤곽**이다 — " +
      "선택 영역과 달리 저장되고 언제든 다시 선택으로 바꿀 수 있다. " +
      "kind 는 실기에서 **normalPath**(저장된 패스)와 **workPathIndex**(작업 패스)를 " +
      "확인했다 — 상수 이름(WORKPATH)과 런타임 값이 다르므로 목록으로 본다. " +
      "subPathCount 는 하위 패스 개수다. 문서를 바꾸지 않는다.",
    "read",
    PathListParamsSchema,
    PATH_LIST,
    engine,
  );
}

/** `photoshop.path.get` */
export function createPathGetTool(engine: CommandEngine): ToolDefinition<PathGetParams, PathInfo> {
  return create(
    "photoshop.path.get",
    "패스 하나를 돌려준다. " + TARGET + "문서를 바꾸지 않는다.",
    "read",
    PathGetParamsSchema,
    PATH_GET,
    engine,
  );
}

/** `photoshop.path.create` */
export function createPathCreateTool(
  engine: CommandEngine,
): ToolDefinition<PathCreateParams, PathInfo> {
  return create(
    "photoshop.path.create",
    "**현재 선택 영역에서** 패스를 만든다. 선택이 없으면 거절한다. " +
      "photoshop.selection.sky · subject · polygon · color_range 로 만든 선택을 " +
      "벡터 윤곽으로 굳힐 때 쓴다 — 선택은 다음 작업에서 쉽게 사라지지만 패스는 남는다. " +
      "tolerance 는 곡선 단순화 정도(0.5~10, 기본 2)다 — **작을수록 선택에 가깝고 " +
      "점이 많아진다**. **name 을 주면 저장된 패스(normalPath)가 되고, 생략하면 " +
      "'작업 패스'(workPathIndex)로 남아 다음에 덮어쓰인다** — 실기에서 확인했다. " +
      "**좌표로 직접 그리는 통로는 없다** — Photoshop 이 요구하는 베지어 기하 " +
      "(SubPathInfo)의 인터페이스 문서가 없어 짐작해 넘기지 않았다. " +
      "반대 방향은 photoshop.path.to_selection 이다.",
    "edit",
    PathCreateParamsSchema,
    PATH_CREATE,
    engine,
  );
}

/** `photoshop.path.select` */
export function createPathSelectTool(
  engine: CommandEngine,
): ToolDefinition<PathSelectParams, PathInfo> {
  return create(
    "photoshop.path.select",
    "패스를 선택 상태로 만든다. " +
      TARGET +
      "selected: false 를 주면 해제한다. " +
      "**선택 영역과 다른 물건이다** — 패스 패널에서 그 패스가 골라진 상태가 되는 것이고 " +
      "픽셀 선택은 생기지 않는다. 선택 영역이 필요하면 photoshop.path.to_selection 이다.",
    "edit",
    PathSelectParamsSchema,
    PATH_SELECT,
    engine,
  );
}

/** `photoshop.path.to_selection` */
export function createPathToSelectionTool(
  engine: CommandEngine,
): ToolDefinition<PathToSelectionParams, PathToSelectionResult> {
  return create(
    "photoshop.path.to_selection",
    "패스를 선택 영역으로 바꾼다. " +
      TARGET +
      "feather 는 가장자리 페더(픽셀), antiAlias 는 기본 true. " +
      "mode 는 replace(기본) · add · subtract · intersect 로 기존 선택과 어떻게 합칠지다. " +
      "**패스는 해상도에 매이지 않으므로 문서를 키운 뒤에도 깨끗한 선택을 준다** — " +
      "선택을 채널로 저장하는 photoshop.selection.save_channel 과 갈리는 자리다. " +
      "그쪽은 픽셀이라 확대하면 뭉개진다. " +
      "photoshop.path.create 의 반대 방향이다.",
    "edit",
    PathToSelectionParamsSchema,
    PATH_TO_SELECTION,
    engine,
  );
}

/** `photoshop.path.fill` */
export function createPathFillTool(
  engine: CommandEngine,
): ToolDefinition<PathFillParams, PathInfo> {
  return create(
    "photoshop.path.fill",
    "패스 안을 색으로 채운다. " +
      TARGET +
      "color 는 {red, green, blue} 0~255, opacity 는 0~100 이다. " +
      "**활성 레이어의 픽셀에 칠한다** — 조정 레이어나 그룹이 활성이면 Photoshop 이 " +
      "거절하므로 photoshop.layer.select 로 픽셀 레이어를 먼저 고른다. " +
      "wholePath: false 면 선택된 하위 패스만, preserveTransparency: true 면 " +
      "투명한 곳을 보호한다. " +
      "**혼합 모드는 열지 않았다** — 색과 불투명도로 충분하고 필요해지면 그때 더한다.",
    "edit",
    PathFillParamsSchema,
    PATH_FILL,
    engine,
  );
}

/** `photoshop.path.stroke` */
export function createPathStrokeTool(
  engine: CommandEngine,
): ToolDefinition<PathStrokeParams, PathInfo> {
  return create(
    "photoshop.path.stroke",
    "패스를 따라 선을 긋는다. " +
      TARGET +
      "**굵기와 색을 정할 수 없다. 그 도구의 Photoshop 현재 설정을 그대로 쓴다** — " +
      "strokePath 에 그것을 주는 인자가 없다. 실기에서 브러시 크기를 모른 채 " +
      "eraser 로 그었더니 **200×150 타원이 통째로 지워졌다** — 획이 아니라 전면이었다. " +
      "브러시가 무엇으로 설정돼 있는지 읽을 방법도 없다. " +
      "**예측 가능한 결과가 필요하면 photoshop.path.fill 을 쓴다** — 그쪽은 색과 " +
      "불투명도를 받는다. 이 Tool 은 사용자가 브러시를 맞춰 둔 것을 아는 경우에만 쓴다. " +
      "tool 은 brush(기본) · pencil · eraser · cloneStamp · dodge · burn 등 16가지, " +
      "simulatePressure: true 면 양 끝이 가늘어진다. " +
      "**활성 레이어에 그려지므로 픽셀 레이어를 먼저 고르고, 건 뒤에는 반드시 " +
      "photoshop.document.capture 나 statistics 로 확인한다.**",
    "edit",
    PathStrokeParamsSchema,
    PATH_STROKE,
    engine,
  );
}

/** `photoshop.path.delete` */
export function createPathDeleteTool(
  engine: CommandEngine,
): ToolDefinition<PathDeleteParams, PathDeleteResult> {
  return create(
    "photoshop.path.delete",
    "패스를 지운다. " +
      TARGET +
      "**저장해 둔 윤곽을 버리는 일이다** — 이미 칠하거나 그은 픽셀은 남고 " +
      "윤곽만 사라진다. 지운 뒤 개수를 다시 읽어 확인한 것만 답한다.",
    "destructive",
    PathDeleteParamsSchema,
    PATH_DELETE,
    engine,
  );
}
