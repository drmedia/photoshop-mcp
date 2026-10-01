import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  MASK_SUMMARY,
  MaskSummaryParamsSchema,
  type MaskSummary,
} from "../commands/mask-summary.js";

/** `photoshop.mask.summary` — 마스크가 어디를 얼마나 가리는지 요약한다. (ROADMAP §97) */
export function createMaskSummaryTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof MaskSummaryParamsSchema>, MaskSummary> {
  return {
    name: "photoshop.mask.summary",
    description:
      "레이어 마스크가 **어디를 얼마나** 가리는지 요약한다 — 조정 레이어의 효과가 어디에 걸리는지 알아볼 때 " +
      "쓴다. layerId 를 생략하면 활성 레이어이고 **마스크가 있어야 한다**(없으면 거절). " +
      "photoshop.document.analyze 의 마스크 분석은 거의 한 값인 마스크에서 gradient 가 0 이라 모양을 말하지 " +
      "못한다 — 이쪽이 그 자리다. " +
      "**비율** — hiddenPercent(완전히 가림) · revealedPercent(완전히 보임) · partialPercent(그 사이, 번짐) 는 " +
      "퍼센트(0–100)이고 합이 100 이다. 임계는 0–255 눈금의 양 끝(< 0.5 가림, >= 254.5 보임)이라 8비트 " +
      "마스크에서는 정확히 0 과 255 다. meanPercent 는 평균 강도(100 이면 전부 보인다). " +
      "**경계 상자** — touched 는 효과가 조금이라도 닿는(완전히 가리지 않은) 픽셀의 상자, full 은 완전히 보이는 " +
      "픽셀의 상자이고 없으면 null 이다. **문서 픽셀이고 왼쪽 위가 원점이며 right · bottom 은 포함하지 않는다** " +
      "(= left + 가로 폭). 마스크가 문서보다 커도 문서 캔버스 범위로 잰다(area 가 그 크기). " +
      "**tiles** 는 rows × cols 격자의 평균 강도(퍼센트 0–100, 위에서 아래 · 왼쪽에서 오른쪽)이고 grid 는 짧은 변의 " +
      "타일 수다(기본 8). 효과가 어느 쪽에 몰려 있는지 본다. " +
      "**판정은 없다** — 숫자와 위치만 준다. 가장자리 번짐 폭은 담지 않는다(partialPercent 와 touched · full 의 " +
      "차이로 짐작한다). 문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: MaskSummaryParamsSchema,
    handler: async (input, context) =>
      engine.execute<MaskSummary>(
        { type: MASK_SUMMARY, params: input },
        { requestId: context.requestId },
      ),
  };
}
