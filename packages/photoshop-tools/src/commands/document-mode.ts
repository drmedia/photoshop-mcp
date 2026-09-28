import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_MODE_CONVERT` — 색상 모드를 바꾼다. (CORE_API §5 P2)
 *
 * **되돌릴 수 없다.** RGB → Grayscale 은 색을 영영 버리고 RGB → CMYK 는 색역
 * 밖을 잘라낸다. 문서 어디에도 원래 값이 남지 않으므로 `destructive` 다.
 */

export const DOCUMENT_MODE_CONVERT = "DOCUMENT_MODE_CONVERT";

/**
 * **`ChangeMode` 일곱 중 넷만 연다.**
 *
 * `bitmap` · `indexedColor` 는 설정 대화상자를 띄워 플러그인을 멈추게 할 수
 * 있고, `multichannel` 은 이 서버의 쓰임과 멀다. 실기에서 대화상자가 뜨지
 * 않는 것을 확인하기 전에는 열지 않는다.
 */
export const ColorModeSchema = z.enum(["rgb", "grayscale", "cmyk", "lab"]);

export const DocumentModeConvertParamsSchema = z.object({ mode: ColorModeSchema }).strict();

export type DocumentModeConvertParams = z.infer<typeof DocumentModeConvertParamsSchema>;

const ModeStateSchema = z.object({ mode: z.string(), layers: z.number() });

export const ModeConvertResultSchema = z.object({
  document: DocumentInfoSchema,
  before: ModeStateSchema,
  after: ModeStateSchema,
  /** 요청한 모드가 실제로 되었는가. **요청값을 되풀이한 것이 아니다.** */
  applied: z.boolean(),
  /** 변환 중 사라진 레이어 수. 평탄화되면 0 이 아니다. */
  layersDiscarded: z.number(),
});

export type ModeConvertResult = z.infer<typeof ModeConvertResultSchema>;

export const documentModeConvertCommand: CommandHandler<
  DocumentModeConvertParams,
  ModeConvertResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = ModeConvertResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
