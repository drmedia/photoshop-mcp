import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  SELECTION_SKY,
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
