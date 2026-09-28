import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_LIST,
  DocumentListParamsSchema,
  type DocumentListParams,
  type DocumentListResult,
} from "../commands/document-list.js";

/** `photoshop.document.list` — 열려 있는 문서 전부. */
export function createDocumentListTool(
  engine: CommandEngine,
): ToolDefinition<DocumentListParams, DocumentListResult> {
  return {
    name: "photoshop.document.list",
    description:
      "열려 있는 문서를 전부 돌려준다. photoshop.document.get 은 활성 문서 하나만 주므로 " +
      "문서를 여러 개 열어 두고 오갈 때 이것으로 먼저 무엇이 있는지 본다. " +
      "각 항목은 document.get 과 같은 필드에 **active 가 더해진다** — 편집 Tool 은 " +
      "대상을 생략하면 활성 문서를 쓰므로 어느 것이 활성인지 모르면 결과를 예측할 수 없다. " +
      "**문서가 하나도 없으면 빈 배열이고 오류가 아니다** — Photoshop 을 켜 두고 " +
      "아무것도 안 연 상태는 정상이다. document.get 이 DOCUMENT_NOT_FOUND 를 던지는 것과 " +
      "다르다. 문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: DocumentListParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentListResult>(
        { type: DOCUMENT_LIST, params: input },
        { requestId: context.requestId },
      ),
  };
}
