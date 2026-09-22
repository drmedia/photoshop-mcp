import type { CommandHandler } from "@photoshop-mcp/command-engine";
import {
  ErrorCode,
  FilenameSchema,
  FlatFormatSchema,
  LayeredFormatSchema,
  PhotoshopMcpError,
  SaveResultSchema,
  WorkspaceStatusSchema,
  withExtension,
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
export const SELECTION_EXPORT_MASK = "SELECTION_EXPORT_MASK";

export const EmptyParamsSchema = z.object({}).strict();

export const SaveAsParamsSchema = z
  .object({
    /** 승인된 폴더 안의 파일 이름. 경로를 포함할 수 없다. */
    filename: FilenameSchema,
    /** 저장 형식. 생략하면 `psd`. */
    format: LayeredFormatSchema.optional(),
  })
  .strict();

export const SelectionExportMaskParamsSchema = z
  .object({
    /** 승인된 폴더 안의 파일 이름. 경로를 포함할 수 없다. */
    filename: FilenameSchema,
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
    /**
     * 비트 심도. `format: "tiff"` 일 때만 쓴다.
     *
     * 생략하면 문서의 현재 심도를 유지한다. 외부 천체사진 처리기는 16을 요구한다.
     */
    bitDepth: z.union([z.literal(8), z.literal(16)]).optional(),
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
    if (value.bitDepth !== undefined && value.format !== "tiff") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bitDepth"],
        message: "bitDepth 는 format 이 'tiff' 일 때만 쓸 수 있습니다.",
      });
    }
  });

export type SaveAsParams = z.infer<typeof SaveAsParamsSchema>;
export type ExportParams = z.infer<typeof ExportParamsSchema>;
export type SelectionExportMaskParams = z.infer<typeof SelectionExportMaskParamsSchema>;

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

/**
 * 확장자를 맞춰서 Plugin 으로 보낸다.
 *
 * 정규화를 **서버에서** 끝내는 이유: Plugin 은 contracts 를 타입으로만 참조하므로
 * 공용 함수를 호출할 수 없다. 값으로 import 하면 컴파일 결과에 npm 의존이 남아
 * UXP 샌드박스에서 모듈 로드가 실패한다. (CLAUDE.md 의존 방향 규칙 6)
 *
 * 양쪽에 같은 함수를 두는 대신 한쪽만 알게 만든다. Plugin 은 실행 Agent 다.
 * (ARCHITECTURE §11)
 */
function forwardSave<TParams extends { filename: string; format?: string }>(
  defaultFormat: string,
): CommandHandler<TParams, SaveResult> {
  const inner = forward<TParams, SaveResult>(SaveResultSchema);
  return async (command, context) => {
    const params = command.params;
    const format = params.format ?? defaultFormat;
    return inner(
      { ...command, params: { ...params, filename: withExtension(params.filename, format) } },
      context,
    );
  };
}

export const workspaceStatusCommand = forward<Record<string, never>, WorkspaceStatus>(
  WorkspaceStatusSchema,
);
export const saveAsCommand = forwardSave<SaveAsParams>("psd");
export const exportCommand = forwardSave<ExportParams>("png");
export const saveCommand = forward<Record<string, never>, SaveResult>(SaveResultSchema);

/**
 * 선택 영역을 16비트 TIFF 마스크로 내보낸다.
 *
 * 파일을 만드는 규칙이 `export` 와 같다 — 승인된 폴더 안, 덮어쓰지 않는다.
 * 그래서 `external` 이고 확장자도 같은 방식으로 붙인다.
 *
 * **형식을 고르게 하지 않는다.** 이 파일을 읽는 것은 사람이 아니라 외부
 * 처리 코드이고, 16비트 TIFF 하나만 지원한다. 고를 수 있게 두면 png 로
 * 내보낸 뒤 "왜 안 되지" 가 된다.
 */
export const selectionExportMaskCommand = forwardSave<SelectionExportMaskParams>("tiff");
