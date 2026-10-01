import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  MASK_DAB,
  MaskDabParamsSchema,
  PAINT_DAB,
  PaintDabParamsSchema,
  type PaintResult,
} from "../commands/paint.js";

/** `photoshop.paint.dab` — 지정한 색으로 부드러운 원형 얼룩을 칠한다. (ROADMAP §17.32) */
export function createPaintDabTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof PaintDabParamsSchema>, PaintResult> {
  return {
    name: "photoshop.paint.dab",
    description:
      "지정한 색(0-255 RGB)으로 부드러운 원형 얼룩을 칠한다. " +
      "**픽셀을 덮어쓰므로 photoshop.layer.create 로 만든 빈 레이어에 칠한다** — " +
      "배경 레이어와 조정 레이어·그룹·스마트 오브젝트는 거절한다. " +
      "작게 여러 번이 크게 한 번보다 낫다. strength 10-20 으로 겹쳐 쌓으면 경계가 드러나지 않는다. " +
      "x · y · radius 는 **문서 픽셀**(왼쪽 위가 0,0)이고 strength 는 1–100(채우기 불투명도 %), hardness 는 0–100 이다. " +
      "hardness 기본 0(가장 부드러움), 페더 = radius × (1 - hardness/100) 이고 " +
      "**실효 범위가 지정 반지름의 약 2.5배**다. " +
      "비파괴로 밝기만 손보려면 photoshop.dodge_burn.dab, " +
      "마스크를 다듬으려면 photoshop.mask.dab 쪽이 맞다.",
    permission: "edit",
    inputSchema: PaintDabParamsSchema,
    handler: async (input, context) =>
      engine.execute<PaintResult>(
        { type: PAINT_DAB, params: input },
        { requestId: context.requestId },
      ),
  };
}

/** `photoshop.mask.dab` — 레이어 마스크에 부드러운 원형 얼룩을 칠한다. (ROADMAP §17.32) */
export function createMaskDabTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof MaskDabParamsSchema>, PaintResult> {
  return {
    name: "photoshop.mask.dab",
    description:
      "레이어 마스크에 부드러운 원형 얼룩을 칠한다. mode 는 reveal(흰색·보이게) 또는 hide(검정·가리게). " +
      "**조정 레이어의 마스크에도 쓸 수 있어 비파괴 보정의 한가운데에 들어간다** — " +
      "photoshop.mask.gradient 가 마스크를 통째로 덮어쓰는 것과 달리 이쪽은 더한다. " +
      "선형·방사형 그라디언트로 맞출 수 없는 **비대칭한 빛 공해나 얼룩진 밝기**를 국소적으로 다듬는 자리다. " +
      "합성 픽셀에 dodge_burn.dab 으로 덮으면 조정 레이어를 껐다 켤 때 따라오지 않지만 이쪽은 따라온다. " +
      "x · y · radius 는 **문서 픽셀**(왼쪽 위가 0,0)이고 strength 는 1–100(채우기 불투명도 %), hardness 는 0–100 이다. " +
      "마스크가 없으면 거절한다 — photoshop.mask.create 로 먼저 만든다. " +
      "layer.list 의 hasMask 로 확인할 수 있다. " +
      "**실효 범위가 지정 반지름의 약 2.5배**이고 strength 10-20 으로 겹쳐 쌓는 것이 좋다.",
    permission: "edit",
    inputSchema: MaskDabParamsSchema,
    handler: async (input, context) =>
      engine.execute<PaintResult>(
        { type: MASK_DAB, params: input },
        { requestId: context.requestId },
      ),
  };
}
