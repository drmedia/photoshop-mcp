import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_OPEN,
  DocumentOpenParamsSchema,
  type DocumentOpenResult,
} from "../commands/document-open.js";

/** `photoshop.document.open` — 승인된 폴더의 파일을 연다. (ROADMAP §17.26) */
export function createDocumentOpenTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentOpenParamsSchema>, DocumentOpenResult> {
  return {
    name: "photoshop.document.open",
    description:
      "승인된 작업 폴더 안의 파일을 연다. filename 은 **확장자를 포함한** 파일 이름이며 " +
      "경로를 넣을 수 없다 — 폴더는 사용자가 플러그인 패널에서 승인한다. " +
      "photoshop.workspace.usage 로 폴더 안의 파일을 확인할 수 있다. " +
      "열 수 있는 형식은 psd · psb · tif · tiff · png · jpg · jpeg 다. " +
      "**카메라 RAW(nef · cr2 · arw 등)는 거절한다** — Camera Raw 대화상자가 떠 " +
      "플러그인이 멈추기 때문이다. RAW 는 사람이 Photoshop 에서 직접 열어야 한다. " +
      "결과의 alreadyOpen 이 true 면 그 파일이 이미 열려 있어서 " +
      "**디스크에서 다시 읽은 것이 아니라 기존 창이 활성화된 것**이다 — " +
      "편집 중인 내용이 있으면 디스크의 것과 다르다.",
    permission: "external",
    inputSchema: DocumentOpenParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentOpenResult>(
        { type: DOCUMENT_OPEN, params: input },
        { requestId: context.requestId },
      ),
  };
}
