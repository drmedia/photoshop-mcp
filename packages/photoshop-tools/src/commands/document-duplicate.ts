import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_DUPLICATE` — 활성 문서를 복제한다. (CORE_API §5 P2)
 *
 * **되돌릴 수 없는 작업 앞의 안전망이다.** `image.resize` · `document.flatten` ·
 * `mask.apply` 를 복제본에서 하면 원본이 남는다.
 *
 * 파일을 만들지 않는다 — 메모리 안의 새 문서다. 그래서 `external` 이 아니라
 * `edit` 이다.
 */

export const DOCUMENT_DUPLICATE = "DOCUMENT_DUPLICATE";

export const DocumentDuplicateParamsSchema = z
  .object({
    /** 복제본 이름. 생략하면 Photoshop 기본 이름. 경로 구분자는 받지 않는다. */
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      /* 파일을 만들지 않지만 이 이름이 나중에 `save_as` 로 넘어간다.
       * 작업 폴더 승인(§8.5)과 같은 규칙을 지킨다. */
      .refine((value) => !value.includes("/") && !value.includes("\\"), {
        message: "이름에 경로 구분자를 넣을 수 없습니다.",
      })
      .optional(),
    /**
     * 합친 결과 한 장만 복제본에 넣는다.
     *
     * **원본의 레이어를 합치는 것이 아니다.** 원본은 그대로 남는다.
     */
    mergeLayersOnly: z.boolean().optional(),
  })
  .strict();

export type DocumentDuplicateParams = z.infer<typeof DocumentDuplicateParamsSchema>;

export const DocumentDuplicateResultSchema = z.object({
  /** 복제본. */
  document: DocumentInfoSchema,
  /**
   * 복제 후 실제로 활성인 문서의 id. **복제본과 다를 수 있다.**
   *
   * 읽지 못하면 `null` 이다.
   */
  activeDocumentId: z.number().nullable(),
  /** 복제본의 레이어 수. `mergeLayersOnly` 가 먹었는지 여기서 드러난다. */
  layers: z.number().nullable(),
  /** 복제 후 열려 있는 문서 수. */
  openDocuments: z.number(),
});

export type DocumentDuplicateResult = z.infer<typeof DocumentDuplicateResultSchema>;

export const documentDuplicateCommand: CommandHandler<
  DocumentDuplicateParams,
  DocumentDuplicateResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentDuplicateResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
