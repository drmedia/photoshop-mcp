import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_CREATE` — 새 문서. (CORE_API §5 P1)
 *
 * **요청한 값이 실제로 들어갔는지 함께 돌려준다.** `app.documents.add` 가 어떤
 * 키를 받는지 확인된 적이 없어, 무시된 옵션을 성공으로 보고하면 호출자가
 * 16비트를 받은 줄 알고 8비트에 외부 처리기를 돌린다.
 * (배경 레이어 `opacityApplied` 와 같은 방식)
 */

export const DOCUMENT_CREATE = "DOCUMENT_CREATE";

/**
 * 파라미터.
 *
 * **안 쓰는 것을 넣지 않는다.** 해상도·픽셀 종횡비·색 프로파일까지 열면
 * 호출자가 무엇이 중요한지 모른다 — `text.create` 에서 같은 판단을 했다.
 * 이 프로젝트에서 중요한 것은 크기와 **비트 심도**다. 8비트로 떨어지면
 * 천체사진 계조가 무너진다.
 */
export const DocumentCreateParamsSchema = z
  .object({
    width: z.number().int().min(1).max(300000),
    height: z.number().int().min(1).max(300000),
    /** ppi. 생략하면 Photoshop 기본값. */
    resolution: z.number().min(1).max(30000).optional(),
    mode: z.enum(["RGB", "grayscale"]).optional(),
    bitDepth: z.union([z.literal(8), z.literal(16), z.literal(32)]).optional(),
    fill: z.enum(["white", "transparent", "black"]).optional(),
    name: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export type DocumentCreateParams = z.infer<typeof DocumentCreateParamsSchema>;

export const DocumentCreateResultSchema = z.object({
  document: DocumentInfoSchema,
  /**
   * 요청한 값이 실제로 들어갔는지.
   *
   * 요청하지 않은 항목은 담기지 않는다 — 묻지 않은 것에 답하지 않는다.
   */
  applied: z.object({
    width: z.boolean(),
    height: z.boolean(),
    bitDepth: z.boolean().optional(),
    colorMode: z.boolean().optional(),
  }),
});

export type DocumentCreateResult = z.infer<typeof DocumentCreateResultSchema>;

export const documentCreateCommand: CommandHandler<
  DocumentCreateParams,
  DocumentCreateResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentCreateResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `새 문서 결과가 예상과 다릅니다: ${parsed.error.issues[0]?.message ?? "형식 오류"}`,
    );
  }
  return parsed.data;
};
