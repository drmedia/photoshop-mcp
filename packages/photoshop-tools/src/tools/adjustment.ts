import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  ADJUSTMENT_BRIGHTNESS_CONTRAST,
  ADJUSTMENT_CURVES,
  ADJUSTMENT_LEVELS,
  BrightnessContrastParamsSchema,
  CurvesParamsSchema,
  LevelsParamsSchema,
  type BrightnessContrastParams,
  type CurvesParams,
  type LevelsParams,
} from "../commands/adjustment.js";

/** Phase 4 조정 Tool. (ROADMAP §8.3) 전부 조정 레이어를 만드는 비파괴 방식이다. */

export function createCurvesTool(engine: CommandEngine): ToolDefinition<CurvesParams, LayerInfo> {
  return {
    name: "photoshop.adjustment.curves",
    description:
      "Curves 조정 레이어를 만든다. points 는 {input, output} (0-255) 제어점 배열이며 input 오름차순이어야 한다. " +
      "중간톤 대비를 올리려면 어두운 쪽 점을 내리고 밝은 쪽 점을 올린다. 예: [{input:0,output:0},{input:64,output:54},{input:192,output:202},{input:255,output:255}]",
    inputSchema: CurvesParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: ADJUSTMENT_CURVES, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createLevelsTool(engine: CommandEngine): ToolDefinition<LevelsParams, LayerInfo> {
  return {
    name: "photoshop.adjustment.levels",
    description:
      "Levels 조정 레이어를 만든다. 입력 검은점/흰점, 감마(1 이 기본), 출력 검은점/흰점을 지정한다.",
    inputSchema: LevelsParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: ADJUSTMENT_LEVELS, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createBrightnessContrastTool(
  engine: CommandEngine,
): ToolDefinition<BrightnessContrastParams, LayerInfo> {
  return {
    name: "photoshop.adjustment.brightness_contrast",
    description:
      "Brightness/Contrast 조정 레이어를 만든다. brightness -150~150, contrast -50~100. 둘 다 0 이 기본.",
    inputSchema: BrightnessContrastParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: ADJUSTMENT_BRIGHTNESS_CONTRAST, params: input },
        { requestId: context.requestId },
      ),
  };
}
