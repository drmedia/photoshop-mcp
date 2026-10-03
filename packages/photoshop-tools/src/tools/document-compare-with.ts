import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_COMPARE_WITH,
  DocumentCompareWithParamsSchema,
  type DocumentCompareWithResult,
} from "../commands/document-compare-with.js";

/** `photoshop.document.compare_with` — 다른 문서와 그림과 수치로 견준다. (ROADMAP §101) */
export function createDocumentCompareWithTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentCompareWithParamsSchema>, DocumentCompareWithResult> {
  return {
    name: "photoshop.document.compare_with",
    description:
      "**활성 문서를 다른 열린 문서와** 한 장의 그림과 수치로 견준다 — 참조 사진에 맞춰 보정할 때 쓴다. " +
      "photoshop.document.compare 는 같은 문서의 전후(크기가 같아야 한다)이고, 이것은 크기와 비율이 " +
      "다른 두 문서다. 문서를 번갈아 캡처해 눈으로 견주던 것을 한 번에 한다. " +
      "documentId 는 견줄 **다른** 문서(photoshop.document.list 의 id)이고 layerId 를 생략하면 그 문서의 " +
      "합성이다. activeLayerId 를 생략하면 활성 문서의 합성이다. **활성 문서를 옮기지 않는다** — " +
      "문서 id 로 직접 읽는다. " +
      "**그림** — 가로로 이어 붙인 한 장이다. 왼쪽부터 결과의 panels 순서(reference = 다른 문서, " +
      "active = 활성 문서, diff 를 켰다면 difference)다. **그림에는 글자가 없으므로 panels 가 유일한 " +
      "표식이다.** 두 문서를 **같은 크기로 줄여** 붙이므로 비율이 다르면 한쪽이 늘어난다 — aspect.differs " +
      "로 알린다. " +
      "**수치** — 이 Tool 은 **축소한 미리보기에서** 잰다(measuredFrom: 'preview'). 그래서 " +
      "clipping 은 믿지 않는다(단일 픽셀 클리핑이 묻힌다). 휘도 분위수 · 채널 중앙값 · 타일 색차는 " +
      "구도가 비슷한 사진끼리 쓸 만하다. 필드의 before 는 reference, after 는 active 이고 change 는 " +
      "(active − reference)다. deltaE 는 CIE76 이고 sRGB 를 가정한다. " +
      "**판정은 없다** — 차이와 위치만 준다. 같은 장면이 아니면 타일 색차가 위치를 따르지 않는다. " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: DocumentCompareWithParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentCompareWithResult>(
        { type: DOCUMENT_COMPARE_WITH, params: input },
        { requestId: context.requestId },
      ),
  };
}
