import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  LAYER_ROTATE,
  LAYER_SCALE,
  LAYER_TRANSLATE,
  LayerRotateParamsSchema,
  LayerScaleParamsSchema,
  LayerTranslateParamsSchema,
  type LayerRotateParams,
  type LayerScaleParams,
  type LayerTransformResult,
  type LayerTranslateParams,
} from "../commands/layer-transform.js";

/** 셋이 같은 결과 모양을 쓴다. */
function createTransformTool<TParams>(
  name: string,
  description: string,
  permission: "edit" | "destructive",
  schema: ToolDefinition<TParams, LayerTransformResult>["inputSchema"],
  type: string,
  engine: CommandEngine,
): ToolDefinition<TParams, LayerTransformResult> {
  return {
    name,
    description,
    permission,
    inputSchema: schema,
    handler: async (input, context) =>
      engine.execute<LayerTransformResult>(
        { type, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.layer.translate` — 레이어를 옮긴다. */
export function createLayerTranslateTool(
  engine: CommandEngine,
): ToolDefinition<LayerTranslateParams, LayerTransformResult> {
  return createTransformTool(
    "photoshop.layer.translate",
    "레이어를 옮긴다. horizontal · vertical 은 **픽셀**이고 양수가 오른쪽·아래다. " +
      "최소 하나는 줘야 한다. layerId 를 생략하면 활성 레이어. " +
      "**픽셀을 다시 표본화하지 않아 잃는 것이 없다** — 반대 부호로 한 번 더 부르면 제자리다. " +
      "결과의 before · after 경계로 얼마나 움직였는지 확인한다. " +
      "**배경 레이어는 움직이지 않는다** — 위치가 태생적으로 잠겨 있다. " +
      "photoshop.layer.set_lock 의 position 으로 잠긴 레이어도 마찬가지다.",
    "edit",
    LayerTranslateParamsSchema,
    LAYER_TRANSLATE,
    engine,
  );
}

/** `photoshop.layer.scale` — 레이어 크기를 바꾼다. */
export function createLayerScaleTool(
  engine: CommandEngine,
): ToolDefinition<LayerScaleParams, LayerTransformResult> {
  return createTransformTool(
    "photoshop.layer.scale",
    "레이어 크기를 바꾼다. width · height 는 **퍼센트**이고 100 이 제자리다 — " +
      "픽셀 크기가 아니다. layerId 를 생략하면 활성 레이어. " +
      "**줄이면 되돌릴 수 없다** — 100 으로 되돌려도 버려진 해상도는 돌아오지 않는다. " +
      "photoshop.image.resize 가 문서 전체를 다시 표본화하는 것과 같은 종류이고, " +
      "이쪽은 레이어 하나다. 원본을 남기려면 layer.duplicate 로 복제한 뒤 건다. " +
      "anchor 는 어느 점을 고정할지다(topLeft · middleCenter · bottomRight 등 9가지). " +
      "생략하면 Photoshop 기본값이고 결과의 anchor 가 null 이 된다. " +
      "interpolation 은 다시 표본화할 때의 보간이다(automatic 기본 · bicubic · " +
      "bicubicSharper · bicubicSmoother · bilinear · nearestNeighbor). 줄일 때는 " +
      "bicubicSharper 가 낫다. 결과의 before · after 경계로 실제 배율을 확인한다.",
    "destructive",
    LayerScaleParamsSchema,
    LAYER_SCALE,
    engine,
  );
}

/** `photoshop.layer.rotate` — 레이어를 돌린다. */
export function createLayerRotateTool(
  engine: CommandEngine,
): ToolDefinition<LayerRotateParams, LayerTransformResult> {
  return createTransformTool(
    "photoshop.layer.rotate",
    "레이어를 돌린다. angle 은 **도**이고 -360 ~ 360 이다. **시계 방향이 양수**다 " +
      "(실기 확인, document.rotate 와 같다). " +
      "layerId 를 생략하면 활성 레이어. " +
      "**문서 전체를 돌리는 photoshop.document.rotate 와 다르다** — 수평 교정은 그쪽이고 " +
      "그쪽은 빈 모서리를 뺀 safeBounds 를 함께 준다. 이쪽은 레이어 하나만 돌린다. " +
      "anchor 는 어느 점을 중심으로 돌릴지다(9가지). 생략하면 Photoshop 기본값이고 " +
      "결과의 anchor 가 null 이 된다. " +
      "interpolation 으로 보간을 고른다(automatic 기본 외 5가지). " +
      "돌리면 픽셀을 다시 표본화하므로 여러 번 돌릴수록 흐려진다 — 각도를 나눠 " +
      "걸지 말고 한 번에 준다. 결과의 before · after 경계로 확인한다.",
    "edit",
    LayerRotateParamsSchema,
    LAYER_ROTATE,
    engine,
  );
}
