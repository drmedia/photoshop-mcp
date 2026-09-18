import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { DocumentInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { DOCUMENT_GET } from "../commands/document-get.js";

export const DocumentGetInputSchema = z.object({}).strict();

/** `photoshop.document.get` — 활성 문서 정보 조회. */
export function createDocumentGetTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, DocumentInfo> {
  return {
    name: "photoshop.document.get",
    description: "현재 활성 Photoshop 문서의 정보를 반환한다.",
    permission: "read",
    inputSchema: DocumentGetInputSchema,
    handler: async (_input, context) =>
      engine.execute<DocumentInfo>(
        { type: DOCUMENT_GET, params: {} },
        { requestId: context.requestId },
      ),
  };
}
