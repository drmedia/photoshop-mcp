import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_MODE_CONVERT,
  DocumentModeConvertParamsSchema,
  type DocumentModeConvertParams,
  type ModeConvertResult,
} from "../commands/document-mode.js";

/** `photoshop.document.mode_convert` — 색상 모드를 바꾼다. */
export function createDocumentModeConvertTool(
  engine: CommandEngine,
): ToolDefinition<DocumentModeConvertParams, ModeConvertResult> {
  return {
    name: "photoshop.document.mode_convert",
    description:
      "문서의 색상 모드를 바꾼다(이미지 > 모드). rgb · grayscale · cmyk · lab 넷이다. " +
      "**되돌릴 수 없다** — grayscale 은 색을 영영 버리고 cmyk 는 색역 밖을 잘라낸다. " +
      "원본을 남기려면 photoshop.document.duplicate 로 복제한 뒤 복제본에 건다. " +
      "**흑백으로 만들려는 것이라면 이 Tool 이 아닐 수 있다** — grayscale 은 채널 자체를 " +
      "없애 이후 색 보정이 불가능해진다. 비파괴로 흑백을 얻으려면 " +
      "photoshop.adjustment.hue_saturation 으로 채도를 내리거나 camera_raw.apply 를 쓴다. " +
      "**색은 왕복해도 돌아오지 않는다** — 실기에서 (220,40,90) 분홍 얼룩을 " +
      "rgb→grayscale→cmyk→lab→rgb 로 돌렸더니 146.9/146.8/147.0 회색이 되었다. " +
      "레이어는 네 모드 모두에서 유지됐지만 결과의 layersDiscarded 가 0 이 아니면 " +
      "평탄화된 것이다. applied 는 요청한 모드가 실제로 되었는지를 " +
      "**읽어서 비교한 값**이고 요청값을 되풀이한 것이 아니다. " +
      "이미 그 모드면 아무것도 하지 않는다 — 같은 모드로 다시 걸면 얻는 것 없이 " +
      "평탄화만 될 수 있기 때문이다. " +
      "bitmap · indexedColor · multichannel 은 열지 않았다 — 설정 대화상자가 뜨면 " +
      "플러그인이 멈춘다. 비트 심도는 이 Tool 이 아니라 별도다.",
    permission: "destructive",
    inputSchema: DocumentModeConvertParamsSchema,
    handler: async (input, context) =>
      engine.execute<ModeConvertResult>(
        { type: DOCUMENT_MODE_CONVERT, params: input },
        { requestId: context.requestId },
      ),
  };
}
