import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  CANVAS_RESIZE,
  CanvasResizeParamsSchema,
  type CanvasResizeParams,
  type CanvasResizeResult,
} from "../commands/canvas-resize.js";

/** `photoshop.canvas.resize` — 캔버스 크기를 바꾼다. */
export function createCanvasResizeTool(
  engine: CommandEngine,
): ToolDefinition<CanvasResizeParams, CanvasResizeResult> {
  return {
    name: "photoshop.canvas.resize",
    description:
      "캔버스 크기를 바꾼다(이미지 > 캔버스 크기). 그림은 그대로 두고 종이 크기만 바꾼다 — " +
      "늘리면 빈 자리가 생기고 줄이면 바깥이 캔버스 밖으로 나간다. " +
      "**photoshop.image.resize 와 다르다** — 그쪽은 픽셀을 다시 표본화해 그림이 통째로 " +
      "커지거나 작아진다. 여백을 더하거나 덜어낼 때가 이쪽이다. " +
      "width · height 중 최소 하나가 있어야 하고 **생략한 쪽은 지금 값 그대로다** — " +
      "image.resize 에서 한쪽을 생략하면 비율을 맞추는 것과 다르다. " +
      "anchor 는 기존 그림을 새 캔버스 어디에 둘지다(topLeft · middleCenter · bottomRight 등 9가지). " +
      "**줄일 때 어느 쪽이 잘리는지가 anchor 로 결정된다** — 생략하면 Photoshop 기본값이고 " +
      "결과의 anchor 가 null 이 된다. 모르는 값은 조용히 무시하지 않고 거절한다. " +
      "**줄이면 배경 레이어의 바깥 픽셀이 사라진다 — 되돌릴 수 없다.** 실기에서 " +
      "쟀다. 일반 레이어는 바깥 픽셀을 그대로 갖고 있어 캔버스를 다시 늘리면 " +
      "돌아오지만, 배경 레이어는 그렇지 않다. 그래서 destructive 다. " +
      "**무손실로 줄이려면 photoshop.document.crop 을 쓴다** — 그쪽은 배경을 일반 " +
      "레이어로 승격시켜 바깥 픽셀을 남긴다(대신 파일 크기가 줄지 않는다). " +
      "여백을 늘리기만 할 때는 아무것도 잃지 않는다.",
    permission: "destructive",
    inputSchema: CanvasResizeParamsSchema,
    handler: async (input, context) =>
      engine.execute<CanvasResizeResult>(
        { type: CANVAS_RESIZE, params: input },
        { requestId: context.requestId },
      ),
  };
}
