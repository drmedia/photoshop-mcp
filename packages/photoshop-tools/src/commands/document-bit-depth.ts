import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_BIT_DEPTH_CONVERT` — 채널당 비트 심도. (CORE_API §5 P2)
 *
 * **내리면 되돌릴 수 없다.** 16 → 8 은 계조를 버리고 문서 어디에도 원래 값이
 * 남지 않는다. 천체사진에서 16비트를 지키는 것이 이 프로젝트의 관심사다.
 */

export const DOCUMENT_BIT_DEPTH_CONVERT = "DOCUMENT_BIT_DEPTH_CONVERT";

/**
 * **1비트는 열지 않았다.** Bitmap 색상 모드에서만 뜻이 있는데 그 모드는
 * 대화상자 위험 때문에 `document.mode_convert` 에서도 열지 않았다(ROADMAP §38).
 */
export const BitDepthSchema = z.union([z.literal(8), z.literal(16), z.literal(32)]);

export const DocumentBitDepthParamsSchema = z.object({ depth: BitDepthSchema }).strict();

export type DocumentBitDepthParams = z.infer<typeof DocumentBitDepthParamsSchema>;

export const BitDepthConvertResultSchema = z.object({
  document: DocumentInfoSchema,
  /** 바꾸기 전 심도. 못 읽으면 `null`. */
  before: z.number().nullable(),
  /** 바꾼 뒤 **읽은** 심도. 못 읽으면 `null`. */
  after: z.number().nullable(),
  /** 요청한 심도가 실제로 들어갔는가. **요청값을 되풀이한 것이 아니다.** */
  applied: z.boolean(),
});

export type BitDepthConvertResult = z.infer<typeof BitDepthConvertResultSchema>;

export const documentBitDepthConvertCommand: CommandHandler<
  DocumentBitDepthParams,
  BitDepthConvertResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = BitDepthConvertResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
