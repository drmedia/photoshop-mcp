import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_MERGE_VISIBLE,
  DocumentMergeVisibleParamsSchema,
  type DocumentMergeVisibleParams,
  type MergeVisibleResult,
} from "../commands/document-merge.js";

/** `photoshop.document.merge_visible` — 보이는 레이어를 하나로 합친다. */
export function createDocumentMergeVisibleTool(
  engine: CommandEngine,
): ToolDefinition<DocumentMergeVisibleParams, MergeVisibleResult> {
  return {
    name: "photoshop.document.merge_visible",
    description:
      "보이는 레이어를 하나로 합친다(레이어 > 보이는 레이어 병합). " +
      "**비슷한 Tool 이 셋이고 셋 다 다르다.** " +
      "photoshop.layer.stamp_visible 은 합친 **복제본**을 만들고 원본을 남긴다(비파괴). " +
      "이 Tool 은 보이는 것을 합치고 **원본이 사라지되 숨긴 레이어는 남는다**. " +
      "photoshop.document.flatten 은 전부 합치고 **숨긴 레이어를 버린다**. " +
      "되돌릴 수 있는 쪽을 원하면 stamp_visible 이다 — 대개 그쪽이 맞다. " +
      "보이는 레이어가 하나뿐이면 합칠 것이 없어 거절한다. " +
      "**활성 레이어가 숨겨져 있으면 거절한다** — 그 상태로 부르면 Photoshop 이 " +
      "오류 없이 아무 일도 하지 않는다(실기 확인). photoshop.layer.select 로 " +
      "보이는 레이어를 먼저 고른다. " +
      "결과의 before · after 로 무엇이 얼마나 줄었는지, 숨긴 것이 남았는지 확인한다. " +
      "**남는 레이어는 배경이 있으면 배경, 없으면 선택한 레이어다** — 실기에서 " +
      "확인했고 Adobe 레퍼런스와도 맞는다. flatten 이 언제나 배경으로 만드는 것과 " +
      "달리 이쪽은 배경이 없으면 배경을 만들지 않는다. " +
      "**activeLayer 는 병합 뒤 활성 레이어를 읽은 값이고 '이것이 결과다' 라는 " +
      "주장이 아니다** — 확실히 하려면 photoshop.layer.list 로 확인한다. " +
      "History 로 되돌릴 수 있지만 저장하면 끝이다.",
    permission: "destructive",
    inputSchema: DocumentMergeVisibleParamsSchema,
    handler: async (input, context) =>
      engine.execute<MergeVisibleResult>(
        { type: DOCUMENT_MERGE_VISIBLE, params: input },
        { requestId: context.requestId },
      ),
  };
}
