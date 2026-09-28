import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_CREATE,
  DocumentCreateParamsSchema,
  type DocumentCreateParams,
  type DocumentCreateResult,
} from "../commands/document-create.js";

/** `photoshop.document.create` — 새 문서. */
export function createDocumentCreateTool(
  engine: CommandEngine,
): ToolDefinition<DocumentCreateParams, DocumentCreateResult> {
  return {
    name: "photoshop.document.create",
    description:
      "새 문서를 만든다. width · height 는 픽셀이고 필수다. " +
      "bitDepth 는 8 · 16 · 32 이고 천체사진에서는 16 이 기본이다 — 8비트로 떨어지면 " +
      "계조가 무너진다. mode 는 RGB · grayscale, fill 은 white · transparent · black. " +
      "**결과의 applied 로 요청한 값이 실제로 들어갔는지 확인한다** — 무시된 옵션을 " +
      "성공으로 보고하면 호출자가 16비트를 받은 줄 알고 8비트에 외부 처리기를 돌린다. " +
      "**새 문서가 활성이 된다.** 이후 편집 Tool 은 대상을 생략하면 이쪽을 쓰므로, " +
      "원래 문서로 돌아가려면 photoshop.document.list 로 id 를 확인한다. " +
      "파일을 만들지 않고 저장하지도 않는다 — 저장은 document.save_as 다.",
    permission: "edit",
    inputSchema: DocumentCreateParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentCreateResult>(
        { type: DOCUMENT_CREATE, params: input },
        { requestId: context.requestId },
      ),
  };
}
