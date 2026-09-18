import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { LAYER_LIST } from "../commands/layer-list.js";

export const LayerListInputSchema = z.object({}).strict();

export interface LayerListToolResult {
  layers: LayerInfo[];
}

/** `photoshop.layer.list` — 활성 문서의 레이어 목록 조회. */
export function createLayerListTool(
  engine: CommandEngine,
): ToolDefinition<Record<string, never>, LayerListToolResult> {
  return {
    name: "photoshop.layer.list",
    description: "현재 활성 Photoshop 문서의 레이어 목록을 반환한다.",
    inputSchema: LayerListInputSchema,
    handler: async (_input, context) => {
      const layers = await engine.execute<LayerInfo[]>(
        { type: LAYER_LIST, params: {} },
        { requestId: context.requestId },
      );
      return { layers };
    },
  };
}
