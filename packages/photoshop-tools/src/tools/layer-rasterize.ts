import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_RASTERIZE,
  LayerRasterizeParamsSchema,
  type LayerRasterizeParams,
  type LayerRasterizeResult,
} from "../commands/layer-rasterize.js";

/** `photoshop.layer.rasterize` — 레이어를 픽셀로 굽는다. */
export function createLayerRasterizeTool(
  engine: CommandEngine,
): ToolDefinition<LayerRasterizeParams, LayerRasterizeResult> {
  return {
    name: "photoshop.layer.rasterize",
    description:
      "레이어를 픽셀로 굽는다. layerId 를 생략하면 활성 레이어. " +
      "target 은 entireLayer(기본) · layerStyle · textContents · shape · " +
      "vectorMask · fillContent. " +
      "**되돌릴 수 없다** — 스마트 오브젝트를 구우면 안의 원본과 스마트 필터가 " +
      "사라지고, 텍스트를 구우면 글자를 고칠 수 없다. History 로는 돌아가지만 " +
      "저장하면 끝이다. 원본을 남기려면 photoshop.layer.duplicate 로 복제한 뒤 " +
      "복제본에 건다. " +
      "**굽지 않는 길을 먼저 본다** — 스마트 필터의 값은 photoshop.camera_raw.apply 로 " +
      "다시 걸 수 있고 마스크는 mask.disable 로 끌 수 있다. " +
      "**id 는 바뀌지 않는다**(실기 확인) — smart_object.convert 와 다른 점이다. " +
      "그래도 previousId 를 담으므로 혹시 바뀌면 드러난다. " +
      "**할 일이 없어도 오류가 아니다** — 이미 픽셀인 레이어에 걸어도 조용히 성공한다. " +
      "entireLayer 로 걸었을 때 결과의 previousType 이 pixel 이면 아무 일도 " +
      "일어나지 않은 것이다. 무엇을 구울 수 있는지는 layer.list 의 type 으로 먼저 본다.",
    permission: "destructive",
    inputSchema: LayerRasterizeParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerRasterizeResult>(
        { type: LAYER_RASTERIZE, params: input },
        { requestId: context.requestId },
      ),
  };
}
