import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  GUIDE_CREATE,
  GUIDE_DELETE,
  GUIDE_LIST,
  GuideCreateParamsSchema,
  GuideDeleteParamsSchema,
  GuideListParamsSchema,
  type GuideCreateParams,
  type GuideDeleteParams,
  type GuideDeleteResult,
  type GuideInfo,
  type GuideListParams,
  type GuideListResult,
} from "../commands/guide.js";

/**
 * 가이드 Tool. (ROADMAP §59)
 *
 * **전부 DOM 이다** — descriptor 를 한 번도 잡지 않았다.
 */

/** 셋이 공유하는 좌표 설명. */
const ORIGIN =
  "coordinate 는 **눈금자 원점에서의 픽셀**이다 — 캔버스 좌표가 아니다. " +
  "사용자가 원점을 옮겼으면 어긋나고, 그것을 읽을 방법은 없다. ";

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

/** `photoshop.guide.list` */
export function createGuideListTool(
  engine: CommandEngine,
): ToolDefinition<GuideListParams, GuideListResult> {
  return create(
    "photoshop.guide.list",
    "활성 문서의 가이드를 전부 돌려준다. direction 은 horizontal · vertical 이다. " +
      ORIGIN +
      "**가이드는 화면에만 보이고 내보낸 그림에는 안 나온다** — 구도를 잡는 보조선이다. " +
      "photoshop.document.crop 의 bounds 를 정할 때 기준으로 쓸 수 있다. " +
      "문서를 바꾸지 않는다.",
    "read",
    GuideListParamsSchema,
    GUIDE_LIST,
    engine,
  );
}

/** `photoshop.guide.create` */
export function createGuideCreateTool(
  engine: CommandEngine,
): ToolDefinition<GuideCreateParams, GuideInfo> {
  return create(
    "photoshop.guide.create",
    "가이드를 하나 놓는다. direction 은 horizontal(가로선) 또는 vertical(세로선)이다. " +
      ORIGIN +
      "캔버스 밖이나 음수도 Photoshop 이 받으므로 막지 않는다. " +
      "삼분할이면 가로 세로 각각 문서 크기의 1/3 · 2/3 에 놓는다. " +
      "만든 뒤 개수가 실제로 늘었는지 확인하고 답한다.",
    "edit",
    GuideCreateParamsSchema,
    GUIDE_CREATE,
    engine,
  );
}

/** `photoshop.guide.delete` */
export function createGuideDeleteTool(
  engine: CommandEngine,
): ToolDefinition<GuideDeleteParams, GuideDeleteResult> {
  return create(
    "photoshop.guide.delete",
    "가이드를 지운다. index 또는 id 중 **정확히 하나**를 준다 — 가이드에는 이름이 없다. " +
      "photoshop.guide.list 로 먼저 확인한다. " +
      "**색인은 지울 때마다 밀리고 id 는 안 밀린다**(실기 확인) — 여러 개를 지우려면 " +
      "id 를 쓴다. 색인을 쓸 거면 큰 것부터 지우거나 하나씩 지우고 목록을 다시 읽는다. " +
      "**지우는 것이 좌표 하나뿐이라 edit 다** — 마스크나 채널과 달리 쌓아 둔 작업이 " +
      "없고 같은 좌표로 다시 만들면 된다. " +
      "지운 뒤 개수를 다시 읽어 확인한 것만 답한다.",
    "edit",
    GuideDeleteParamsSchema,
    GUIDE_DELETE,
    engine,
  );
}
