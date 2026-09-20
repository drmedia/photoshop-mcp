import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  SELECTION_SKY,
  SELECTION_SUBJECT,
  SelectionAutoParams,
  type SelectionResult,
} from "../commands/selection-auto.js";

function createTool(
  engine: CommandEngine,
  name: string,
  commandType: string,
  description: string,
): ToolDefinition<Record<string, never>, SelectionResult> {
  return {
    name,
    description,
    permission: "edit",
    inputSchema: SelectionAutoParams,
    handler: async (_input, context) =>
      engine.execute<SelectionResult>(
        { type: commandType, params: {} },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.selection.sky` — Photoshop 의 `선택 > 하늘`. */
export function createSelectionSkyTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, SelectionResult> {
  return createTool(
    engine,
    "photoshop.selection.sky",
    SELECTION_SKY,
    "Photoshop 의 '선택 > 하늘' 로 하늘 영역을 선택한다. 지평선을 따라 선택되므로 " +
      "사각형 근사와 달리 실제 경계를 얻는다. 하늘이 없는 사진에서는 선택이 비어 " +
      "hasSelection 이 false 다 — 오류가 아니다. " +
      "만든 선택은 mask.create 의 fromSelection 이나 조정 레이어의 자동 마스크로 쓴다.",
  );
}

/** `photoshop.selection.subject` — Photoshop 의 `선택 > 피사체`. (ROADMAP §17.28) */
export function createSelectionSubjectTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, SelectionResult> {
  return createTool(
    engine,
    "photoshop.selection.subject",
    SELECTION_SUBJECT,
    "Photoshop 의 '선택 > 피사체' 로 주요 피사체를 선택한다. 밝기가 아니라 **형태**로 " +
      "잡으므로 대상의 어두운 면까지 들어온다 — 밝기 기반 선택(selection.color_range) " +
      "으로 마스크를 만들고 shadows 를 올리면 서로 무효가 되는데 이 Tool 은 그 문제가 없다. " +
      "무엇을 '피사체' 로 볼지는 Photoshop 이 정한다. 야경처럼 주제가 분명하지 않은 " +
      "사진에서는 전경 전체를 잡을 수 있으므로 **결과 bounds 를 확인한다.** " +
      "아무것도 못 찾으면 hasSelection 이 false 다 — 오류가 아니다. " +
      "만든 선택은 mask.create 의 fromSelection 으로 쓴다.",
  );
}
