import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  WORKSPACE_DELETE,
  WORKSPACE_USAGE,
  WorkspaceDeleteParamsSchema,
  WorkspaceUsageParamsSchema,
  type DeleteResult,
  type WorkspaceDeleteParams,
  type WorkspaceUsage,
  type WorkspaceUsageParams,
} from "../commands/workspace-files.js";

/** 사람이 읽을 크기. 바이트 숫자만 보면 1GB 가 넘은 것을 알아채지 못한다. */
function human(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${Math.round(bytes / 1024 ** 2)}MB`;
  }
  return `${Math.round(bytes / 1024)}KB`;
}

/** `photoshop.workspace.usage` — 작업 폴더에 무엇이 얼마나 쌓였는지. */
export function createWorkspaceUsageTool(
  engine: CommandEngine,
): ToolDefinition<WorkspaceUsageParams, unknown> {
  return {
    name: "photoshop.workspace.usage",
    description:
      "승인된 작업 폴더의 파일과 총 용량을 큰 것부터 보고한다. " +
      "외부 처리기는 한 번 돌 때마다 16비트 TIFF 를 여러 개 만든다 — " +
      "4032×6048 이면 파일 하나가 140MB 다. 정리가 필요한지 확인할 때 쓴다.",
    permission: "read",
    inputSchema: WorkspaceUsageParamsSchema,
    handler: async (input, context) => {
      const usage = await engine.execute<WorkspaceUsage>(
        { type: WORKSPACE_USAGE, params: input },
        { requestId: context.requestId },
      );
      return { ...usage, totalSize: human(usage.totalBytes) };
    },
  };
}

/** `photoshop.workspace.delete` — 이름을 명시한 파일만 지운다. */
export function createWorkspaceDeleteTool(
  engine: CommandEngine,
): ToolDefinition<WorkspaceDeleteParams, DeleteResult> {
  return {
    name: "photoshop.workspace.delete",
    description:
      "승인된 작업 폴더에서 **이름을 명시한** 파일을 지운다. 되돌릴 수 없다. " +
      "패턴이나 와일드카드를 받지 않는다 — 승인된 폴더는 사용자의 폴더이고 " +
      "우리가 만든 파일만 있다는 보장이 없다. " +
      "먼저 photoshop.workspace.usage 로 무엇이 있는지 확인한다.",
    permission: "destructive",
    inputSchema: WorkspaceDeleteParamsSchema,
    handler: async (input, context) =>
      engine.execute<DeleteResult>(
        { type: WORKSPACE_DELETE, params: input },
        { requestId: context.requestId },
      ),
  };
}
