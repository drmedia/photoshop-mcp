import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 열려 있는 문서로 활성을 옮긴다. (ROADMAP §101)
 *
 * ## 왜 필요한가
 *
 * 편집 Command 는 전부 **활성 문서**에 걸린다. 참조 이미지와 작업 문서가 함께 열려 있으면 사람이
 * 탭을 눌러 바꿔 줘야 했다 — 그동안 호출자는 아무것도 못 하고 사용자에게 부탁한다. 반대로 활성
 * 문서를 모르고 편집하면 **엉뚱한 문서가 바뀐다**(참조 PNG 를 자기 자신에 붙여 넣은 적이 있다).
 *
 * ## 고르는 법
 *
 * `documentId` 가 정확하다. `name` 은 편의이고 **이름이 유일하지 않으면 거절한다**(같은 파일을 두 번
 * 열면 이름이 같다) — 어느 쪽인지 짐작하지 않는다. 둘 다 주거나 하나도 안 주면 거절한다.
 *
 * ## 옮겼는지 읽어서 답한다
 *
 * 오류 없이 끝났다고 활성이 바뀐 것은 아니다. 옮긴 뒤 활성 문서를 다시 읽어 `changed` 와 `document` 로
 * 돌려준다. 이미 활성이면 아무것도 하지 않고 `changed: false` 다.
 *
 * 문서의 내용은 바뀌지 않으므로 `edit` 이다(`layer.select` 와 같은 종류 — 대상만 옮긴다).
 */

export const DOCUMENT_ACTIVATE = "DOCUMENT_ACTIVATE";

export const DocumentActivateParamsSchema = z
  .object({
    /** `photoshop.document.list` 의 `id`. */
    documentId: z.number().int().positive().optional(),
    /** 문서 이름. 유일할 때만 쓸 수 있다. */
    name: z.string().min(1).max(255).optional(),
  })
  .strict()
  .refine((value) => (value.documentId === undefined) !== (value.name === undefined), {
    message: "documentId 와 name 중 정확히 하나만 줘야 합니다.",
  });

export type DocumentActivateParams = z.infer<typeof DocumentActivateParamsSchema>;

export const DocumentActivateResultSchema = z.object({
  /** 지금 활성인 문서. **요청이 아니라 옮긴 뒤 읽은 값이다.** */
  document: DocumentInfoSchema,
  /** 옮기기 전의 활성 문서 id. 없었으면 null. 돌아올 때 쓴다. */
  previousId: z.number().int().nullable(),
  /** 활성이 실제로 바뀌었는지. 이미 활성이었으면 false. */
  changed: z.boolean(),
  /** 어떻게 옮겼는지. `already` 는 할 일이 없었다는 뜻이다. */
  method: z.enum(["already", "setter", "batchPlay"]),
});

export type DocumentActivateResult = z.infer<typeof DocumentActivateResultSchema>;

export const documentActivateCommand: CommandHandler<
  DocumentActivateParams,
  DocumentActivateResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentActivateResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "문서 활성 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  const { documentId } = command.params;
  if (documentId !== undefined && parsed.data.document.id !== documentId) {
    // 요청과 결과가 다르면 성공이라 말하지 않는다.
    throw new PhotoshopMcpError(
      ErrorCode.COMMAND_FAILED,
      `문서 ${String(documentId)} 로 옮기지 못했습니다. 지금 활성 문서는 ${String(parsed.data.document.id)} 입니다.`,
      { recoverable: true, details: { requested: documentId, active: parsed.data.document.id } },
    );
  }
  return parsed.data;
};
