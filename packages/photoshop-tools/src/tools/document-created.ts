import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_CLOSE_CREATED,
  DOCUMENT_LIST_CREATED,
  DocumentCloseCreatedParamsSchema,
  type DocumentCloseCreatedResult,
  DocumentListCreatedParamsSchema,
  type DocumentListCreatedResult,
} from "../commands/document-created.js";

/** `photoshop.document.list_created` — 이 세션이 만든 문서. (ROADMAP §101) */
export function createDocumentListCreatedTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentListCreatedParamsSchema>, DocumentListCreatedResult> {
  return {
    name: "photoshop.document.list_created",
    description:
      "**이 서버가 만든 문서**(photoshop.document.duplicate · photoshop.document.create)를 모아 보여 준다 — " +
      "사용자가 열었거나 photoshop.document.open 으로 연 문서는 나오지 않는다. 닫기 전에 무엇이 닫힐지 " +
      "확인하는 용도다. 플러그인을 다시 띄우면 기록이 사라진다.",
    permission: "read",
    inputSchema: DocumentListCreatedParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentListCreatedResult>(
        { type: DOCUMENT_LIST_CREATED, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.document.close_created` — 이 세션이 만든 문서를 닫는다. (ROADMAP §101) */
export function createDocumentCloseCreatedTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentCloseCreatedParamsSchema>, DocumentCloseCreatedResult> {
  return {
    name: "photoshop.document.close_created",
    description:
      "시험용으로 만든 복제 문서를 정리한다. **이 서버가 만든 문서만** 닫는다 — 사용자가 연 문서는 id 를 " +
      "줘도 건드리지 않고 notCreated 로 알린다. documentIds 를 생략하면 만든 것 전부. 먼저 " +
      "photoshop.document.list_created 로 확인한다. **저장하지 않고 닫는다** — discardChanges: true 를 " +
      "명시해야 하며, 복제본에 쌓은 보정은 사라진다(저장하려면 먼저 photoshop.document.save_as). " +
      "범위가 한정되어 edit 이다. 활성 문서를 닫으면 Photoshop 이 다른 문서를 활성으로 만들므로 결과의 " +
      "activeDocumentId 를 읽는다. 닫혔는지는 닫은 뒤 목록을 다시 읽어 확인한 값이다.",
    permission: "edit",
    inputSchema: DocumentCloseCreatedParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentCloseCreatedResult>(
        { type: DOCUMENT_CLOSE_CREATED, params: input },
        { requestId: context.requestId },
      ),
  };
}
