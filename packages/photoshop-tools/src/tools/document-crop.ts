import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_CROP,
  DocumentCropParamsSchema,
  type DocumentCropResult,
} from "../commands/document-crop.js";

/** `photoshop.document.crop` — 캔버스를 줄인다. 픽셀은 버리지 않는다. (ROADMAP §17.12) */
export function createDocumentCropTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentCropParamsSchema>, DocumentCropResult> {
  return {
    name: "photoshop.document.crop",
    description:
      "문서를 자른다. bounds 는 **남길** 영역이며 문서 픽셀 좌표(왼쪽 위가 0,0)다. " +
      "구도를 고치는 도구다 — 방해되는 가장자리를 덜어내거나 비율을 바꿀 때 쓴다. " +
      "톤·색과 달리 조정 레이어로는 할 수 없는 일이다. " +
      "**픽셀을 버리지 않는다.** 캔버스 경계만 줄이고 바깥 픽셀은 레이어에 남으므로 " +
      "되돌릴 수 있고, 대신 파일 크기는 줄지 않는다. " +
      "문서 밖으로 나가는 bounds 는 거부한다 — 캔버스를 넓히는 것은 자르기가 아니다. " +
      "결과의 width · height 는 요청값이 아니라 Photoshop 이 실제로 만든 값이다.",
    permission: "edit",
    inputSchema: DocumentCropParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentCropResult>(
        { type: DOCUMENT_CROP, params: input },
        { requestId: context.requestId },
      ),
  };
}
