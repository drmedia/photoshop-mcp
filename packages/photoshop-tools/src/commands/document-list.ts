import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_LIST` — 열려 있는 문서 전부. (CORE_API §5 P1)
 *
 * `document.get` 은 **활성 문서 하나**를 준다. 문서를 여러 개 열어 두고
 * 오가는 작업에서는 무엇이 열려 있는지부터 알아야 한다 — 그전에는
 * `document.get` 으로 하나만 보고 나머지는 짐작해야 했다.
 */

export const DOCUMENT_LIST = "DOCUMENT_LIST";

/** 받을 것이 없다. `.strict()` 로 오타를 거른다. */
export const DocumentListParamsSchema = z.object({}).strict();

export type DocumentListParams = z.infer<typeof DocumentListParamsSchema>;

/**
 * 목록의 한 항목.
 *
 * **`active` 를 함께 준다.** 편집 Command 는 대상을 생략하면 활성 문서를
 * 쓰므로, 어느 것이 활성인지 모르면 결과를 예측할 수 없다.
 * (`layer.get_active` 와 같은 자리)
 */
export const DocumentListEntrySchema = DocumentInfoSchema.extend({
  active: z.boolean(),
});

export const DocumentListResultSchema = z.object({
  documents: z.array(DocumentListEntrySchema),
});

export type DocumentListResult = z.infer<typeof DocumentListResultSchema>;

export const documentListCommand: CommandHandler<DocumentListParams, DocumentListResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentListResultSchema.safeParse(raw);
  if (!parsed.success) {
    /* 형태가 다르면 빈 목록으로 떨어뜨리지 않는다. "열린 문서가 없다" 와
     * "읽지 못했다" 는 다른 사실이고, 전자로 답하면 호출자가 문서를 새로
     * 만드는 쪽으로 간다. */
    throw new Error(
      `문서 목록이 예상과 다릅니다: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  return parsed.data;
};
