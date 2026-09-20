import type { CommandHandler } from "@photoshop-mcp/command-engine";
import {
  DocumentInfoSchema,
  ErrorCode,
  FilenameSchema,
  PhotoshopMcpError,
} from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 문서 열기. (ROADMAP §17.26)
 *
 * ## 왜 필요했나
 *
 * `document.close`(§17.25)를 만들고 실기에서 닫아 본 직후, **다시 열 방법이
 * 없었다.** 사람이 Photoshop 에서 직접 열어 주어야 했다.
 *
 * 닫을 수는 있는데 열 수는 없는 것은 반쪽이다.
 *
 * ## 승인된 폴더 안으로 가둔다
 *
 * 저장과 같은 규칙이다(ROADMAP §8.5). LLM 은 폴더를 고를 수 없고 **파일 이름만**
 * 준다. 경로 구분자와 `..` 는 스키마가 거부한다.
 *
 * 읽기라고 느슨하게 두지 않는다 — 임의 경로를 열 수 있으면 사용자의 어느 파일이든
 * Photoshop 으로 가져와 캡처로 내용을 볼 수 있다. 쓰기보다 덜 위험한 것이 아니다.
 *
 * ## **RAW 는 거절한다**
 *
 * NEF · CR2 · ARW 같은 카메라 원본을 열면 Photoshop 이 **Camera Raw 대화상자**를
 * 띄운다. 그러면 플러그인이 멈추고 Bridge 가 타임아웃한다 — §17.25 가 `close` 에서
 * 막은 것과 같은 위험이고, §17.11 이 `window.capture` 를 만든 이유이기도 하다.
 *
 * 그래서 **대화상자 없이 열리는 것이 확인된 형식만** 허용한다. 목록에 없는
 * 확장자는 열어 보지 않고 거절하며 이유를 말한다.
 *
 * RAW 를 다루려면 사람이 직접 열어 현상 설정을 정하는 편이 맞다. 그 판단은
 * 슬라이더를 보며 하는 일이고 MCP 로 옮길 것이 아니다.
 */

export const DOCUMENT_OPEN = "DOCUMENT_OPEN";

/**
 * 대화상자 없이 열리는 형식.
 *
 * 여기에 무언가 더할 때는 **실기에서 대화상자가 뜨지 않는 것을 확인**한다.
 * 목록이 길어지는 것보다 서버가 멈추는 것이 훨씬 나쁘다.
 */
const OPENABLE = ["psd", "psb", "tif", "tiff", "png", "jpg", "jpeg"] as const;

export const DocumentOpenParamsSchema = z
  .object({
    /**
     * 승인된 폴더 안의 파일 이름. **확장자를 포함한다.**
     *
     * 저장과 달리 형식을 고를 수 없으므로 이름만으로 파일이 정해져야 한다.
     */
    filename: FilenameSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    // 점이 없으면 확장자가 없는 것이다. `split(".").pop()` 은 그 경우 이름
    // 전체를 돌려주므로 "확장자가 없다" 와 "모르는 확장자" 가 섞인다 —
    // 호출자가 고쳐야 할 것이 다르므로 구분한다.
    const parts = value.filename.split(".");
    const extension = parts.length > 1 ? (parts[parts.length - 1]?.toLowerCase() ?? "") : "";
    if (!(OPENABLE as readonly string[]).includes(extension)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filename"],
        message:
          `${extension === "" ? "확장자가 없습니다" : `'${extension}' 은 열 수 없습니다`}. ` +
          `열 수 있는 형식: ${OPENABLE.join(" · ")}. ` +
          "카메라 RAW 는 Camera Raw 대화상자가 떠 플러그인이 멈추므로 막았습니다 — " +
          "사람이 Photoshop 에서 직접 열어야 합니다.",
      });
    }
  });

export type DocumentOpenParams = z.infer<typeof DocumentOpenParamsSchema>;

export const DocumentOpenResultSchema = z.object({
  document: DocumentInfoSchema,
  /**
   * 이미 열려 있던 문서인지.
   *
   * Photoshop 은 같은 파일을 두 번 열지 않고 기존 창을 활성화한다. 그것을 그냥
   * 성공으로 돌려주면 호출자는 **방금 디스크에서 읽었다고 믿는다** — 편집 중인
   * 내용이 있으면 디스크의 것과 다르다.
   */
  alreadyOpen: z.boolean(),
  /** 연 뒤 열려 있는 문서 수. */
  openDocuments: z.number().int(),
});

export type DocumentOpenResult = z.infer<typeof DocumentOpenResultSchema>;

export const documentOpenCommand: CommandHandler<DocumentOpenParams, DocumentOpenResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentOpenResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "열기 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
