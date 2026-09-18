import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";

export const DOCUMENT_GET = "DOCUMENT_GET";

/** 활성 문서 정보를 조회한다. */
export const documentGetCommand: CommandHandler<Record<string, never>, DocumentInfo> = async (
  _command,
  context,
) => context.bridge.getDocumentInfo();
