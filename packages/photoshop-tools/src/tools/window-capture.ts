import type { CapturedImage, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Photoshop 창 캡처. (ROADMAP §17.11)
 *
 * ## 문서 캡처와 다른 물건이다
 *
 * `document.capture` 는 **문서의 픽셀**을 준다. 이것은 **Photoshop 창**을 준다 —
 * 패널, 툴바, 떠 있는 대화상자까지.
 *
 * 보정이 잘 됐는지 보는 데는 쓸모가 없다. 쓸모는 하나다. **Command 가 멈췄을 때
 * 왜 멈췄는지 본다.** 대화상자가 떠 있으면 batchPlay 가 응답하지 않고 호출자는
 * 타임아웃만 받는다. `photoshop.diagnostics` 도 그건 못 본다 — Bridge 가 응답을
 * 못 하는 상태이므로 Photoshop 에게 물어볼 방법 자체가 없다.
 *
 * ## 그래서 `read` 가 아니다
 *
 * 찍는 것이 문서가 아니라 **사용자의 화면**이다. 창에는 파일 경로, 최근 문서 목록,
 * 계정 이름, 다른 대화상자가 보인다. Photoshop 문서를 읽는 것과 승인 경계가 다르다.
 *
 * `external` 이므로 기본 허용(`read` · `edit`) 밖이다. 사용자가
 * `PHOTOSHOP_MCP_ALLOW` 로 켜야 동작한다. 그것이 맞는 기본값이다.
 *
 * ## 대상은 고정이다
 *
 * Photoshop 메인 창만 찍는다. 호출자가 창 제목이나 핸들을 고르게 하면 그것은
 * **임의 창 캡처 도구**이고, ARCHITECTURE §23 이 막으려던 것과 같은 종류가 된다.
 */

export const WindowCaptureInputSchema = z
  .object({
    /** 긴 변 픽셀. 생략하면 1024. */
    longEdge: z.number().int().min(64).max(2048).optional(),
  })
  .strict();

export type WindowCaptureInput = z.infer<typeof WindowCaptureInputSchema>;

/**
 * 창 캡처 구현. OS 에 닿으므로 node 쪽(`mcp-core`)에 둔다.
 *
 * `photoshop-tools` 는 `node:` 를 쓰지 않는 정의 계층이다. 여기에 구현을 넣으면
 * 그 성질이 깨진다.
 */
export interface WindowCapturer {
  capture(input: WindowCaptureInput): Promise<CapturedImage>;
}

/** `photoshop.window.capture` — Photoshop 창을 그대로 찍는다. */
export function createWindowCaptureTool(
  capturer: WindowCapturer,
): ToolDefinition<WindowCaptureInput, CapturedImage> {
  return {
    name: "photoshop.window.capture",
    description:
      "Photoshop **창 전체**를 찍어 그림으로 돌려준다. 패널·툴바·대화상자가 함께 찍힌다. " +
      "**무언가 응답하지 않거나 타임아웃이 났을 때 쓴다** — 대화상자가 떠 있으면 " +
      "Photoshop 이 명령을 받지 못하는데, 그 사실은 이 Tool 로만 볼 수 있다. " +
      "보정 결과를 확인하는 용도가 아니다. 그건 photoshop.document.capture 를 쓴다. " +
      "사용자의 화면을 찍으므로 권한이 external 이며 기본 설정에서는 막혀 있다. " +
      "현재 Windows 에서만 동작한다.",
    permission: "external",
    inputSchema: WindowCaptureInputSchema,
    handler: async (input) => capturer.capture(input),
  };
}
