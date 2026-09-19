import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_CLOSE,
  DOCUMENT_FLATTEN,
  DocumentCloseParamsSchema,
  DocumentFlattenParamsSchema,
  type DocumentCloseResult,
  type DocumentFlattenResult,
} from "../commands/document-lifecycle.js";

/** `photoshop.document.flatten` — 모든 레이어를 하나로 합친다. (ROADMAP §17.25) */
export function createDocumentFlattenTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentFlattenParamsSchema>, DocumentFlattenResult> {
  return {
    name: "photoshop.document.flatten",
    description:
      "모든 레이어를 하나로 합친다. **되돌릴 수 없는 일이므로 마지막에 한다** — " +
      "조정 레이어가 구워지고 투명 영역이 배경색으로 채워진다. " +
      "**숨긴 레이어는 합쳐지는 것이 아니라 버려진다.** " +
      "결과의 hiddenDiscarded 가 0 이 아니면 의도한 것인지 확인한다. " +
      "보통은 평탄화하지 않고 document.export 를 쓴다 — export 는 사본을 만들 뿐 " +
      "원본 레이어를 건드리지 않는다. 평탄화가 필요한 경우는 그 상태로 저장해야 할 때다. " +
      "History 로 되돌릴 수 있지만 저장하면 끝이다.",
    permission: "destructive",
    inputSchema: DocumentFlattenParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentFlattenResult>(
        { type: DOCUMENT_FLATTEN, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.document.close` — 문서를 닫는다. 저장하지 않는다. (ROADMAP §17.25) */
export function createDocumentCloseTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentCloseParamsSchema>, DocumentCloseResult> {
  return {
    name: "photoshop.document.close",
    description:
      "활성 문서를 닫는다. **저장하지 않고 닫는다** — 저장하려면 " +
      "photoshop.document.save 나 save_as 를 먼저 부른다. " +
      "discardChanges 에 true 를 명시해야 한다. 기본값을 두지 않은 것은 " +
      "이것이 작업을 잃는 선택이기 때문이다. " +
      "Photoshop 이 저장 여부를 묻는 창을 띄우면 플러그인이 멈추므로 " +
      "언제나 '저장하지 않음' 으로 닫는다. " +
      "결과의 remainingDocuments 가 0 이면 이후 Command 가 전부 실패한다.",
    permission: "destructive",
    inputSchema: DocumentCloseParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentCloseResult>(
        { type: DOCUMENT_CLOSE, params: input },
        { requestId: context.requestId },
      ),
  };
}
