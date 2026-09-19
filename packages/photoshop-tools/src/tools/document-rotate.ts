import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_ROTATE,
  DocumentRotateParamsSchema,
  type DocumentRotateResult,
} from "../commands/document-rotate.js";

/** `photoshop.document.rotate` — 캔버스 전체를 돌린다. 수평 교정용. (ROADMAP §17.19) */
export function createDocumentRotateTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentRotateParamsSchema>, DocumentRotateResult> {
  return {
    name: "photoshop.document.rotate",
    description:
      "문서 전체를 회전한다. 기울어진 수평선을 바로 세우는 도구다 — " +
      "자르기로는 절대 풀리지 않는 종류의 문제다. " +
      "angle 은 도 단위이고 **시계 방향이 양수**다. " +
      "수평선 기울기를 −1.87° 로 쟀다면 angle 은 1.87 이다. " +
      "짐작하지 말고 먼저 잰다 — 기울어 보인다고 돌리면 멀쩡한 사진을 망친다. " +
      "회전하면 캔버스가 커지고 모서리에 빈 영역이 생긴다. " +
      "결과의 safeBounds 가 **빈 영역이 들어오지 않는 최대 직사각형**(원본 종횡비 유지)이며 " +
      "photoshop.document.crop 의 bounds 에 그대로 넘기면 된다. " +
      "모든 레이어의 픽셀을 재보간하므로 각도를 나눠 여러 번 부르지 않는다 — " +
      "한 번에 최종 각도로 돌린다. 되돌리려면 photoshop.history.undo 를 쓴다.",
    permission: "edit",
    inputSchema: DocumentRotateParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentRotateResult>(
        { type: DOCUMENT_ROTATE, params: input },
        { requestId: context.requestId },
      ),
  };
}
