import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  IMAGE_RESIZE,
  ImageResizeParamsSchema,
  type ImageResizeParams,
  type ImageResizeResult,
} from "../commands/image-resize.js";

/**
 * `photoshop.image.resize` — 이미지 크기를 바꾼다.
 *
 * **`destructive` 다.** `document.crop` 이 `edit` 인 근거는 "픽셀을 버리지
 * 않는다" 인데, 축소는 버린다.
 */
export function createImageResizeTool(
  engine: CommandEngine,
): ToolDefinition<ImageResizeParams, ImageResizeResult> {
  return {
    name: "photoshop.image.resize",
    description:
      "이미지 크기를 바꾼다(이미지 > 이미지 크기). width · height 는 픽셀, resolution 은 ppi 다. " +
      "셋 중 최소 하나가 있어야 한다. **document.crop 과 다르다** — crop 은 캔버스만 줄이고 " +
      "픽셀을 레이어에 남기지만 이쪽은 픽셀을 다시 표본화한다. **줄이면 해상도가 " +
      "되돌릴 수 없게 사라지므로 destructive 다** — 원본을 남기려면 document.save_as 로 " +
      "먼저 저장하거나 document.duplicate 뒤에 한다. " +
      "resample 은 automatic(기본) · bicubic · bicubicSharper · bicubicSmoother · bilinear · " +
      "nearestNeighbor · preserveDetails · deepUpscale. 키울 때는 preserveDetails 나 " +
      "deepUpscale, 줄일 때는 bicubicSharper 가 낫다. 모르는 값은 조용히 무시하지 않고 거절한다. " +
      "**한쪽만 주면 비율이 유지된다**(실기 확인: 4000x2500 에 width 2000 → 2000x1250). " +
      "둘 다 주면 비율을 무시하고 그대로 맞춘다 — 왜곡된다. " +
      "**resolution 만 바꿔도 픽셀 크기가 함께 바뀐다** — DPI 메타데이터만 고치는 길이 " +
      "아니다. 실기에서 2000x1250 · 300ppi 를 72ppi 로 바꾸니 480x300 이 됐다(0.24배). " +
      "인쇄 크기를 유지한 채 다시 표본화하기 때문이고, 픽셀을 지키려면 width · height 를 " +
      "함께 준다. before 와 after 를 함께 주므로 무엇이 일어났는지 그대로 보이고, " +
      "applied 는 요청한 값이 실제로 들어갔는지를 말한다. 레이어는 전부 유지된다.",
    permission: "destructive",
    inputSchema: ImageResizeParamsSchema,
    handler: async (input, context) =>
      engine.execute<ImageResizeResult>(
        { type: IMAGE_RESIZE, params: input },
        { requestId: context.requestId },
      ),
  };
}
