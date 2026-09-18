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
      "**기본은 픽셀에 직접 적용한다** — Photoshop 자신의 동작과 같고, 레이어 id 와 type 이 그대로라 여러 단계를 이어갈 때 추적하기 쉽다. 대신 되돌릴 수 없으므로 **비파괴가 필요하면 layer.duplicate 한 복제본에 적용한다.** asSmartFilter: true 를 주면 대상을 스마트 오브젝트로 바꿔 나중에 수정·제거할 수 있는 스마트 필터로 붙이지만, 그때는 id 와 type 이 달라지므로 반환값의 id 를 그대로 써야 한다. 조정 레이어와 그룹에는 적용할 수 없다.",
    permission: "edit",
    inputSchema: GaussianBlurParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: FILTER_GAUSSIAN_BLUR, params: input },
        { requestId: context.requestId },
      ),
  };
}
