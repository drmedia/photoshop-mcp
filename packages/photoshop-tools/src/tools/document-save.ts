import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { SaveResult, ToolDefinition, WorkspaceStatus } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_EXPORT,
  DOCUMENT_SAVE,
  DOCUMENT_SAVE_AS,
  EmptyParamsSchema,
  ExportParamsSchema,
  SaveAsParamsSchema,
  WORKSPACE_STATUS,
  type ExportParams,
  type SaveAsParams,
} from "../commands/document-save.js";

/**
 * Phase 9 파일 저장 Tool. (ROADMAP §8.5, §13)
 *
 * 저장 위치는 LLM 이 고를 수 없다. 사용자가 플러그인 패널에서 승인한 폴더 안에만 쓴다.
 * 이것은 UXP 샌드박스 제약이자 안전장치다. (ARCHITECTURE §22)
 */

/** `photoshop.workspace.status` — 승인된 작업 폴더 확인. */
export function createWorkspaceStatusTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, WorkspaceStatus> {
  return {
    name: "photoshop.workspace.status",
    description:
      "저장에 쓸 작업 폴더가 승인되어 있는지 확인한다. " +
      "승인되지 않았다면 사용자가 Photoshop 의 'Photoshop MCP' 패널에서 " +
      "'폴더 승인' 버튼을 눌러야 한다. 서버는 이 승인을 대신할 수 없다.",
    permission: "read",
    inputSchema: EmptyParamsSchema,
    handler: async (_input, context) =>
      engine.execute<WorkspaceStatus>(
        { type: WORKSPACE_STATUS, params: {} },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.document.save_as` — 승인된 폴더에 새 파일로 저장. 레이어를 유지한다. */
export function createSaveAsTool(engine: CommandEngine): ToolDefinition<SaveAsParams, SaveResult> {
  return {
    name: "photoshop.document.save_as",
    description:
      "승인된 작업 폴더에 새 이름으로 저장한다. 레이어를 유지한다 (psd · psb). " +
      "파일 이름만 받으며 경로는 쓸 수 없다. " +
      "같은 이름이 이미 있으면 덮어쓰지 않고 실패한다.",
    permission: "external",
    inputSchema: SaveAsParamsSchema,
    handler: async (input, context) =>
      engine.execute<SaveResult>(
        { type: DOCUMENT_SAVE_AS, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.document.export` — 승인된 폴더로 합쳐서 내보내기. */
export function createExportTool(engine: CommandEngine): ToolDefinition<ExportParams, SaveResult> {
  return {
    name: "photoshop.document.export",
    description:
      "승인된 작업 폴더로 내보낸다. 레이어를 합친다 (png · jpg). " +
      "파일 이름만 받으며 경로는 쓸 수 없다. " +
      "같은 이름이 이미 있으면 덮어쓰지 않고 실패한다. " +
      "열려 있는 문서 자체는 바뀌지 않는다.",
    permission: "external",
    inputSchema: ExportParamsSchema,
    handler: async (input, context) =>
      engine.execute<SaveResult>(
        { type: DOCUMENT_EXPORT, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.document.save` — 원본 덮어쓰기. destructive. */
export function createSaveTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, SaveResult> {
  return {
    name: "photoshop.document.save",
    description:
      "현재 문서를 원래 경로에 덮어쓴다. 되돌릴 수 없다. " +
      "한 번도 저장한 적 없는 문서에는 쓸 수 없다 — 그때는 save_as 를 쓴다. " +
      "작업 폴더 승인과 무관하게 문서 자신의 경로에만 쓴다.",
    permission: "destructive",
    inputSchema: EmptyParamsSchema,
    handler: async (_input, context) =>
      engine.execute<SaveResult>(
        { type: DOCUMENT_SAVE, params: {} },
        { requestId: context.requestId },
      ),
  };
}
