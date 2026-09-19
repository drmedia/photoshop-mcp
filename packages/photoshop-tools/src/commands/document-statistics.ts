import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 문서 통계. (ROADMAP §17.13)
 *
 * ## 왜 필요한가
 *
 * **보는 것만으로는 틀린 것을 통과시킨다.** 이 세션에서 두 번 그랬다 —
 * 하늘이 보라색이 된 것을 열 단계를 다 쌓은 뒤에야 발견했고, 초록으로 넘어간
 * 것은 미리보기를 보고 "좋다" 고 판단한 뒤 수치를 재고서야 잡았다.
 *
 * 어두운 영역의 색 편향, 미세한 캐스트, 작은 클리핑은 **봐서 잡히지 않는다.**
 * `document.capture` 가 "보는" 문제를 풀었다면 이것은 "재는" 문제를 푼다.
 * (RETOUCH_PROCESS §4.3)
 *
 * ## 미리보기를 재면 안 된다
 *
 * 그동안 내보낸 8비트 축소 JPEG 를 밖에서 쟀다. 축소하면 **단일 픽셀 클리핑이
 * 평균에 묻히고**, 8비트로 내리면서 값이 바뀌며, ICC 가 없어 색 판단도 흔들린다.
 * 전체 해상도 원본에서 재는 것이 이 Tool 의 존재 이유다.
 *
 * ## 값은 0–255 로 정규화해서 돌려준다
 *
 * 문서가 8비트든 16비트든 같은 눈금으로 읽어야 비교가 된다. 사진하는 사람이
 * 히스토그램을 읽는 눈금이기도 하다.
 *
 * **클리핑 판정만은 원래 심도에서 한다.** 16비트를 8비트로 내린 뒤 세면 32768 과
 * 32700 이 똑같이 255 가 되어 클리핑이 부풀려진다.
 */

export const DOCUMENT_STATISTICS = "DOCUMENT_STATISTICS";

export const DocumentStatisticsParamsSchema = z
  .object({
    /**
     * 잴 범위.
     *
     * - `document` (기본) — 문서 전체
     * - `selection` — 현재 선택 영역의 경계 상자. 선택이 없으면 실패한다
     */
    region: z.enum(["document", "selection"]).optional(),
    /**
     * 레이어 하나만 잰다. 생략하면 **합성 결과**(보이는 그대로)를 잰다.
     *
     * 합성이 기본인 이유: 보정 판단은 최종 결과를 보고 하는 것이고, 조정 레이어는
     * 자기 픽셀이 없어 혼자서는 잴 것이 없다.
     */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type DocumentStatisticsParams = z.infer<typeof DocumentStatisticsParamsSchema>;

const ChannelStatsSchema = z.object({
  /** 평균. 0–255 로 정규화한 값이다. */
  mean: z.number(),
  p1: z.number(),
  p5: z.number(),
  p50: z.number(),
  p95: z.number(),
  p99: z.number(),
  /** 최대값에 닿은 픽셀 비율(%). **원래 심도에서** 판정한다. */
  clippedHigh: z.number(),
  /** 0 에 닿은 픽셀 비율(%). */
  clippedLow: z.number(),
  /**
   * 노이즈 σ 추정(0–255 눈금). 잴 수 없으면 `null`.
   *
   * 가로 이웃 차의 **중앙값**에서 얻는다 — 가장자리와 별은 큰 차를 만들지만
   * 소수라서 중앙값을 움직이지 못한다. 평균을 쓰면 디테일이 노이즈로 읽힌다.
   *
   * 스트레치·그림자 올리기를 **얼마나** 할지 정하는 근거다. 이것이 없던 동안
   * 그 판단을 매번 눈으로 했다.
   */
  noise: z.number().nullable(),
});

export type ChannelStats = z.infer<typeof ChannelStatsSchema>;

export const DocumentStatisticsResultSchema = z.object({
  /** 무엇을 쟀는지. `document` · `selection:l,t,r,b` · `layer:<id>` */
  source: z.string(),
  /** 실제로 센 픽셀 수. */
  pixels: z.number().int(),
  /** 문서 심도. 16 이면 원본 값 범위는 0–32768 이다. */
  bitDepth: z.number().int(),
  channels: z.object({
    red: ChannelStatsSchema,
    green: ChannelStatsSchema,
    blue: ChannelStatsSchema,
    /** Rec.709 가중 휘도. */
    luminance: ChannelStatsSchema,
  }),
  /** 휘도 분포. 64구간, 각 구간의 **비율(%)** 이다. */
  histogram: z.array(z.number()).length(64),
  /** 어떻게 쟀는지와 걸린 시간. 느리면 호출자가 범위를 좁힐 수 있어야 한다. */
  method: z.string(),
  elapsedMs: z.number().int(),
});

export type DocumentStatisticsResult = z.infer<typeof DocumentStatisticsResultSchema>;

export const documentStatisticsCommand: CommandHandler<
  DocumentStatisticsParams,
  DocumentStatisticsResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentStatisticsResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "통계 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
