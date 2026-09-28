import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  CHANNEL_CREATE,
  CHANNEL_DELETE,
  CHANNEL_DUPLICATE,
  CHANNEL_GET,
  CHANNEL_LIST,
  CHANNEL_SELECT,
  ChannelCreateParamsSchema,
  ChannelDeleteParamsSchema,
  ChannelDuplicateParamsSchema,
  ChannelGetParamsSchema,
  ChannelListParamsSchema,
  ChannelSelectParamsSchema,
  type ChannelCreateParams,
  type ChannelDeleteParams,
  type ChannelDeleteResult,
  type ChannelDetail,
  type ChannelDuplicateParams,
  type ChannelGetParams,
  type ChannelInfo,
  type ChannelListParams,
  type ChannelListResult,
  type ChannelSelectParams,
  type ChannelSelectResult,
} from "../commands/channel.js";

/**
 * 채널 Tool. (ROADMAP §56)
 *
 * **전부 DOM 이다** — descriptor 를 한 번도 잡지 않았다.
 */

/** 이름·색인 둘 중 하나로 고르는 Tool 이 공유하는 문장. */
const TARGET =
  "name 또는 index 중 **정확히 하나**를 준다. index 는 photoshop.channel.list 의 순서다. ";

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

/** `photoshop.channel.list` */
export function createChannelListTool(
  engine: CommandEngine,
): ToolDefinition<ChannelListParams, ChannelListResult> {
  return create(
    "photoshop.channel.list",
    "활성 문서의 채널을 전부 돌려준다. **isComponent 가 색 성분(R·G·B 등)과 알파 채널을 가른다.** " +
      "**이름은 Photoshop 언어를 따른다** — 한국어 환경에서는 빨강 · 녹색 · 파랑 이다. " +
      "kind 는 component · maskedAreas 같은 값이다. " +
      "photoshop.selection.save_channel 이 만든 채널이 여기 보인다 — " +
      "**이름을 확인하지 않고 photoshop.selection.load_channel 을 부르면 " +
      "'\"설정\" 명령은 현재 사용할 수 없습니다' 만 돌아온다.** 먼저 이것으로 본다. " +
      "문서를 바꾸지 않는다.",
    "read",
    ChannelListParamsSchema,
    CHANNEL_LIST,
    engine,
  );
}

/** `photoshop.channel.get` */
export function createChannelGetTool(
  engine: CommandEngine,
): ToolDefinition<ChannelGetParams, ChannelDetail> {
  return create(
    "photoshop.channel.get",
    "채널 하나를 돌려준다. " +
      TARGET +
      "histogram: true 를 주면 **256칸 히스토그램**을 함께 준다 — 기본은 끔이다. " +
      "**알파 채널만 되고, 그 채널이 보이는 상태여야 한다**(실기 확인). " +
      "색 성분 채널(R·G·B)은 거절한다 — 그쪽 분포는 photoshop.document.statistics 가 준다. " +
      "안 보이면 photoshop.channel.select 로 먼저 보이게 한다. " +
      "**statistics 와 다른 축이다** — 그쪽은 문서나 레이어를 64칸으로 요약하고 " +
      "채널별 평균·노이즈를 함께 주며, 이쪽은 **저장해 둔 알파 채널**을 256칸으로 본다. " +
      "마스크로 쓸 채널의 분포를 확인할 때 쓴다. 문서를 바꾸지 않는다.",
    "read",
    ChannelGetParamsSchema,
    CHANNEL_GET,
    engine,
  );
}

/** `photoshop.channel.create` */
export function createChannelCreateTool(
  engine: CommandEngine,
): ToolDefinition<ChannelCreateParams, ChannelInfo> {
  return create(
    "photoshop.channel.create",
    "빈 알파 채널을 만든다. name 을 주면 그 이름으로 둔다. " +
      "**선택 영역을 저장하려는 것이면 photoshop.selection.save_channel 이 맞다** — " +
      "그쪽은 만들면서 내용까지 채운다. 이쪽은 빈 채널이다. " +
      "만든 뒤 개수가 실제로 늘었는지 확인하고 답한다.",
    "edit",
    ChannelCreateParamsSchema,
    CHANNEL_CREATE,
    engine,
  );
}

/** `photoshop.channel.select` */
export function createChannelSelectTool(
  engine: CommandEngine,
): ToolDefinition<ChannelSelectParams, ChannelSelectResult> {
  return create(
    "photoshop.channel.select",
    "편집 대상 채널을 고른다. names 에 photoshop.channel.list 의 이름을 순서대로 준다. " +
      "**이후의 필터·조정이 고른 채널에만 걸린다** — 끝나면 색 성분 채널 전부로 " +
      "되돌려야 한다. 되돌리지 않으면 다음 작업이 조용히 한 채널에만 걸린다. " +
      "**고른 채널이 보이게 되고 나머지는 숨는다** — photoshop.channel.get 의 " +
      "histogram 이 보이는 채널만 허용하므로 그것을 읽기 전에 이것을 부른다. " +
      "채널 이름은 Photoshop 언어를 따른다 — 한국어 환경에서는 빨강 · 녹색 · 파랑 이다. " +
      "**photoshop.mask.select 와 다른 축이다** — 그쪽은 '레이어 픽셀이냐 마스크냐' 를 " +
      "고르고 이쪽은 '어느 채널이냐' 를 고른다. " +
      "결과의 active 는 요청이 아니라 **건 뒤 다시 읽은 값**이다.",
    "edit",
    ChannelSelectParamsSchema,
    CHANNEL_SELECT,
    engine,
  );
}

/** `photoshop.channel.duplicate` */
export function createChannelDuplicateTool(
  engine: CommandEngine,
): ToolDefinition<ChannelDuplicateParams, ChannelInfo> {
  return create(
    "photoshop.channel.duplicate",
    "채널을 복제한다. " +
      TARGET +
      "저장해 둔 마스크를 건드리기 전에 사본을 떠 둘 때 쓴다 — " +
      "채널 편집에는 History 말고 되돌릴 길이 없다. " +
      "복제 뒤 개수가 실제로 늘었는지 확인하고 답한다.",
    "edit",
    ChannelDuplicateParamsSchema,
    CHANNEL_DUPLICATE,
    engine,
  );
}

/** `photoshop.channel.delete` */
export function createChannelDeleteTool(
  engine: CommandEngine,
): ToolDefinition<ChannelDeleteParams, ChannelDeleteResult> {
  return create(
    "photoshop.channel.delete",
    "알파 채널을 지운다. " +
      TARGET +
      "**색 성분 채널(R·G·B 등)은 거절한다** — 지우면 문서의 색이 망가지고 " +
      "History 말고 되돌릴 길이 없다. photoshop.channel.list 의 isComponent 로 가른다. " +
      "지운 뒤 목록을 다시 읽어 **확인한 것만** 답한다. " +
      "저장해 둔 선택 영역을 버리는 일이므로 destructive 다 — " +
      "잠깐 감추려는 것이면 photoshop.channel.list 로 확인만 하고 두는 편이 낫다.",
    "destructive",
    ChannelDeleteParamsSchema,
    CHANNEL_DELETE,
    engine,
  );
}
