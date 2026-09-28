import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_PLACE,
  LayerPlaceParamsSchema,
  type LayerPlaceParams,
} from "../commands/layer-place.js";

/** `photoshop.layer.place` — 승인된 폴더의 파일을 스마트 오브젝트 레이어로 가져온다. */
export function createLayerPlaceTool(
  engine: CommandEngine,
): ToolDefinition<LayerPlaceParams, LayerInfo> {
  return {
    name: "photoshop.layer.place",
    description:
      "승인된 작업 폴더의 이미지 파일을 현재 문서에 스마트 오브젝트 레이어로 가져온다. " +
      "파일 이름만 받으며 경로는 쓸 수 없다. " +
      "외부 처리기가 만든 결과를 Photoshop 으로 되돌릴 때 쓴다. " +
      "문서 맨 위가 아니라 **현재 활성 레이어 바로 위**에 놓이며, " +
      "활성 레이어가 그룹 안에 있으면 같은 그룹 안으로 들어가고, " +
      "활성 레이어의 불투명도를 물려받는다. " +
      "위치와 불투명도가 중요하면 먼저 layer.select 로 기준 레이어를 고른다. " +
      "rasterize 를 켜면 스마트 오브젝트 대신 픽셀 레이어로 가져온다 — " +
      "외부 처리기가 구워 돌려준 결과처럼 다시 편집할 원본이 없을 때 쓴다. " +
      "linked 를 켜면 **파일을 연결로 가져온다** — 원본이 바뀌면 문서도 따라 바뀌고 " +
      "photoshop.smart_object.relink · update 를 쓸 수 있다. " +
      "**대신 파일을 옮기거나 지우면 문서가 깨진다.** 외부 처리기가 쏟는 TIFF 가 " +
      "쌓이는 곳이 바로 이 폴더이고 photoshop.workspace.delete 가 그것을 치우므로, " +
      "정리 대상인 파일에는 연결을 걸지 않는다. 기본은 포함(embedded)이다. " +
      "linked 와 rasterize 는 함께 줄 수 없다 — 구우면 연결이 사라진다.",
    permission: "external",
    inputSchema: LayerPlaceParamsSchema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>(
        { type: LAYER_PLACE, params: input },
        { requestId: context.requestId },
      ),
  };
}
