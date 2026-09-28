import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_TRIM,
  DocumentTrimParamsSchema,
  type DocumentTrimParams,
  type DocumentTrimResult,
} from "../commands/document-trim.js";

/** `photoshop.document.trim` — 둘레의 여백을 잘라낸다. */
export function createDocumentTrimTool(
  engine: CommandEngine,
): ToolDefinition<DocumentTrimParams, DocumentTrimResult> {
  return {
    name: "photoshop.document.trim",
    description:
      "둘레의 여백을 잘라낸다(이미지 > 재단). mode 는 transparent(투명한 둘레) · " +
      "topLeft(왼쪽 위 픽셀과 같은 색) · bottomRight(오른쪽 아래 픽셀과 같은 색). " +
      "**무엇을 남길지 Photoshop 이 픽셀을 보고 정한다** — document.crop 은 호출자가 " +
      "좌표로, canvas.resize 는 크기와 기준점으로 정한다. 그래서 이것만 얼마나 잘릴지 " +
      "미리 알 수 없고 결과의 before · after · removed 로 확인한다. " +
      "**어느 면이 얼마나 잘렸는지는 알 수 없다** — 가로·세로 총량만 준다. " +
      "top · left · bottom · right 로 면을 고르며 **한 면이라도 주면 나머지는 true 로 " +
      "간주한다**. 전부 생략하면 Photoshop 기본값이다. " +
      "**자를 것이 없으면 오류가 아니다** — changed: false 로 답한다. " +
      "**숨긴 레이어의 내용이 잘려 나간 영역에 있으면 사라진다.** 실기에서 확인했다 — " +
      "숨긴 레이어에 찍어 둔 얼룩이 통째로 없어졌다(bounds 0). canvas.resize 는 일반 " +
      "레이어의 캔버스 밖 픽셀을 남기지만 이쪽은 남기지 않는다. document.flatten 이 " +
      "숨긴 레이어를 버리는 것과 같은 종류의 놀라움이라 destructive 다. " +
      "숨긴 레이어가 있으면 photoshop.layer.list 로 먼저 확인한다. " +
      "회전 뒤 생긴 빈 모서리를 없앨 때는 document.rotate 의 safeBounds 를 " +
      "document.crop 에 넘기는 쪽이 정확하다. 그쪽은 빈 영역이 한 픽셀도 안 들어온다.",
    permission: "destructive",
    inputSchema: DocumentTrimParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentTrimResult>(
        { type: DOCUMENT_TRIM, params: input },
        { requestId: context.requestId },
      ),
  };
}
