import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  ADJUSTMENT_UPDATE,
  AdjustmentUpdateParamsSchema,
  type AdjustmentUpdateResult,
} from "../commands/adjustment-update.js";

/** `photoshop.adjustment.update` — 걸려 있는 조정 레이어의 값을 고친다. (ROADMAP §101) */
export function createAdjustmentUpdateTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof AdjustmentUpdateParamsSchema>, AdjustmentUpdateResult> {
  return {
    name: "photoshop.adjustment.update",
    description:
      "이미 만든 조정 레이어의 값을 **그 자리에서** 고친다 — history.undo 로 되감아 다시 만들거나 " +
      "새 레이어를 덧대지 않는다. kind 는 레이어의 종류(curves · levels · brightness_contrast · " +
      "hue_saturation · vibrance · color_balance · exposure · black_white · photo_filter · " +
      "channel_mixer)이고, settings 는 대응하는 photoshop.adjustment.<kind> Tool 의 입력과 같다 " +
      "(name 은 뺀다 — layer.rename). settings 는 **통째로 다시 정한다**: 안 준 값은 기본값이 된다. " +
      "곡선이면 points 를 전부 준다. 레이어 종류가 kind 와 다르면 거절한다. " +
      "현재 값은 photoshop.adjustment.get 으로 읽는다. " +
      "결과의 changed 는 전후 값을 읽어 확인한 것이다 — 같은 값을 넣으면 false 다.",
    permission: "edit",
    inputSchema: AdjustmentUpdateParamsSchema,
    handler: async (input, context) =>
      engine.execute<AdjustmentUpdateResult>(
        { type: ADJUSTMENT_UPDATE, params: input },
        { requestId: context.requestId },
      ),
  };
}
