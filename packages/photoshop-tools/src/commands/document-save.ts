import type { CommandHandler } from "@photoshop-mcp/command-engine";
import {
  ErrorCode,
  FilenameSchema,
  FlatFormatSchema,
  LayeredFormatSchema,
  PhotoshopMcpError,
  SaveResultSchema,
  WorkspaceStatusSchema,
  type SaveResult,
  type WorkspaceStatus,
} from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 9 파일 저장 Command. (ROADMAP §8.5, §13)
 *
 * 권한 배정의 근거:
 *
 * - `WORKSPACE_STATUS` — `read`. 승인 여부만 읽는다.
 * - `DOCUMENT_SAVE_AS` · `DOCUMENT_EXPORT` — `external`. Photoshop 밖(파일 시스템)에 쓴다.
 *   **덮어쓰지 않는다.** 같은 이름이 있으면 실패한다. 그래서 데이터를 잃지 않는다.
 * - `DOCUMENT_SAVE` — `destructive`. 원본을 덮어쓴다. 되돌릴 수 없다.
 *
 * 덮어쓰기 옵션을 `save_as` 에 두지 않은 이유: Permission 은 Command 단위로 정적이라
 * 옵션에 따라 레벨이 달라질 수 없다. 옵션으로 두면 `external` 권한만 준 호출자가
 * 파일을 지울 수 있게 된다. 덮어쓰기는 `save` 하나로 모으고 `destructive` 로 분류한다.
 */

export const WORKSPACE_STATUS = "WORKSPACE_STATUS";
export const DOCUMENT_SAVE_AS = "DOCUMENT_SAVE_AS";
export const DOCUMENT_EXPORT = "DOCUMENT_EXPORT";
export const DOCUMENT_SAVE = "DOCUMENT_SAVE";

export const EmptyParamsSchema = z.object({}).strict();

export const SaveAsParamsSchema = z
  .object({
    /** 승인된 폴더 안의 파일 이름. 경로를 포함할 수 없다. */
    filename: FilenameSchema,
    /** 저장 형식. 생략하면 `psd`. */
    format: LayeredFormatSchema.optional(),
  })
  .strict();

export const ExportParamsSchema = z
  .object({
    filename: FilenameSchema,
    /** 내보내기 형식. 생략하면 `png`. */
    format: FlatFormatSchema.optional(),
    /**
     * JPEG 품질 1–12. `format: "jpg"` 일 때만 쓴다.
     *
     * Photoshop 의 JPEG 품질 눈금과 같다. 생략하면 10.
     */
    quality: z.number().int().min(1).max(12).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.quality !== undefined && value.format !== "jpg") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quality"],
        message: "quality 는 format 이 'jpg' 일 때만 쓸 수 있습니다.",
      });
    }
  });

export type SaveAsParams = z.infer<typeof SaveAsParamsSchema>;
export type ExportParams = z.infer<typeof ExportParamsSchema>;

/** Plugin 응답을 스키마로 검증해서 돌려준다. */
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

export const workspaceStatusCommand = forward<Record<string, never>, WorkspaceStatus>(
  WorkspaceStatusSchema,
);
export const saveAsCommand = forward<SaveAsParams, SaveResult>(SaveResultSchema);
export const exportCommand = forward<ExportParams, SaveResult>(SaveResultSchema);
export const saveCommand = forward<Record<string, never>, SaveResult>(SaveResultSchema);
