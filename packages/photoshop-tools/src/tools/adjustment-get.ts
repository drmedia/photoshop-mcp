import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  ADJUSTMENT_GET,
  AdjustmentGetParamsSchema,
  type AdjustmentInfo,
} from "../commands/adjustment-get.js";

/** `photoshop.adjustment.get` — 조정 레이어가 가진 값을 읽는다. (ROADMAP §96) */
export function createAdjustmentGetTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof AdjustmentGetParamsSchema>, AdjustmentInfo> {
  return {
    name: "photoshop.adjustment.get",
    description:
      "조정 레이어가 가진 값을 읽는다 — 이미 걸린 보정이 무엇을 하는지 알아볼 때 쓴다. " +
      "layerId 를 생략하면 활성 레이어. 레이어 이름만으로는 알 수 없다 " +
      "(이름이 '지평선 광해 줄이기' 여도 실제로 무엇을 했는지는 값을 봐야 한다). " +
      "**settings 는 곡선(curves)과 색조·채도(hueSaturation)만 해석해서 준다** — 실기에서 모양을 확인한 " +
      "종류다. 레벨 · 밝기/대비 · 노출 · 채널 혼합 같은 나머지 종류는 settings 가 null 이고 raw 만 있다 " +
      "(layer.adjustmentType 으로 종류는 알 수 있다). " +
      "**곡선**: channels 마다 channel(composite · red · green · blue)과 points({input, output}, " +
      "둘 다 0–255, input 오름차순)가 온다. 항등이면 (0,0) (255,255) 두 점이다. output 이 input 보다 작으면 " +
      "그 구간을 어둡게 누르고 크면 밝힌다. **Photoshop 은 초록 채널을 'grain' 으로 돌려주는데 channel 에는 " +
      "green 으로 옮겨 준다.** 모르는 채널(Lab · CMYK 문서 등)은 channel 이 null 이고 rawChannel 에 원본 이름이 " +
      "있다. **색조·채도**: hue −180~180, saturation −100~100, lightness −100~100 (Photoshop 화면의 값 그대로)과 " +
      "colorize. 마스터 조정만 해석하고 색상 범위별 조정이 섞이면 null 이다. " +
      "**해석은 전부 아니면 null 이다** — 일부만 읽어 돌려주지 않는다. " +
      "**raw 는 Photoshop 이 준 원본 descriptor 이고 언제나 함께 온다.** " +
      "**조정 레이어가 아니면 오류가 아니라 isAdjustment: false 를 돌려준다** — 먼저 확인하는 용도로 쓸 수 있다. " +
      "**읽지 못하면 raw 는 null 이다** — 지어내지 않는다. " +
      "마스크는 담지 않는다(photoshop.document.analyze 의 target: 'mask'). 문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: AdjustmentGetParamsSchema,
    handler: async (input, context) =>
      engine.execute<AdjustmentInfo>(
        { type: ADJUSTMENT_GET, params: input },
        { requestId: context.requestId },
      ),
  };
}
