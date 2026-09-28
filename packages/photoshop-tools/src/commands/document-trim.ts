import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { DocumentInfoSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `DOCUMENT_TRIM` — 둘레의 여백을 잘라낸다. (CORE_API §5)
 *
 * **무엇을 남길지 Photoshop 이 픽셀을 보고 정한다.** `crop` 은 호출자가 좌표로,
 * `canvas.resize` 는 크기와 기준점으로 정한다. 그래서 이것만 **얼마나 잘릴지
 * 미리 알 수 없고**, 결과의 `before` · `after` 로 확인한다.
 */

export const DOCUMENT_TRIM = "DOCUMENT_TRIM";

/** `constants.TrimType` 의 세 가지. */
export const TrimModeSchema = z.enum(["transparent", "topLeft", "bottomRight"]);

export const DocumentTrimParamsSchema = z
  .object({
    /**
     * 무엇을 여백으로 볼지.
     *
     * - `transparent` — 투명한 둘레
     * - `topLeft` — 왼쪽 위 픽셀과 같은 색
     * - `bottomRight` — 오른쪽 아래 픽셀과 같은 색
     */
    mode: TrimModeSchema,
    /** 자를 면. **한 면이라도 주면 나머지는 `true` 로 간주한다.** */
    top: z.boolean().optional(),
    left: z.boolean().optional(),
    bottom: z.boolean().optional(),
    right: z.boolean().optional(),
  })
  .strict();

export type DocumentTrimParams = z.infer<typeof DocumentTrimParamsSchema>;

const TrimSizeSchema = z.object({ width: z.number(), height: z.number() });

export const DocumentTrimResultSchema = z.object({
  document: DocumentInfoSchema,
  before: TrimSizeSchema,
  after: TrimSizeSchema,
  /** 가로·세로로 얼마나 줄었는지. **어느 쪽이 잘렸는지는 알 수 없다.** */
  removed: TrimSizeSchema,
  /** 실제로 잘렸는가. 자를 것이 없으면 `false` 이고 오류가 아니다. */
  changed: z.boolean(),
  mode: TrimModeSchema,
});

export type DocumentTrimResult = z.infer<typeof DocumentTrimResultSchema>;

export const documentTrimCommand: CommandHandler<DocumentTrimParams, DocumentTrimResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentTrimResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
