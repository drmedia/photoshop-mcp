import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_BIT_DEPTH_CONVERT,
  DocumentBitDepthParamsSchema,
  type BitDepthConvertResult,
  type DocumentBitDepthParams,
} from "../commands/document-bit-depth.js";

/** `photoshop.document.bit_depth_convert` — 채널당 비트 심도를 바꾼다. */
export function createDocumentBitDepthTool(
  engine: CommandEngine,
): ToolDefinition<DocumentBitDepthParams, BitDepthConvertResult> {
  return {
    name: "photoshop.document.bit_depth_convert",
    description:
      "채널당 비트 심도를 바꾼다(이미지 > 모드 > n비트/채널). depth 는 8 · 16 · 32. " +
      "**내리면 되돌릴 수 없다** — 16에서 8로 내리면 계조가 버려지고 다시 16으로 " +
      "올려도 돌아오지 않는다. 천체사진처럼 스트레치를 많이 하는 작업에서는 " +
      "16비트를 유지해야 계조가 무너지지 않는다. 원본을 남기려면 " +
      "photoshop.document.duplicate 로 복제한 뒤 복제본에 건다. " +
      "**결과의 applied 는 읽어서 비교한 값이다** — 이 속성은 값이 맞지 않으면 " +
      "조용히 무시되므로, 성공으로 보고하면 호출자가 16비트가 된 줄 알고 외부 " +
      "처리기를 돌린다. 안 들어가면 실패로 답한다. " +
      "이미 그 심도면 아무것도 하지 않는다. " +
      "색상 모드는 이 Tool 이 아니라 photoshop.document.mode_convert 다. " +
      "1비트는 열지 않았다 — Bitmap 색상 모드에서만 뜻이 있고 그 모드는 대화상자가 뜬다.",
    permission: "destructive",
    inputSchema: DocumentBitDepthParamsSchema,
    handler: async (input, context) =>
      engine.execute<BitDepthConvertResult>(
        { type: DOCUMENT_BIT_DEPTH_CONVERT, params: input },
        { requestId: context.requestId },
      ),
  };
}
