import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 이 세션이 만든 문서. (ROADMAP §101)
 *
 * `document.duplicate` · `document.create` 로 시험용 문서를 만들면 사용자의 탭에 남는다. `document.close`
 * 는 destructive 라 기본 허용 밖이고 활성 문서만 닫는다. 여기서는 **이 서버가 만든 문서**만 닫는다 —
 * `layer.delete_created` 와 같은 규칙이다. 사용자가 연 문서와 `document.open` 으로 연 파일은 이 통로로
 * 닫을 수 없다(디스크의 파일을 연 것이라 사용자의 것이다).
 *
 * ## `discardChanges: true` 를 명시한다
 *
 * 복제본에 보정을 쌓았다면 닫는 순간 사라진다. `document.close` 와 같이 리터럴 `true` 를 요구한다.
 * 저장하려면 먼저 `document.save_as` 를 부른다.
 */

export const DOCUMENT_LIST_CREATED = "DOCUMENT_LIST_CREATED";
export const DOCUMENT_CLOSE_CREATED = "DOCUMENT_CLOSE_CREATED";

export const DocumentListCreatedParamsSchema = z.object({}).strict();

export const DocumentListCreatedResultSchema = z.object({
  /** 지금도 열려 있는, 이 세션이 만든 문서. */
  documents: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type DocumentListCreatedResult = z.infer<typeof DocumentListCreatedResultSchema>;

export const DocumentCloseCreatedParamsSchema = z
  .object({
    /** 생략하면 이 세션이 만든 것 전부. 주면 그 가운데서만 닫는다. */
    documentIds: z.array(z.number().int().positive()).min(1).max(20).optional(),
    /** 저장하지 않고 닫는다는 것을 호출자가 안다는 표시. 기본값이 없다. */
    discardChanges: z.literal(true),
  })
  .strict();
export type DocumentCloseCreatedParams = z.infer<typeof DocumentCloseCreatedParamsSchema>;

export const DocumentCloseCreatedResultSchema = z.object({
  closed: z.array(z.number().int()),
  failed: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  /** 요청했지만 이 세션이 만든 것이 아니라 건드리지 않은 id. */
  notCreated: z.array(z.number().int()),
  remainingDocuments: z.number().int(),
  /** 닫은 뒤의 활성 문서. 없으면 null. 활성 문서를 닫으면 Photoshop 이 다른 문서를 활성으로 만든다. */
  activeDocumentId: z.number().int().nullable(),
});
export type DocumentCloseCreatedResult = z.infer<typeof DocumentCloseCreatedResultSchema>;

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export const documentListCreatedCommand: CommandHandler<
  z.infer<typeof DocumentListCreatedParamsSchema>,
  DocumentListCreatedResult
> = async (command, context) =>
  parse(
    DocumentListCreatedResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    "생성 문서 목록",
  );

export const documentCloseCreatedCommand: CommandHandler<
  DocumentCloseCreatedParams,
  DocumentCloseCreatedResult
> = async (command, context) =>
  parse(
    DocumentCloseCreatedResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    "생성 문서 닫기",
  );
