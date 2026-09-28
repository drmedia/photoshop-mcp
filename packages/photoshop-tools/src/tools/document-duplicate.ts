import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_DUPLICATE,
  DocumentDuplicateParamsSchema,
  type DocumentDuplicateParams,
  type DocumentDuplicateResult,
} from "../commands/document-duplicate.js";

/** `photoshop.document.duplicate` — 활성 문서를 복제한다. */
export function createDocumentDuplicateTool(
  engine: CommandEngine,
): ToolDefinition<DocumentDuplicateParams, DocumentDuplicateResult> {
  return {
    name: "photoshop.document.duplicate",
    description:
      "활성 문서를 복제한다. 파일을 만들지 않고 메모리 안에 새 문서를 연다 — " +
      "저장은 document.save_as 다. " +
      "**되돌릴 수 없는 작업 앞에 쓴다** — image.resize · document.flatten · " +
      "mask.apply 를 복제본에서 하면 원본이 남는다. " +
      "mergeLayersOnly 는 **원본의 레이어를 합치는 것이 아니라** 합친 결과 한 장만 " +
      "복제본에 넣는다. 원본은 그대로다. 먹었는지는 결과의 layers 로 확인한다. " +
      "**복제본이 활성이 되는지는 결과의 activeDocumentId 로 확인한다** — 이후 편집 " +
      "Tool 은 대상을 생략하면 활성 문서를 쓰므로, 원본으로 돌아가려면 " +
      "photoshop.document.list 로 id 를 본다. " +
      "복제본이 어느 것인지 확인하지 못하면 추측하지 않고 실패한다 — 원본에 " +
      "되돌릴 수 없는 작업을 거는 것보다 낫다.",
    permission: "edit",
    inputSchema: DocumentDuplicateParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentDuplicateResult>(
        { type: DOCUMENT_DUPLICATE, params: input },
        { requestId: context.requestId },
      ),
  };
}
