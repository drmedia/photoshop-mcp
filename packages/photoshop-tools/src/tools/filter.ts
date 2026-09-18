import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  FILTER_GAUSSIAN_BLUR,
  GaussianBlurParamsSchema,
  type GaussianBlurParams,
} from "../commands/filter.js";

/** Phase 4 필터 Tool. (ROADMAP §8.4) */
export function createGaussianBlurTool(
  engine: CommandEngine,
): ToolDefinition<GaussianBlurParams, LayerInfo> {
  return {
    name: "photoshop.filter.gaussian_blur",
    description:
      "가우시안 블러를 적용한다. radius 는 픽셀 단위(0.1-1000). " +
      "기본은 스마트 필터로 적용해 나중에 수정·제거할 수 있다. " +
      "asSmartFilter: false 를 주면 픽셀에 직접 적용하며 되돌릴 수 없다. " +
      "layerId 를 생략하면 활성 레이어.",
    inputSchema: GaussianBlurParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: FILTER_GAUSSIAN_BLUR, params: input },
        { requestId: context.requestId },
      ),
  };
}
