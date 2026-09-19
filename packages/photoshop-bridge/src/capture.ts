import { z } from "zod";

/**
 * 캡처 결과. (ROADMAP §17.10)
 *
 * ## 왜 이 타입이 따로 있는가
 *
 * MCP 응답은 기본이 텍스트다. base64 를 JSON 에 담아 보내면 **LLM 은 그것을 볼 수
 * 없다** — 글자로 된 긴 문자열일 뿐이다. MCP 의 image content block 으로 나가야
 * 클라이언트가 그림으로 보여준다.
 *
 * 그래서 서버가 "이 결과는 이미지다" 를 알아볼 수단이 필요하다. `kind: "image"` 가
 * 그 표식이다. `ToolDefinition` 에 플래그를 더하지 않는 이유는, 결과의 성격은
 * **결과 자신이** 말하는 것이 맞기 때문이다 — Tool 하나가 상황에 따라 이미지를
 * 줄 수도 안 줄 수도 있다.
 *
 * ## 왜 작게 보내는가
 *
 * 6000×4000 원본은 볼 필요가 없다. LLM 이 구도·색·노출을 판단하는 데는 긴 변
 * 1024px 면 충분하고, 그보다 크면 토큰만 먹는다. 실제로 이 기능이 없어서 편집
 * 열 단계를 다 쌓은 뒤에야 하늘이 보라색이 된 것을 발견한 적이 있다.
 */
export const CapturedImageSchema = z.object({
  /** 서버가 이미지 결과임을 알아보는 표식. */
  kind: z.literal("image"),
  mimeType: z.enum(["image/jpeg", "image/png"]),
  /** 데이터 URL 접두사 없이 base64 본문만. */
  base64: z.string().min(1),
  /** 실제로 보낸 크기. 요청한 크기와 다를 수 있다. */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 무엇을 찍었는지. 사람이 읽는 설명. */
  source: z.string().min(1),
});

export type CapturedImage = z.infer<typeof CapturedImageSchema>;

/** 결과가 캡처 이미지인지. 서버가 응답을 만들 때 쓴다. */
/**
 * 캡처 여러 장. `window.capture` 가 메인 창과 대화상자를 함께 돌려준다.
 *
 * 하나만 돌려주면 "멈췄을 때 왜 멈췄는지 본다" 는 경우를 놓친다 — 대화상자는
 * 별도 최상위 창이다. (ROADMAP §17.17)
 */
export function isCapturedImageList(value: unknown): value is CapturedImage[] {
  return Array.isArray(value) && value.length > 0 && value.every(isCapturedImage);
}

export function isCapturedImage(value: unknown): value is CapturedImage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "image" &&
    typeof (value as { base64?: unknown }).base64 === "string"
  );
}
