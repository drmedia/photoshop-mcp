import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DODGE_BURN_DAB,
  DodgeBurnParamsSchema,
  type DodgeBurnResult,
} from "../commands/dodge-burn.js";

/** `photoshop.dodge_burn.dab` — 부드러운 원형 얼룩으로 밝히거나 어둡게 한다. (ROADMAP §17.31) */
export function createDodgeBurnDabTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DodgeBurnParamsSchema>, DodgeBurnResult> {
  return {
    name: "photoshop.dodge_burn.dab",
    description:
      "부드러운 원형 얼룩으로 밝히거나(dodge) 어둡게 한다(burn). " +
      "**먼저 레이어를 준비한다** — photoshop.layer.create 로 빈 픽셀 레이어를 만들고 " +
      "photoshop.layer.set_blend_mode 로 softLight 를 건다. 그 레이어를 layerId 로 지정한다. " +
      "빈 투명 픽셀은 softLight 에서 중립이므로 50% 회색을 채울 필요가 없다. " +
      "배경 레이어와 조정 레이어·그룹·스마트 오브젝트는 거절한다 — 원본 픽셀이 바뀐다. " +
      "**작게 여러 번이 크게 한 번보다 낫다.** strength 10-20 으로 겹쳐 쌓으면 경계가 드러나지 않는다. " +
      "x · y · radius 는 **문서 픽셀**(왼쪽 위가 0,0)이고 strength 는 1–100(채우기 불투명도 %), hardness 는 0–100 이다. " +
      "hardness 는 기본 0(가장 부드러움)이고 페더 = radius × (1 - hardness/100) 이다. " +
      "**성운처럼 형태가 복잡한 대상에는 맞지 않는다** — 원형 얼룩이 구조를 따라가지 못해 " +
      "부자연스러워진다. 그런 곳은 selection.color_range 로 휘도 마스크를 만들고 " +
      "adjustment.curves 를 거는 쪽이 맞다. 이 Tool 은 은하수 중심부 발광이나 전경의 " +
      "국소 밝기처럼 **둥근 것이 자연스러운 자리**에 쓴다. " +
      "결과의 applied 는 실제로 찍힌 수다 — 중간에 실패하면 요청 수와 다르다.",
    permission: "edit",
    inputSchema: DodgeBurnParamsSchema,
    handler: async (input, context) =>
      engine.execute<DodgeBurnResult>(
        { type: DODGE_BURN_DAB, params: input },
        { requestId: context.requestId },
      ),
  };
}
