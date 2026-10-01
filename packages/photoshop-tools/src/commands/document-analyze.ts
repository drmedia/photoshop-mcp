import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { DocumentStatisticsParamsSchema } from "./document-statistics.js";

/**
 * 이미징 분석기. (ROADMAP §90)
 *
 * ## `document.statistics` 와 나눈 일
 *
 * ```text
 * statistics   전체 요약     채널 평균 · 백분위 · 채널별 클리핑 % · 전체 σ · 휘도 64구간
 * analyze      구조 · 위치   채널별 분포 · 톤 구간 · 클리핑이 어디에 있나 · 기울기 ·
 *                            노이즈의 밝기 의존 · 톤 구간별 색 쏠림
 * ```
 *
 * 대상(`region` · `layerId` · `target`)을 고르는 규칙은 `statistics` 의 스키마를 그대로 쓴다 —
 * 두 도구가 같은 곳을 재야 숫자가 견줘진다.
 *
 * ## 판정을 담지 않는다
 *
 * 숫자와 방향만 준다. "충분히 평탄하다" 같은 임계는 장르와 영역 크기에 따라 달라서 못 박으면 그
 * 순간부터 틀린 것을 자신 있게 말한다(MEASUREMENT.md §2).
 */

export const DOCUMENT_ANALYZE = "DOCUMENT_ANALYZE";

export const ANALYSIS_NAMES = ["histogram", "clipping", "gradient", "noise", "colorCast"] as const;

export const DocumentAnalyzeParamsSchema = DocumentStatisticsParamsSchema.extend({
  /**
   * 낼 분석. 생략하면 다섯 모두.
   *
   * 픽셀은 한 번만 읽지만 분석마다 한 번씩 훑으므로, 필요한 것만 고르면 그만큼 빠르다.
   */
  analyses: z
    .array(z.enum(ANALYSIS_NAMES))
    .min(1)
    .max(ANALYSIS_NAMES.length)
    .refine((names) => new Set(names).size === names.length, {
      message: "analyses 에 같은 분석이 두 번 들어 있습니다.",
    })
    .optional(),
  /**
   * 짧은 변을 몇 타일로 나눌지. 4–16, 기본 8.
   *
   * 긴 변은 비율에 맞춘다(세로 사진이면 8×12). 타일이 많을수록 위치가 정밀하지만 타일마다
   * 표본이 줄어 중앙값이 흔들린다.
   */
  grid: z.number().int().min(4).max(16).optional(),
}).strict();

export type DocumentAnalyzeParams = z.infer<typeof DocumentAnalyzeParamsSchema>;

// ── 결과 ──────────────────────────────────────────────────────────────

const Bounds = z.object({
  left: z.number(),
  top: z.number(),
  right: z.number(),
  bottom: z.number(),
});

const Percent64 = z.array(z.number()).length(64);

const HistogramSchema = z.object({
  bins: z.literal(64),
  red: Percent64,
  green: Percent64,
  blue: Percent64,
  luminance: Percent64,
  zones: z.object({ shadows: z.number(), midtones: z.number(), highlights: z.number() }),
  peak: z.object({ bin: z.number().int(), level: z.number(), percent: z.number() }),
  usedRange: z.object({
    low: z.number(),
    high: z.number(),
    span: z.number(),
    headroom: z.number(),
  }),
});

const ClipSideSchema = z.object({
  percent: z.number(),
  /** 덩어리를 세지 못했으면 null. */
  blobs: z
    .object({
      count: z.number().int(),
      largestPixels: z.number().int(),
      bySize: z.object({
        px1: z.number(),
        px2to9: z.number(),
        px10to99: z.number(),
        px100to999: z.number(),
        px1000plus: z.number(),
      }),
    })
    .nullable(),
  blownTiles: z.number().int(),
  bounds: Bounds.nullable(),
  tiles: z.array(z.array(z.number())),
});

const ClippingSchema = z.object({ high: ClipSideSchema, low: ClipSideSchema });

const PlaneSchema = z.object({
  meanLevel: z.number(),
  acrossX: z.number(),
  acrossY: z.number(),
  magnitude: z.number(),
  directionDegrees: z.number().nullable(),
  higherToward: z.string().nullable(),
  residualRms: z.number(),
});

const GradientSchema = z.object({
  usedTiles: z.number().int(),
  totalTiles: z.number().int(),
  luminance: PlaneSchema.nullable(),
  red: PlaneSchema.nullable(),
  green: PlaneSchema.nullable(),
  blue: PlaneSchema.nullable(),
  colorDrift: z.object({
    redMinusGreen: PlaneSchema.nullable(),
    blueMinusGreen: PlaneSchema.nullable(),
  }),
  vignette: z
    .object({ center: z.number(), corners: z.number(), centerMinusCorners: z.number() })
    .nullable(),
});

const ZoneNoiseSchema = z.object({ sigma: z.number().nullable(), pairsPercent: z.number() });

const NoiseSchema = z.object({
  luminance: z.number().nullable(),
  byZone: z.object({
    shadows: ZoneNoiseSchema,
    midtones: ZoneNoiseSchema,
    highlights: ZoneNoiseSchema,
  }),
  chroma: z.object({
    redMinusGreen: z.number().nullable(),
    blueMinusGreen: z.number().nullable(),
  }),
  flat: z.object({
    tiles: z.number().int(),
    usable: z.number().int(),
    sigmaMin: z.number().nullable(),
    sigmaP10: z.number().nullable(),
    sigmaMedian: z.number().nullable(),
    flattest: Bounds.extend({ sigma: z.number() }).nullable(),
  }),
});

const ZoneCastSchema = z.object({
  pixelsPercent: z.number(),
  median: z.object({ red: z.number(), green: z.number(), blue: z.number() }).nullable(),
  ratios: z.object({
    redOverGreen: z.number().nullable(),
    blueOverGreen: z.number().nullable(),
  }),
  lab: z.object({ L: z.number(), a: z.number(), b: z.number() }).nullable(),
  chroma: z.number().nullable(),
  hueDegrees: z.number().nullable(),
  direction: z.string().nullable(),
});

const ColorCastSchema = z.object({
  colorSpace: z.string(),
  zones: z.object({
    shadows: ZoneCastSchema,
    midtones: ZoneCastSchema,
    highlights: ZoneCastSchema,
    all: ZoneCastSchema,
  }),
});

export const DocumentAnalyzeResultSchema = z.object({
  /** 무엇을 쟀는지. `document` · `selection:l,t,r,b` · `layer:<id>` · `mask:<id>` */
  source: z.string(),
  /** 잰 영역의 크기(픽셀). 결과의 좌표는 이 영역의 왼쪽 위가 원점이다. */
  area: z.object({ width: z.number().int(), height: z.number().int() }),
  pixels: z.number().int(),
  bitDepth: z.number().int(),
  grid: z.object({ cols: z.number().int(), rows: z.number().int() }),
  histogram: HistogramSchema.optional(),
  clipping: ClippingSchema.optional(),
  gradient: GradientSchema.optional(),
  noise: NoiseSchema.optional(),
  colorCast: ColorCastSchema.optional(),
  method: z.string(),
  elapsedMs: z.number().int(),
});

export type DocumentAnalyzeResult = z.infer<typeof DocumentAnalyzeResultSchema>;

export const documentAnalyzeCommand: CommandHandler<
  DocumentAnalyzeParams,
  DocumentAnalyzeResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentAnalyzeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "분석 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }

  // 요청한 분석이 빠지지 않았는지 본다 — Camera Raw 의 `applied` 비교와 같은 이유다(ROADMAP §84).
  // 서버만 새 버전이면 옛 플러그인이 모르는 분석을 오류 없이 건너뛴다.
  const wanted = command.params.analyses ?? ANALYSIS_NAMES;
  const missing = wanted.filter((name) => parsed.data[name] === undefined);
  if (missing.length > 0) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `요청한 분석이 결과에 없습니다: ${missing.join(", ")}. ` +
        "서버와 Photoshop 플러그인의 버전이 같은지 확인하세요.",
      { details: { requested: wanted, missing } },
    );
  }
  return parsed.data;
};
