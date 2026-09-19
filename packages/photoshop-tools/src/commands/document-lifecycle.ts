import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 문서 평탄화와 닫기. (ROADMAP §17.25)
 *
 * CORE_API §5.1 이 처음부터 둘 다 `DESTRUCTIVE` 로 분류해 두고 구현은 미뤄 둔
 * 것이다. **분류가 먼저 서 있어서 만들 때 정할 것이 없었다** — §8 을 둔 이유다.
 *
 * ## 되돌릴 수 없는 일을 여기에 모은다
 *
 * RETOUCH_PROCESS 9단계가 "평탄화 · 8비트 변환 · 덮어쓰기 저장을 출력 단계에
 * 모은다. 그래야 앞의 모든 단계가 되돌릴 수 있는 상태로 남는다" 고 적은 자리다.
 */

export const DOCUMENT_FLATTEN = "DOCUMENT_FLATTEN";
export const DOCUMENT_CLOSE = "DOCUMENT_CLOSE";

export const DocumentFlattenParamsSchema = z.object({}).strict();

export type DocumentFlattenParams = z.infer<typeof DocumentFlattenParamsSchema>;

export const DocumentFlattenResultSchema = z.object({
  /** 합친 뒤 남은 하나의 레이어. */
  layer: LayerInfoSchema,
  /** 합치기 전 레이어 수. */
  previousLayers: z.number().int(),
  /**
   * 그중 숨겨져 있던 레이어 수.
   *
   * **평탄화는 숨긴 레이어를 버린다.** 합쳐지는 것이 아니라 사라진다. 이 값이
   * 0 이 아니면 호출자가 의도한 것인지 확인할 거리가 있다.
   */
  hiddenDiscarded: z.number().int(),
});

export type DocumentFlattenResult = z.infer<typeof DocumentFlattenResultSchema>;

export const DocumentCloseParamsSchema = z
  .object({
    /**
     * 저장하지 않은 변경을 **버린다는 것을 명시**한다. `true` 만 받는다.
     *
     * ## 왜 필수인가
     *
     * Photoshop 은 변경된 문서를 닫을 때 저장 여부를 묻는다. 그 대화상자가 뜨면
     * **플러그인이 멈추고 Bridge 가 타임아웃한다** — §17.11 이 `window.capture`
     * 를 만든 이유가 바로 그 상황이었다.
     *
     * 그래서 이 Command 는 언제나 "저장하지 않음" 으로 닫는다. 기본값을 두지
     * 않고 명시를 요구하는 것은, 그 선택이 **작업을 잃는 선택**이기 때문이다.
     *
     * 저장하고 닫으려면 `document.save` 나 `document.save_as` 를 먼저 부른다.
     */
    discardChanges: z.literal(true),
  })
  .strict();

export type DocumentCloseParams = z.infer<typeof DocumentCloseParamsSchema>;

export const DocumentCloseResultSchema = z.object({
  /** 닫은 문서. 닫힌 뒤에는 조회할 수 없으므로 여기에 담는다. */
  closed: z.object({ id: z.number().int(), name: z.string() }),
  /**
   * 닫은 뒤 열려 있는 문서 수.
   *
   * 0 이면 이후 Command 가 전부 `DOCUMENT_NOT_FOUND` 로 실패한다. 호출자가
   * 그것을 미리 알 수 있어야 한다.
   */
  remainingDocuments: z.number().int(),
});

export type DocumentCloseResult = z.infer<typeof DocumentCloseResultSchema>;

export const documentFlattenCommand: CommandHandler<
  DocumentFlattenParams,
  DocumentFlattenResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentFlattenResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "평탄화 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};

export const documentCloseCommand: CommandHandler<
  DocumentCloseParams,
  DocumentCloseResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentCloseResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "닫기 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
