import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_PASTE` — 클립보드 내용을 붙여 넣는다. (CORE_API §5)
 *
 * **이 서버에서 성격이 다르다.** 나머지 Command 는 문서 안에서 끝나는데 이것은
 * 사용자의 클립보드를 문서로 끌어들인다. 무엇이 들어올지 서버도 호출자도 알 수
 * 없고, 들어온 것은 `document.capture` 로 읽을 수 있다 — 즉 **사용자의
 * 클립보드를 LLM 이 볼 수 있게 만드는 통로**다.
 *
 * 그래서 `external` 이다. `layer.place` 와 같은 논리이고 **클립보드는 폴더
 * 승인조차 없다.**
 */

export const DOCUMENT_PASTE = "DOCUMENT_PASTE";

export const DocumentPasteParamsSchema = z
  .object({
    /** 선택 영역 안에 붙여 넣는다. 선택이 없으면 거절한다. */
    intoSelection: z.boolean().optional(),
  })
  .strict();

export type DocumentPasteParams = z.infer<typeof DocumentPasteParamsSchema>;

const BoundsSchema = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
  width: z.number(),
  height: z.number(),
});

export const PasteResultSchema = z.object({
  layer: LayerInfoSchema,
  /** 붙여 넣어진 내용의 경계. **내용은 해석하지 않는다** — 크기로 가늠한다. */
  bounds: BoundsSchema.nullable(),
  /** 실제로 쓴 값. */
  intoSelection: z.boolean(),
});

export type PasteResult = z.infer<typeof PasteResultSchema>;

export const documentPasteCommand: CommandHandler<DocumentPasteParams, PasteResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = PasteResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
