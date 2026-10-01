import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  DOCUMENT_STATISTICS,
  DocumentStatisticsParamsSchema,
  type DocumentStatisticsResult,
} from "../commands/document-statistics.js";

/** `photoshop.document.statistics` — 눈이 아니라 숫자로 본다. (ROADMAP §17.13) */
export function createDocumentStatisticsTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof DocumentStatisticsParamsSchema>, DocumentStatisticsResult> {
  return {
    name: "photoshop.document.statistics",
    description:
      "히스토그램과 채널별 통계를 **전체 해상도 원본에서** 잰다. " +
      "보정 전에는 무엇이 문제인지 진단하고, 보정 뒤에는 의도한 대로 들어갔는지 확인한다. " +
      "**그림으로 봐서는 잡히지 않는 것을 잡는다** — 어두운 영역의 색 편향, 미세한 캐스트, " +
      "작은 클리핑. photoshop.document.capture 와 짝으로 쓴다. " +
      "채널별 평균·백분위(p1/p5/p50/p95/p99)·클리핑과 휘도 64구간 분포를 준다. " +
      "**단위를 잘못 읽지 않는다** — mean 과 p1~p99 는 0–255 값이고, " +
      "**clippedHigh · clippedLow 는 퍼센트(0–100)다. 비율(0–1)이 아니다.** " +
      "0.2352 는 0.2352% 이지 23.5% 가 아니다 — 100 배로 읽으면 멀쩡한 보정을 " +
      "고치려 든다. histogram 도 64구간 각각이 퍼센트이고 합이 100 이며, " +
      "noise 는 0–255 눈금의 σ 다. " +
      "값은 문서 심도와 무관하게 0–255 로 정규화하되 클리핑은 원래 심도에서 판정한다. " +
      "채널마다 noise 로 σ 추정을 함께 준다 — 스트레치나 그림자 올리기를 **얼마나** 할지 " +
      "정하는 근거다. **평탄한 영역에서 재야 한다** — 나뭇잎처럼 촘촘한 질감은 노이즈와 " +
      "구분되지 않으므로 region 을 selection 으로 좁혀 하늘 같은 곳을 지정한다. " +
      "region 을 selection 으로 주면 선택 영역만, layerId 를 주면 그 레이어만 잰다 " +
      "(생략하면 보이는 그대로의 합성 결과). " +
      "**target: 'mask' 면 레이어 마스크를 잰다.** 광도 마스크가 의도한 구조를 " +
      "담았는지 확인하는 길이고, 이때는 조정 레이어도 받는다 — 픽셀은 없어도 " +
      "마스크는 있다. 마스크는 눈으로 구분되지 않는 경우가 많아 숫자가 필요하다. " +
      "문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: DocumentStatisticsParamsSchema,
    handler: async (input, context) =>
      engine.execute<DocumentStatisticsResult>(
        { type: DOCUMENT_STATISTICS, params: input },
        { requestId: context.requestId },
      ),
  };
}
