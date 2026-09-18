import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, FilenameSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 작업 폴더 파일 관리. (ROADMAP §17)
 *
 * 외부 처리기를 한 번 돌릴 때마다 16비트 TIFF 가 여러 개 생긴다. 4032×6048 이면
 * 파일 하나가 140MB 다. 알려주지 않으면 쌓이는 줄 모른다.
 */

export const WORKSPACE_USAGE = "WORKSPACE_USAGE";
export const WORKSPACE_DELETE = "WORKSPACE_DELETE";

export const WorkspaceUsageParamsSchema = z
  .object({
    /** 크기 순으로 이만큼만. 생략하면 20. */
    limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();

export const WorkspaceDeleteParamsSchema = z
  .object({
    /**
     * 지울 파일 이름. 패턴이나 와일드카드를 받지 않는다.
     *
     * 별표 한 줄이 사용자의 원본을 지울 수 있다. 승인된 폴더는 우리 폴더가 아니다.
     */
    filenames: z.array(FilenameSchema).min(1).max(100),
  })
  .strict();

export type WorkspaceUsageParams = z.infer<typeof WorkspaceUsageParamsSchema>;
export type WorkspaceDeleteParams = z.infer<typeof WorkspaceDeleteParamsSchema>;

const FileInfoSchema = z.object({
  name: z.string(),
  size: z.number().nullable(),
  modifiedAt: z.number().nullable(),
});

export const WorkspaceUsageSchema = z.object({
  path: z.string(),
  fileCount: z.number().int(),
  totalBytes: z.number(),
  files: z.array(FileInfoSchema),
});

export const DeleteResultSchema = z.object({
  deleted: z.array(z.string()),
  failed: z.array(z.object({ name: z.string(), reason: z.string() })),
});

export type WorkspaceUsage = z.infer<typeof WorkspaceUsageSchema>;
export type DeleteResult = z.infer<typeof DeleteResultSchema>;

function forward<TParams, TResult>(schema: z.ZodType<TResult>): CommandHandler<TParams, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 스키마를 만족하지 않습니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

export const workspaceUsageCommand = forward<WorkspaceUsageParams, WorkspaceUsage>(
  WorkspaceUsageSchema,
);
export const workspaceDeleteCommand = forward<WorkspaceDeleteParams, DeleteResult>(
  DeleteResultSchema,
);
