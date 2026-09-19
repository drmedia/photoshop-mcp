import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { CapturedImage } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 화면 캡처. (ROADMAP §17.10)
 *
 * 호출자가 자기 편집 결과를 **볼 수** 있게 한다. 이것이 없어서 보정 열 단계를 다
 * 쌓은 뒤에야 하늘이 보라색이 된 것을 발견한 적이 있다.
 *
 * 권한은 `read` 다. 문서를 바꾸지 않고, 파일도 쓰지 않는다 — Imaging API 가 픽셀을
 * 메모리로 준다. `document.export` 로도 볼 수는 있지만 그쪽은 `external` 권한과
 * 승인된 작업 폴더가 필요한 무거운 우회다.
 */

export const CAPTURE_DOCUMENT = "CAPTURE_DOCUMENT";
export const CAPTURE_LAYER = "CAPTURE_LAYER";
export const CAPTURE_SELECTION = "CAPTURE_SELECTION";

/**
 * 공통 옵션.
 *
 * `longEdge` 상한을 2048 로 둔다. 원본 해상도를 보낼 이유가 없다 — 구도·색·노출
 * 판단에는 1024 면 충분하고 그보다 크면 토큰만 먹는다.
 */
const CaptureBase = {
  longEdge: z.number().int().min(64).max(2048).optional(),
  format: z.enum(["jpeg", "png"]).optional(),
  quality: z.number().int().min(1).max(100).optional(),
};

export const CaptureDocumentParams = z.object({ ...CaptureBase }).strict();
export const CaptureLayerParams = z
  .object({ layerId: z.number().int().optional(), ...CaptureBase })
  .strict();
export const CaptureSelectionParams = z.object({ ...CaptureBase }).strict();

function forward<TParams>(): CommandHandler<TParams, CapturedImage> {
  return async (command, context) => context.bridge.executeCommand<CapturedImage>(command);
}

export const captureDocumentCommand = forward<z.infer<typeof CaptureDocumentParams>>();
export const captureLayerCommand = forward<z.infer<typeof CaptureLayerParams>>();
export const captureSelectionCommand = forward<z.infer<typeof CaptureSelectionParams>>();
