import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_ACTIVATE,
  DocumentActivateParamsSchema,
  type DocumentActivateResult,
} from "../commands/document-activate.js";

/** `photoshop.document.activate` — 활성 문서를 옮긴다. (ROADMAP §101) */
export function createDocumentActivateTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentActivateParamsSchema>, DocumentActivateResult> {
  return {
    name: "photoshop.document.activate",
    description:
      "열려 있는 문서로 **활성 문서를 옮긴다.** 편집 Tool 은 전부 활성 문서에 걸리므로, 참조 이미지와 " +
      "작업 문서가 함께 열려 있을 때 사용자에게 탭을 눌러 달라고 부탁하지 않고 직접 옮긴다. " +
      "documentId(photoshop.document.list 의 id)나 name 중 **정확히 하나**를 준다. name 은 유일할 때만 " +
      "되고 같은 이름이 둘 이상이면 거절한다. " +
      "결과의 document 는 옮긴 뒤 다시 읽은 활성 문서이고 previousId 로 돌아올 수 있다. changed 가 " +
      "false 면 이미 활성이어서 아무것도 하지 않은 것이다. method 는 옮긴 방법(setter · batchPlay)이다. " +
      "문서의 내용은 바뀌지 않는다. **참조 문서를 보고 난 뒤에는 previousId 로 되돌아온다** — 활성 " +
      "문서를 모르고 편집하면 엉뚱한 문서가 바뀐다.",
    permission: "edit",
    inputSchema: DocumentActivateParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentActivateResult>(
        { type: DOCUMENT_ACTIVATE, params: input },
        { requestId: context.requestId },
      ),
  };
}
