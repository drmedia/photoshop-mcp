import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  DOCUMENT_PASTE,
  DocumentPasteParamsSchema,
  type DocumentPasteParams,
  type PasteResult,
} from "../commands/document-paste.js";

/**
 * `photoshop.document.paste` — 클립보드 내용을 붙여 넣는다.
 *
 * **`external` 이다.** 문서 밖에서 데이터가 들어오고, 그 데이터는 사용자의
 * 클립보드다.
 */
export function createDocumentPasteTool(
  engine: CommandEngine,
): ToolDefinition<DocumentPasteParams, PasteResult> {
  return {
    name: "photoshop.document.paste",
    description:
      "클립보드 내용을 새 레이어로 붙여 넣는다. " +
      "**무엇이 들어올지 미리 알 수 없다** — 사용자가 방금 복사한 것이면 무엇이든 온다. " +
      "이 서버에는 복사하는 Tool 이 없으므로(Photoshop UXP 에 clipboard 쓰기 API 가 없다) " +
      "클립보드를 채우는 것은 언제나 사용자다. " +
      "**사용자의 클립보드를 문서로 들여오는 일이라 external 이고 기본 허용 밖이다** — " +
      "들어온 내용은 document.capture 나 statistics 로 읽을 수 있으므로, 사용자가 " +
      "복사해 둔 것이 무엇이든 보이게 된다. 필요할 때만 쓰고 결과를 함부로 캡처하지 않는다. " +
      "intoSelection: true 는 현재 선택 영역 안에 붙여 넣는다 — 선택이 없으면 거절한다. " +
      "**이때 선택 영역을 마스크로 쓰는 레이어가 생긴다**(결과의 hasMask 가 true) — " +
      "내용이 선택 크기에 맞춰 잘리고 가운데 정렬된다. " +
      "**내용은 해석하지 않는다.** 결과의 layer 와 bounds 로 무엇이 얼마나 들어왔는지 " +
      "가늠한다. **위치를 짐작하지 말고 bounds 를 읽는다.** " +
      "**클립보드가 비면 Photoshop 이 오류를 내지 않고 아무 일도 하지 않는다** — " +
      "그 경우 이 Tool 은 문서가 그대로인 것을 확인하고 실패로 답한다. " +
      "파일을 가져오려는 것이라면 photoshop.layer.place 가 맞다 — 그쪽은 승인된 폴더 안으로 " +
      "제한되고 스마트 오브젝트로 들어온다.",
    permission: "external",
    inputSchema: DocumentPasteParamsSchema,
    handler: async (input, context) =>
      engine.execute<PasteResult>(
        { type: DOCUMENT_PASTE, params: input },
        { requestId: context.requestId },
      ),
  };
}
