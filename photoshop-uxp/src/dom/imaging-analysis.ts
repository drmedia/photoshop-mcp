/**
 * 이미징 분석기. (ROADMAP §90)
 *
 * **`photoshop` 을 import 하지 않는다.** 픽셀 버퍼만 받는 순수 계산이라 합성 이미지로 실기 없이
 * 테스트한다(`camera-raw-keys.ts` · `active-order.ts` 와 같은 이유).
 *
 * ## `document.statistics` 와 나눈 일
 *
 * ```text
 * statistics   전체 요약     채널 평균 · 백분위 · 채널별 클리핑 % · 전체 σ · 휘도 64구간
 * analyze      구조 · 위치   채널별 분포 · 톤 구간 · 클리핑이 어디에 있나 · 기울기 · 노이즈의 밝기 의존
 *                            · 톤 구간별 색 쏠림
 * ```
 *
 * 겹치는 숫자를 두 곳에서 따로 계산하면 어긋난다. 그래서 전체 평균·백분위는 여기서 다시 내지
 * 않는다 — 쓰이는 곳에서 필요한 것만 구간(톤 구간·타일)별로 낸다.
 *
 * ## 판정을 담지 않는다
 *
 * "충분히 평탄하다" · "쏠림이 심하다" 같은 말은 없다. 숫자와 방향만 낸다. 임계가 장르와 영역
 * 크기에 따라 달라지는데 못 박으면 그 순간부터 틀린 것을 자신 있게 말한다(MEASUREMENT.md §2).
 *
 * ## 공간 분포는 공간에서 잰다
 *
 * 백분위 차이로 공간 분포를 재려다 틀린 적이 있다(MEASUREMENT.md §6.4). 기울기는 **영역을 격자로
 * 나눠 타일마다 중앙값을 재고** 그 값들에 평면을 맞춘다.
 *
 * ## 정밀도
 *
 * 분포는 1024구간으로 모은다(0–255 눈금의 0.25 단위). 중앙값은 그 구간 위에서 구하므로
 * `document.statistics` 의 백분위와 0.25 이내로 다를 수 있다.
 */

export type AnalysisName = "histogram" | "clipping" | "gradient" | "noise" | "colorCast";

export const ALL_ANALYSES: readonly AnalysisName[] = [
  "histogram",
  "clipping",
  "gradient",
  "noise",
  "colorCast",
];

export interface AnalysisInput {
  /** 청키(RGBRGB…) 버퍼. */
  data: { length: number; [index: number]: number };
  width: number;
  /** 폭을 알면 `floor(픽셀 수 / 폭)` 이다. */
  height: number;
  components: number;
  /** 원래 심도에서의 최대값. 16비트는 **32768** 이다. */
  maxValue: number;
}

export interface AnalysisOptions {
  analyses: readonly AnalysisName[];
  /** 짧은 변을 몇 타일로 나눌지. */
  grid: number;
}

export interface Grid {
  cols: number;
  rows: number;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// ── 결과 형식 ─────────────────────────────────────────────────────────

export interface HistogramResult {
  bins: 64;
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
  /** 휘도 0–63 · 64–191 · 192–255 (0–255 눈금)에 든 픽셀 비율(%). */
  zones: { shadows: number; midtones: number; highlights: number };
  peak: { bin: number; level: number; percent: number };
  /** 휘도의 0.1% – 99.9% 구간. */
  usedRange: { low: number; high: number; span: number; headroom: number };
}

export interface ClipSide {
  /** 이 쪽으로 클리핑된(어느 한 채널이라도) 픽셀의 전체 대비 비율(%). */
  percent: number;
  /**
   * 4방향으로 이어진 덩어리. **크기별로 클리핑된 픽셀 중 몇 %가 속하는지**를 낸다 — 별은 2–99px 에,
   * 날아간 하늘은 1000px 이상에 몰린다. 덩어리가 너무 많아 세지 못했으면 null.
   */
  blobs: {
    count: number;
    largestPixels: number;
    bySize: {
      px1: number;
      px2to9: number;
      px10to99: number;
      px100to999: number;
      px1000plus: number;
    };
  } | null;
  /** 타일의 절반 이상이 클리핑된 타일 수. */
  blownTiles: number;
  /** 클리핑된 픽셀의 경계 상자. 측정 영역 기준 좌표. 없으면 null. */
  bounds: Bounds | null;
  /** 타일마다 클리핑 비율(%). `rows` × `cols`. */
  tiles: number[][];
}

export interface ClippingResult {
  high: ClipSide;
  low: ClipSide;
}

export interface Plane {
  /** 타일 값의 평균. */
  meanLevel: number;
  /** 가로로 왼쪽 끝에서 오른쪽 끝까지 변하는 양(0–255 눈금). 양수면 오른쪽이 높다. */
  acrossX: number;
  /** 세로로 위에서 아래까지 변하는 양. 양수면 아래가 높다. */
  acrossY: number;
  magnitude: number;
  /** 값이 커지는 쪽의 각도. 0=오른쪽 · 90=아래 · 180=왼쪽 · 270=위. 기울기가 0 이면 null. */
  directionDegrees: number | null;
  /** 위 각도의 여덟 방향 이름. */
  higherToward: string | null;
  /** 평면을 빼고 남은 타일 편차의 RMS. 이것이 크면 평면이 아니다. */
  residualRms: number;
}

export interface GradientResult {
  usedTiles: number;
  totalTiles: number;
  luminance: Plane | null;
  red: Plane | null;
  green: Plane | null;
  blue: Plane | null;
  /** 색 차이의 기울기 — 광해의 색 그라디언트가 여기 나온다. */
  colorDrift: { redMinusGreen: Plane | null; blueMinusGreen: Plane | null };
  /** 중앙 타일들의 휘도 중앙값과 네 모서리 타일의 평균. */
  vignette: { center: number; corners: number; centerMinusCorners: number } | null;
}

export interface ZoneNoise {
  sigma: number | null;
  /** 이웃 쌍 중 이 구간에 든 비율(%) — 이 σ 가 얼마나 대표성이 있는지. */
  pairsPercent: number;
}

export interface NoiseResult {
  luminance: number | null;
  byZone: { shadows: ZoneNoise; midtones: ZoneNoise; highlights: ZoneNoise };
  /** 색 차이(R−G, B−G)의 이웃 차 σ. 채널 잡음이 독립이면 휘도 σ 의 √2 배 근처다. */
  chroma: { redMinusGreen: number | null; blueMinusGreen: number | null };
  flat: {
    tiles: number;
    usable: number;
    sigmaMin: number | null;
    sigmaP10: number | null;
    sigmaMedian: number | null;
    /** σ 가 가장 낮은 타일. 측정 영역 기준 좌표. 노이즈를 재기 좋은 자리다. */
    flattest: (Bounds & { sigma: number }) | null;
  };
}

export interface ZoneCast {
  pixelsPercent: number;
  median: { red: number; green: number; blue: number } | null;
  ratios: { redOverGreen: number | null; blueOverGreen: number | null };
  lab: { L: number; a: number; b: number } | null;
  chroma: number | null;
  hueDegrees: number | null;
  /** 색상 각도의 여덟 방향 이름. 채도가 0 이면 null. */
  direction: string | null;
}

export interface ColorCastResult {
  /** Lab 변환이 가정하는 색 공간. 문서 프로파일은 적용하지 않는다. */
  colorSpace: string;
  zones: { shadows: ZoneCast; midtones: ZoneCast; highlights: ZoneCast; all: ZoneCast };
}

export interface AnalysisResult {
  grid: Grid;
  histogram?: HistogramResult;
  clipping?: ClippingResult;
  gradient?: GradientResult;
  noise?: NoiseResult;
  colorCast?: ColorCastResult;
}

// ── 공통 ──────────────────────────────────────────────────────────────

/** 분포를 모으는 구간 수. 0–255 눈금의 0.25 단위다. */
const Q = 1024;
const MAX_TILES_LONG_SIDE = 32;

/** 반올림. `-1e-14` 가 `-0` 이 되지 않게 0 으로 접는다 — 부호 붙은 0 은 값이 아니라 잡음이다. */
const round = (value: number, digits: number): number => {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
};

/** 짧은 변을 `grid` 개로 나누고 긴 변은 비율에 맞춘다. */
export function gridFor(width: number, height: number, grid: number): Grid {
  const short = Math.max(1, Math.min(width, height));
  const long = Math.max(width, height);
  const small = Math.max(1, Math.min(grid, short));
  const large = Math.max(1, Math.min(MAX_TILES_LONG_SIDE, Math.round((small * long) / short)));
  return width <= height ? { cols: small, rows: large } : { cols: large, rows: small };
}

function requireGeometry(input: AnalysisInput, what: string): void {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error(`가로 폭을 알 수 없어 ${what} 을(를) 잴 수 없다.`);
  }
}

/**
 * 원래 값 → 1024구간 번호. **내림**이다.
 *
 * `document.statistics` 는 64구간을 `floor(value / ((maxValue + 1) / 64))` 로 나눈다. 1024구간을 16개씩
 * 접으면 같은 경계가 되도록 여기도 내림으로 맞춘다. 처음에는 반올림(`round(value·1023/max)`)이었는데
 * 경계가 반 칸 밀려 같은 사진의 64구간이 `statistics` 와 0.1%p 씩 어긋났다(실기 대조에서 드러났다).
 */
function quantTable(maxValue: number): Uint16Array {
  const table = new Uint16Array(maxValue + 1);
  for (let value = 0; value <= maxValue; value += 1) {
    table[value] = Math.min(Q - 1, Math.floor((value * Q) / (maxValue + 1)));
  }
  return table;
}

/** 휘도(원래 값) → 톤 구간. 0=어두움 · 1=중간 · 2=밝음. 경계는 0–255 눈금의 64 · 192 다. */
function zoneTable(maxValue: number): Uint8Array {
  const table = new Uint8Array(maxValue + 1);
  for (let value = 0; value <= maxValue; value += 1) {
    const level = (value * 255) / maxValue;
    table[value] = level < 64 ? 0 : level < 192 ? 1 : 2;
  }
  return table;
}

/**
 * 구간 번호 → 0–255 눈금. **그 구간에 들어 있는 정수 값들의 가운데**다.
 *
 * 8비트는 구간(0.25 단위)마다 정수가 하나뿐이거나 없어서 값이 정확히 나온다(128 → 128.0).
 * 16비트는 구간에 32개가 들어 있어 가운데(+15.5)를 쓴다 — 구간의 아래 끝을 쓰면 연속적인
 * 자료에서 평균 0.12 단계 낮게 나온다.
 */
const binToLevel = (bin: number, maxValue: number): number => {
  const span = (maxValue + 1) / Q;
  const lo = Math.ceil(bin * span);
  const hi = Math.ceil((bin + 1) * span) - 1;
  return (((lo + hi) / 2) * 255) / maxValue;
};

/** 구간 번호로 낸 분위수. 표본이 없으면 -1. */
function quantileBin(
  hist: ArrayLike<number>,
  offset: number,
  total: number,
  fraction: number,
): number {
  if (total <= 0) {
    return -1;
  }
  const target = fraction * total;
  let cumulative = 0;
  for (let bin = 0; bin < Q; bin += 1) {
    cumulative += hist[offset + bin] as number;
    if (cumulative > 0 && cumulative >= target) {
      return bin;
    }
  }
  return Q - 1;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

const DIRECTIONS = [
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left",
  "top-left",
  "top",
  "top-right",
] as const;

/** 0°=오른쪽, 시계 방향(화면 좌표라 아래가 90°). */
function directionName(degrees: number): string {
  return DIRECTIONS[Math.round(degrees / 45) % 8] as string;
}

// ── 히스토그램 · 색 쏠림 (한 번에 센다) ───────────────────────────────

interface ColorPass {
  histogram: HistogramResult;
  colorCast: ColorCastResult | null;
}

function foldTo64(hist: Uint32Array, total: number): number[] {
  const out = new Array<number>(64).fill(0);
  for (let bin = 0; bin < Q; bin += 1) {
    out[bin >> 4] = (out[bin >> 4] as number) + (hist[bin] as number);
  }
  return out.map((count) => round((100 * count) / total, 3));
}

/** sRGB(0–255) → Lab (D65). 문서 프로파일은 모른다 — 근사다. */
export function srgbToLab(
  red: number,
  green: number,
  blue: number,
): { L: number; a: number; b: number } {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(red);
  const g = linear(green);
  const bl = linear(blue);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * bl) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * bl;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * bl) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function zoneCast(
  hist: Uint32Array,
  offsets: [number, number, number],
  total: number,
  allPixels: number,
  maxValue: number,
): ZoneCast {
  const pixelsPercent = allPixels === 0 ? 0 : round((100 * total) / allPixels, 3);
  if (total === 0) {
    return {
      pixelsPercent,
      median: null,
      ratios: { redOverGreen: null, blueOverGreen: null },
      lab: null,
      chroma: null,
      hueDegrees: null,
      direction: null,
    };
  }
  const level = (offset: number): number =>
    binToLevel(quantileBin(hist, offset, total, 0.5), maxValue);
  const red = level(offsets[0]);
  const green = level(offsets[1]);
  const blue = level(offsets[2]);
  const lab = srgbToLab(red, green, blue);
  const chroma = Math.hypot(lab.a, lab.b);
  // 채도가 0 이면 색상 각도는 정의되지 않는다 — 0° 로 지어내지 않는다.
  const hue = chroma < 0.005 ? null : ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
  return {
    pixelsPercent,
    median: { red: round(red, 2), green: round(green, 2), blue: round(blue, 2) },
    ratios: {
      redOverGreen: green > 0 ? round(red / green, 4) : null,
      blueOverGreen: green > 0 ? round(blue / green, 4) : null,
    },
    lab: { L: round(lab.L, 2), a: round(lab.a, 2), b: round(lab.b, 2) },
    chroma: round(chroma, 2),
    hueDegrees: hue === null ? null : round(hue, 1),
    // Lab 의 +a 는 붉은/자홍 쪽, −a 는 초록, +b 는 노랑, −b 는 파랑이다.
    direction: hue === null ? null : (COLOR_DIRECTIONS[Math.round(hue / 45) % 8] as string),
  };
}

const COLOR_DIRECTIONS = [
  "red-magenta",
  "orange",
  "yellow",
  "yellow-green",
  "green",
  "cyan",
  "blue",
  "purple",
] as const;

export function colorPass(input: AnalysisInput, wantCast: boolean): ColorPass {
  const { data, components, maxValue } = input;
  const pixels = Math.floor(data.length / components);
  const quant = quantTable(maxValue);
  const zones = zoneTable(maxValue);

  const histR = new Uint32Array(Q);
  const histG = new Uint32Array(Q);
  const histB = new Uint32Array(Q);
  const histL = new Uint32Array(Q);
  const zoneCount = new Uint32Array(3);
  // 톤 구간 × 채널 별 분포: [(구간 * 3 + 채널) * Q + 구간번호]
  const zoneHist = wantCast ? new Uint32Array(9 * Q) : null;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const at = pixel * components;
    const r = clamp(data[at] as number, maxValue);
    const g = clamp(data[at + 1] as number, maxValue);
    const b = clamp(data[at + 2] as number, maxValue);
    const l = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), maxValue);
    const qr = quant[r] as number;
    const qg = quant[g] as number;
    const qb = quant[b] as number;
    histR[qr] = (histR[qr] as number) + 1;
    histG[qg] = (histG[qg] as number) + 1;
    histB[qb] = (histB[qb] as number) + 1;
    const ql = quant[l] as number;
    histL[ql] = (histL[ql] as number) + 1;
    const zone = zones[l] as number;
    zoneCount[zone] = (zoneCount[zone] as number) + 1;
    if (zoneHist !== null) {
      const base = zone * 3 * Q;
      zoneHist[base + qr] = (zoneHist[base + qr] as number) + 1;
      zoneHist[base + Q + qg] = (zoneHist[base + Q + qg] as number) + 1;
      zoneHist[base + 2 * Q + qb] = (zoneHist[base + 2 * Q + qb] as number) + 1;
    }
  }

  const total = Math.max(1, pixels);
  const peakBins = foldTo64(histL, total);
  let peakBin = 0;
  for (let bin = 1; bin < 64; bin += 1) {
    if ((peakBins[bin] as number) > (peakBins[peakBin] as number)) {
      peakBin = bin;
    }
  }
  const low = binToLevel(Math.max(0, quantileBin(histL, 0, pixels, 0.001)), maxValue);
  const high = binToLevel(Math.max(0, quantileBin(histL, 0, pixels, 0.999)), maxValue);

  const histogram: HistogramResult = {
    bins: 64,
    red: foldTo64(histR, total),
    green: foldTo64(histG, total),
    blue: foldTo64(histB, total),
    luminance: peakBins,
    zones: {
      shadows: round((100 * (zoneCount[0] as number)) / total, 3),
      midtones: round((100 * (zoneCount[1] as number)) / total, 3),
      highlights: round((100 * (zoneCount[2] as number)) / total, 3),
    },
    peak: {
      bin: peakBin,
      // 64구간 중 이 구간의 가운데 값(0–255 눈금).
      level: round(((peakBin + 0.5) * 255) / 64, 1),
      percent: peakBins[peakBin] as number,
    },
    usedRange: {
      low: round(low, 1),
      high: round(high, 1),
      span: round(high - low, 1),
      headroom: round(255 - high, 1),
    },
  };

  let colorCast: ColorCastResult | null = null;
  if (zoneHist !== null) {
    const allHist = new Uint32Array(3 * Q);
    allHist.set(histR, 0);
    allHist.set(histG, Q);
    allHist.set(histB, 2 * Q);
    const zoneAt = (zone: number): ZoneCast =>
      zoneCast(
        zoneHist,
        [zone * 3 * Q, zone * 3 * Q + Q, zone * 3 * Q + 2 * Q],
        zoneCount[zone] as number,
        pixels,
        maxValue,
      );
    colorCast = {
      colorSpace: "sRGB 가정 (문서 프로파일은 적용하지 않는다)",
      zones: {
        shadows: zoneAt(0),
        midtones: zoneAt(1),
        highlights: zoneAt(2),
        all: zoneCast(allHist, [0, Q, 2 * Q], pixels, pixels, maxValue),
      },
    };
  }
  return { histogram, colorCast };
}

function clamp(value: number, maxValue: number): number {
  return value > maxValue ? maxValue : value < 0 ? 0 : value;
}

// ── 기울기 ────────────────────────────────────────────────────────────

/** 정규방정식으로 평면 `y = c + gx·u + gy·v` 를 맞춘다. 퇴화하면 null. */
function fitPlane(
  u: number[],
  v: number[],
  y: number[],
  use: number[],
): { c: number; gx: number; gy: number } | null {
  let n = 0;
  let su = 0;
  let sv = 0;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let sy = 0;
  let suy = 0;
  let svy = 0;
  for (const i of use) {
    const ui = u[i] as number;
    const vi = v[i] as number;
    const yi = y[i] as number;
    n += 1;
    su += ui;
    sv += vi;
    suu += ui * ui;
    suv += ui * vi;
    svv += vi * vi;
    sy += yi;
    suy += ui * yi;
    svy += vi * yi;
  }
  if (n < 3) {
    return null;
  }
  // | n  su  sv | |c |   | sy  |
  // | su suu suv | |gx| = | suy |
  // | sv suv svv | |gy|   | svy |
  const det = n * (suu * svv - suv * suv) - su * (su * svv - suv * sv) + sv * (su * suv - suu * sv);
  if (Math.abs(det) < 1e-12) {
    return null;
  }
  const detC =
    sy * (suu * svv - suv * suv) - su * (suy * svv - suv * svy) + sv * (suy * suv - suu * svy);
  const detX =
    n * (suy * svv - suv * svy) - sy * (su * svv - suv * sv) + sv * (su * svy - suy * sv);
  const detY =
    n * (suu * svy - suy * suv) - su * (su * svy - suy * sv) + sy * (su * suv - suu * sv);
  return { c: detC / det, gx: detX / det, gy: detY / det };
}

/**
 * 평면에서 벗어난 타일(전경 · 은하수)을 걸러 **하늘의 기울기**만 남긴다.
 *
 * 최소제곱은 쓰지 못한다. 이상 타일이 전체의 4분의 1이고 가장자리에 몰려 있으면 평면이 그쪽으로
 * 끌려가 잔차가 고르게 퍼지고, 그러면 `MAD` 로 잡은 한계도 같이 커져 **아무것도 못 거른다**
 * (처음 그렇게 틀렸다 — 아래 25% 가 전경인 이미지에서 64개 타일이 모두 남았다).
 *
 * 그래서 **최소 중앙값 제곱(LMedS)** 으로 시작한다. 타일 셋으로 평면을 만들어 보고 잔차 제곱의
 * 중앙값이 가장 작은 것을 고른다 — 절반까지 이상값이어도 버틴다. 난수는 시드를 고정해
 * 같은 입력이 같은 결과를 내게 한다.
 */
function robustInliers(u: number[], v: number[], y: number[], candidates: number[]): number[] {
  const n = candidates.length;
  // 표본이 너무 적으면 걸러낼 근거가 없다.
  if (n < 8) {
    return candidates;
  }
  let state = 0x2545f491;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const residualsOf = (fit: { c: number; gx: number; gy: number }): number[] =>
    candidates.map(
      (tile) =>
        (y[tile] as number) - (fit.c + fit.gx * (u[tile] as number) + fit.gy * (v[tile] as number)),
    );

  let bestScore = Number.POSITIVE_INFINITY;
  let bestFit: { c: number; gx: number; gy: number } | null = null;
  const trials = Math.min(400, n * 6);
  for (let trial = 0; trial < trials; trial += 1) {
    const picked = new Set<number>();
    while (picked.size < 3) {
      picked.add(candidates[Math.floor(next() * n)] as number);
    }
    const fit = fitPlane(u, v, y, [...picked]);
    if (fit === null) {
      continue;
    }
    const score = median(residualsOf(fit).map((r) => r * r));
    if (score < bestScore) {
      bestScore = score;
      bestFit = fit;
    }
  }
  if (bestFit === null) {
    return candidates;
  }

  // 자유도 보정이 들어간 강건한 σ. 구간이 0.25 단위라 그보다 작은 편차는 양자화다.
  const sigma = 1.4826 * (1 + 5 / (n - 3)) * Math.sqrt(bestScore);
  const limit = Math.max(2.5 * sigma, 0.25);
  const residual = residualsOf(bestFit);
  let kept = candidates.filter((_, index) => Math.abs(residual[index] as number) <= limit);
  // 너무 많이 버리면 평면이 아니라 구조이므로 걸러내지 않고 그대로 둔다.
  if (kept.length < Math.max(3, Math.ceil(n * 0.4))) {
    return candidates;
  }

  // 남은 타일로 다시 맞추고 한 번 더 걸러 경계의 타일을 정리한다.
  const refit = fitPlane(u, v, y, kept);
  if (refit !== null) {
    const again = kept.map(
      (tile) =>
        (y[tile] as number) -
        (refit.c + refit.gx * (u[tile] as number) + refit.gy * (v[tile] as number)),
    );
    const centre = median(again);
    const spread = 1.4826 * median(again.map((r) => Math.abs(r - centre)));
    const second = kept.filter(
      (_, index) => Math.abs((again[index] as number) - centre) <= Math.max(2.5 * spread, 0.25),
    );
    if (second.length >= Math.max(3, Math.ceil(n * 0.4))) {
      kept = second;
    }
  }
  return kept;
}

function describePlane(u: number[], v: number[], y: number[], use: number[]): Plane | null {
  const fit = fitPlane(u, v, y, use);
  if (fit === null) {
    return null;
  }
  let sum = 0;
  let squares = 0;
  for (const i of use) {
    sum += y[i] as number;
    const residual =
      (y[i] as number) - (fit.c + fit.gx * (u[i] as number) + fit.gy * (v[i] as number));
    squares += residual * residual;
  }
  const magnitude = Math.hypot(fit.gx, fit.gy);
  // 사실상 0 이면 방향을 지어내지 않는다.
  const flat = magnitude < 1e-6;
  const degrees = flat ? null : ((Math.atan2(fit.gy, fit.gx) * 180) / Math.PI + 360) % 360;
  return {
    meanLevel: round(sum / use.length, 2),
    acrossX: round(fit.gx, 2),
    acrossY: round(fit.gy, 2),
    magnitude: round(magnitude, 2),
    directionDegrees: degrees === null ? null : round(degrees, 1),
    higherToward: degrees === null ? null : directionName(degrees),
    residualRms: round(Math.sqrt(squares / use.length), 2),
  };
}

/**
 * 타일마다 R · G · B · 휘도의 **중앙값**(0–255 눈금). 표본이 없는 타일은 NaN.
 *
 * 평균이 아니라 중앙값인 것이 요점이다 — 별은 소수라 중앙값을 못 움직인다.
 * `gradient` 와 `document.compare` 가 같이 쓴다. 두 곳이 따로 계산하면 같은 영역이 다른 값을 낸다.
 */
export function tileMedians(
  input: AnalysisInput,
  grid: Grid,
): { red: number[]; green: number[]; blue: number[]; luminance: number[] } {
  requireGeometry(input, "타일 중앙값");
  const { data, width, height, components, maxValue } = input;
  const { cols, rows } = grid;
  const tiles = cols * rows;
  const quant = quantTable(maxValue);

  const tileX = new Uint16Array(width);
  for (let x = 0; x < width; x += 1) {
    tileX[x] = Math.min(cols - 1, Math.floor((x * cols) / width));
  }
  const hist = [0, 1, 2, 3].map(() => new Uint32Array(tiles * Q));
  const count = new Uint32Array(tiles);

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.min(rows - 1, Math.floor((y * rows) / height)) * cols;
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      const at = (rowStart + x) * components;
      const r = clamp(data[at] as number, maxValue);
      const g = clamp(data[at + 1] as number, maxValue);
      const b = clamp(data[at + 2] as number, maxValue);
      const l = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), maxValue);
      const tile = rowBase + (tileX[x] as number);
      const base = tile * Q;
      const hr = hist[0] as Uint32Array;
      const hg = hist[1] as Uint32Array;
      const hb = hist[2] as Uint32Array;
      const hl = hist[3] as Uint32Array;
      const ir = base + (quant[r] as number);
      const ig = base + (quant[g] as number);
      const ib = base + (quant[b] as number);
      const il = base + (quant[l] as number);
      hr[ir] = (hr[ir] as number) + 1;
      hg[ig] = (hg[ig] as number) + 1;
      hb[ib] = (hb[ib] as number) + 1;
      hl[il] = (hl[il] as number) + 1;
      count[tile] = (count[tile] as number) + 1;
    }
  }

  // 타일마다 중앙값. 평균이 아니라 중앙값인 것이 요점이다 — 별은 소수라 중앙값을 못 움직인다.
  const value = [0, 1, 2, 3].map((channel) => {
    const out = new Array<number>(tiles).fill(Number.NaN);
    for (let tile = 0; tile < tiles; tile += 1) {
      const bin = quantileBin(hist[channel] as Uint32Array, tile * Q, count[tile] as number, 0.5);
      out[tile] = bin < 0 ? Number.NaN : binToLevel(bin, maxValue);
    }
    return out;
  });
  const [red, green, blue, luminance] = value as [number[], number[], number[], number[]];
  return { red, green, blue, luminance };
}

export function gradientAnalysis(input: AnalysisInput, grid: Grid): GradientResult {
  requireGeometry(input, "기울기");
  const { cols, rows } = grid;
  const tiles = cols * rows;
  const { red: valR, green: valG, blue: valB, luminance: valL } = tileMedians(input, grid);

  const u = new Array<number>(tiles);
  const v = new Array<number>(tiles);
  for (let tile = 0; tile < tiles; tile += 1) {
    u[tile] = ((tile % cols) + 0.5) / cols - 0.5;
    v[tile] = (Math.floor(tile / cols) + 0.5) / rows - 0.5;
  }

  // 휘도로 이상 타일(지평선 아래 전경 · 은하수 중심)을 걸러낸다. 같은 타일 집합을 모든
  // 채널에 쓴다 — 채널마다 다른 영역을 재면 서로 견줄 수 없다.
  const use = robustInliers(
    u,
    v,
    valL,
    [...u.keys()].filter((tile) => !Number.isNaN(valL[tile] as number)),
  );

  const diff = (a: number[], b: number[]): number[] =>
    a.map((x, index) => x - (b[index] as number));

  // 중앙 타일(가운데 40%)과 네 모서리.
  const centreTiles = [...u.keys()].filter(
    (tile) =>
      Math.abs(u[tile] as number) <= 0.2 &&
      Math.abs(v[tile] as number) <= 0.2 &&
      !Number.isNaN(valL[tile] as number),
  );
  const cornerTiles = [0, cols - 1, tiles - cols, tiles - 1].filter(
    (tile) => !Number.isNaN(valL[tile] as number),
  );
  let vignette: GradientResult["vignette"] = null;
  if (centreTiles.length > 0 && cornerTiles.length === 4) {
    const centre = median(centreTiles.map((tile) => valL[tile] as number));
    const corners =
      cornerTiles.reduce((sum, tile) => sum + (valL[tile] as number), 0) / cornerTiles.length;
    vignette = {
      center: round(centre, 2),
      corners: round(corners, 2),
      centerMinusCorners: round(centre - corners, 2),
    };
  }

  return {
    usedTiles: use.length,
    totalTiles: tiles,
    luminance: describePlane(u, v, valL, use),
    red: describePlane(u, v, valR, use),
    green: describePlane(u, v, valG, use),
    blue: describePlane(u, v, valB, use),
    colorDrift: {
      redMinusGreen: describePlane(u, v, diff(valR, valG), use),
      blueMinusGreen: describePlane(u, v, diff(valB, valG), use),
    },
    vignette,
  };
}

// ── 노이즈 ────────────────────────────────────────────────────────────

/** 이웃 차 분포의 중앙값에서 σ 를 낸다. `document.statistics` 와 같은 식이다(÷0.954). */
function sigmaFromDiffs(
  hist: ArrayLike<number>,
  offset: number,
  size: number,
  total: number,
  perBin: number,
): number | null {
  if (total === 0) {
    return null;
  }
  const half = total / 2;
  let cumulative = 0;
  for (let bin = 0; bin < size; bin += 1) {
    cumulative += hist[offset + bin] as number;
    if (cumulative >= half) {
      return round((bin * perBin) / 0.954, 3);
    }
  }
  return null;
}

export function noiseAnalysis(input: AnalysisInput, grid: Grid): NoiseResult {
  requireGeometry(input, "노이즈");
  const { data, width, height, components, maxValue } = input;
  const { cols, rows } = grid;
  const tiles = cols * rows;
  const zones = zoneTable(maxValue);
  const scale = 255 / maxValue;

  // 휘도 이웃 차: 톤 구간마다 원래 해상도 분포(statistics 와 같은 정밀도).
  const zoneDiff = [0, 1, 2].map(() => new Uint32Array(maxValue + 1));
  const zonePairs = new Uint32Array(3);
  // 색 차이의 이웃 차.
  const chromaRG = new Uint32Array(maxValue + 1);
  const chromaBG = new Uint32Array(maxValue + 1);
  // 타일별 휘도 이웃 차: 평탄한 곳만 보면 되므로 0 – 최대값/16 을 1024구간으로 거칠게 모은다.
  const tileRange = maxValue / 16;
  const tileScale = (Q - 1) / tileRange;
  const tileDiff = new Uint32Array(tiles * Q);
  const tilePairs = new Uint32Array(tiles);
  const tilePixels = new Uint32Array(tiles);
  const tileClipped = new Uint32Array(tiles);

  const tileX = new Uint16Array(width);
  for (let x = 0; x < width; x += 1) {
    tileX[x] = Math.min(cols - 1, Math.floor((x * cols) / width));
  }
  let pairs = 0;

  for (let y = 0; y < height; y += 1) {
    const rowBase = Math.min(rows - 1, Math.floor((y * rows) / height)) * cols;
    const rowStart = y * width;
    let pl = 0;
    let prg = 0;
    let pbg = 0;
    for (let x = 0; x < width; x += 1) {
      const at = (rowStart + x) * components;
      const r = clamp(data[at] as number, maxValue);
      const g = clamp(data[at + 1] as number, maxValue);
      const b = clamp(data[at + 2] as number, maxValue);
      const l = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), maxValue);
      const rg = r - g;
      const bg = b - g;
      const tile = rowBase + (tileX[x] as number);
      tilePixels[tile] = (tilePixels[tile] as number) + 1;
      if (l === 0 || l === maxValue) {
        tileClipped[tile] = (tileClipped[tile] as number) + 1;
      }
      if (x > 0) {
        const dl = l > pl ? l - pl : pl - l;
        const zone = zones[(l + pl) >> 1] as number;
        const zd = zoneDiff[zone] as Uint32Array;
        zd[dl] = (zd[dl] as number) + 1;
        zonePairs[zone] = (zonePairs[zone] as number) + 1;
        const drg = Math.min(maxValue, Math.abs(rg - prg));
        const dbg = Math.min(maxValue, Math.abs(bg - pbg));
        chromaRG[drg] = (chromaRG[drg] as number) + 1;
        chromaBG[dbg] = (chromaBG[dbg] as number) + 1;
        const tb = tile * Q + Math.min(Q - 1, Math.floor(dl * tileScale));
        tileDiff[tb] = (tileDiff[tb] as number) + 1;
        tilePairs[tile] = (tilePairs[tile] as number) + 1;
        pairs += 1;
      }
      pl = l;
      prg = rg;
      pbg = bg;
    }
  }

  const allDiff = new Uint32Array(maxValue + 1);
  for (const zd of zoneDiff) {
    for (let value = 0; value <= maxValue; value += 1) {
      allDiff[value] = (allDiff[value] as number) + (zd[value] as number);
    }
  }
  const zoneNoise = (zone: number): ZoneNoise => ({
    sigma: sigmaFromDiffs(
      zoneDiff[zone] as Uint32Array,
      0,
      maxValue + 1,
      zonePairs[zone] as number,
      scale,
    ),
    pairsPercent: pairs === 0 ? 0 : round((100 * (zonePairs[zone] as number)) / pairs, 2),
  });

  // 평탄한 타일. 순수한 검정 · 흰색 타일은 이웃 차가 0 이라 σ=0 이 나오지만 평탄한 것이
  // 아니라 정보가 없는 것이다 — 클리핑이 많은 타일은 뺀다.
  const perBin = 1 / tileScale;
  const usable: { tile: number; sigma: number }[] = [];
  for (let tile = 0; tile < tiles; tile += 1) {
    const pixels = tilePixels[tile] as number;
    if (pixels === 0 || (tileClipped[tile] as number) / pixels > 0.25) {
      continue;
    }
    const sigma = sigmaFromDiffs(tileDiff, tile * Q, Q, tilePairs[tile] as number, perBin * scale);
    if (sigma !== null) {
      usable.push({ tile, sigma });
    }
  }
  usable.sort((a, b) => a.sigma - b.sigma);
  const quantile = (fraction: number): number | null =>
    usable.length === 0
      ? null
      : (
          usable[Math.min(usable.length - 1, Math.floor(fraction * usable.length))] as {
            sigma: number;
          }
        ).sigma;
  let flattest: NoiseResult["flat"]["flattest"] = null;
  if (usable.length > 0) {
    const best = usable[0] as { tile: number; sigma: number };
    const col = best.tile % cols;
    const row = Math.floor(best.tile / cols);
    flattest = {
      left: Math.floor((col * width) / cols),
      top: Math.floor((row * height) / rows),
      right: Math.floor(((col + 1) * width) / cols),
      bottom: Math.floor(((row + 1) * height) / rows),
      sigma: best.sigma,
    };
  }

  return {
    luminance: sigmaFromDiffs(allDiff, 0, maxValue + 1, pairs, scale),
    byZone: { shadows: zoneNoise(0), midtones: zoneNoise(1), highlights: zoneNoise(2) },
    chroma: {
      redMinusGreen: sigmaFromDiffs(chromaRG, 0, maxValue + 1, pairs, scale),
      blueMinusGreen: sigmaFromDiffs(chromaBG, 0, maxValue + 1, pairs, scale),
    },
    flat: {
      tiles,
      usable: usable.length,
      sigmaMin: usable.length === 0 ? null : (usable[0] as { sigma: number }).sigma,
      sigmaP10: quantile(0.1),
      sigmaMedian: quantile(0.5),
      flattest,
    },
  };
}

// ── 클리핑 ────────────────────────────────────────────────────────────

/** 덩어리를 세는 런이 이보다 많으면 세지 않는다 — 클리핑이 노이즈처럼 퍼진 이미지의 메모리 보호. */
const MAX_RUNS = 1_500_000;

interface ClipState {
  flags: Uint8Array;
  /** 클리핑된 픽셀 수. */
  count: number;
  tile: Uint32Array;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** 한 줄 안에서 이어진 클리핑 구간(런). 위 줄의 런과 겹치면 같은 덩어리다. */
  runStart: number[];
  runEnd: number[];
  parent: number[];
  /** 바로 위 줄의 런 번호들(x 순서). */
  previous: number[];
  overflow: boolean;
}

function newClipState(width: number, tiles: number, height: number): ClipState {
  return {
    flags: new Uint8Array(width),
    count: 0,
    tile: new Uint32Array(tiles),
    left: width,
    top: height,
    right: -1,
    bottom: -1,
    runStart: [],
    runEnd: [],
    parent: [],
    previous: [],
    overflow: false,
  };
}

function findRoot(state: ClipState, index: number): number {
  let root = index;
  while (state.parent[root] !== root) {
    root = state.parent[root] as number;
  }
  // 경로 압축.
  let node = index;
  while (state.parent[node] !== root) {
    const next = state.parent[node] as number;
    state.parent[node] = root;
    node = next;
  }
  return root;
}

/**
 * 클리핑.
 *
 * ## 점인지 면인지는 **덩어리의 크기**로 가른다
 *
 * 처음에는 "4방향 이웃이 클리핑되어 있으면 면, 없으면 점" 이었다. 실기 사진에서 클리핑된 픽셀의
 * **98.55%가 면**으로 나왔는데 밤하늘의 클리핑은 별이다 — 별은 24MP 에서 여러 픽셀짜리 덩어리라
 * 이웃이 있다. 점과 면을 가르는 것은 이웃의 유무가 아니라 **이어진 덩어리가 얼마나 큰가**다.
 *
 * 그래서 4방향으로 이어진 덩어리를 세어 크기별로 비중(클리핑된 픽셀 중 %)을 낸다. 임계로 점/면을
 * 판정하지 않는다 — 별의 크기는 노출과 렌즈에 따라 달라서 못 박으면 틀린다.
 *
 * 덩어리는 줄 단위 런으로 세고 union-find 로 잇는다. 픽셀마다 라벨을 두면 2400만 픽셀에 96MB 다.
 */
export function clippingAnalysis(input: AnalysisInput, grid: Grid): ClippingResult {
  requireGeometry(input, "클리핑");
  const { data, width, height, components, maxValue } = input;
  const { cols, rows } = grid;
  const tiles = cols * rows;
  const tileX = new Uint16Array(width);
  for (let x = 0; x < width; x += 1) {
    tileX[x] = Math.min(cols - 1, Math.floor((x * cols) / width));
  }

  const high = newClipState(width, tiles, height);
  const low = newClipState(width, tiles, height);
  const tilePixels = new Uint32Array(tiles);

  for (let y = 0; y < height; y += 1) {
    // 어느 한 채널이라도 끝에 닿으면 클리핑이다.
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      const at = (rowStart + x) * components;
      const r = data[at] as number;
      const g = data[at + 1] as number;
      const b = data[at + 2] as number;
      high.flags[x] = r >= maxValue || g >= maxValue || b >= maxValue ? 1 : 0;
      low.flags[x] = r <= 0 || g <= 0 || b <= 0 ? 1 : 0;
    }
    const rowBase = Math.min(rows - 1, Math.floor((y * rows) / height)) * cols;

    for (const state of [high, low]) {
      const current: number[] = [];
      let x = 0;
      while (x < width) {
        if (state.flags[x] === 0) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < width && state.flags[x] === 1) {
          const tile = rowBase + (tileX[x] as number);
          state.tile[tile] = (state.tile[tile] as number) + 1;
          x += 1;
        }
        state.count += x - start;
        if (start < state.left) state.left = start;
        if (x - 1 > state.right) state.right = x - 1;
        if (y < state.top) state.top = y;
        state.bottom = y;

        if (state.overflow) {
          continue;
        }
        if (state.runStart.length >= MAX_RUNS) {
          state.overflow = true;
          continue;
        }
        const run = state.runStart.length;
        state.runStart.push(start);
        state.runEnd.push(x);
        state.parent.push(run);
        current.push(run);
      }

      // 위 줄의 런과 x 범위가 겹치면 같은 덩어리다(4방향 연결). 두 줄 모두 x 순서라 한 번에 훑는다.
      let first = 0;
      for (const run of current) {
        const runFrom = state.runStart[run] as number;
        const runTo = state.runEnd[run] as number;
        while (
          first < state.previous.length &&
          (state.runEnd[state.previous[first] as number] as number) <= runFrom
        ) {
          first += 1;
        }
        for (
          let other = first;
          other < state.previous.length &&
          (state.runStart[state.previous[other] as number] as number) < runTo;
          other += 1
        ) {
          const a = findRoot(state, run);
          const b = findRoot(state, state.previous[other] as number);
          if (a !== b) {
            state.parent[b] = a;
          }
        }
      }
      state.previous = current;
    }
    for (let col = 0; col < width; col += 1) {
      const tile = rowBase + (tileX[col] as number);
      tilePixels[tile] = (tilePixels[tile] as number) + 1;
    }
  }

  const total = width * height;
  const describe = (state: ClipState): ClipSide => {
    const tilesPercent: number[][] = [];
    let blown = 0;
    for (let row = 0; row < rows; row += 1) {
      const line: number[] = [];
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const pixels = tilePixels[index] as number;
        const fraction = pixels === 0 ? 0 : (state.tile[index] as number) / pixels;
        if (fraction >= 0.5) {
          blown += 1;
        }
        line.push(round(100 * fraction, 2));
      }
      tilesPercent.push(line);
    }

    // 덩어리 크기. 런이 너무 많아 세지 못했으면 null — 0 으로 지어내지 않는다.
    let blobs: ClipSide["blobs"] = null;
    if (!state.overflow) {
      const sizes = new Map<number, number>();
      for (let run = 0; run < state.runStart.length; run += 1) {
        const root = findRoot(state, run);
        sizes.set(
          root,
          (sizes.get(root) ?? 0) +
            ((state.runEnd[run] as number) - (state.runStart[run] as number)),
        );
      }
      const buckets = [0, 0, 0, 0, 0];
      let largest = 0;
      for (const size of sizes.values()) {
        if (size > largest) largest = size;
        const bucket = size === 1 ? 0 : size < 10 ? 1 : size < 100 ? 2 : size < 1000 ? 3 : 4;
        buckets[bucket] = (buckets[bucket] as number) + size;
      }
      const share = (index: number): number =>
        state.count === 0 ? 0 : round((100 * (buckets[index] as number)) / state.count, 2);
      blobs = {
        count: sizes.size,
        largestPixels: largest,
        bySize: {
          px1: share(0),
          px2to9: share(1),
          px10to99: share(2),
          px100to999: share(3),
          px1000plus: share(4),
        },
      };
    }

    return {
      percent: round((100 * state.count) / total, 4),
      blobs,
      blownTiles: blown,
      bounds:
        state.count === 0
          ? null
          : { left: state.left, top: state.top, right: state.right + 1, bottom: state.bottom + 1 },
      tiles: tilesPercent,
    };
  };
  return { high: describe(high), low: describe(low) };
}

// ── 전체 요약 (비교용) ────────────────────────────────────────────────

export interface GlobalProfile {
  pixels: number;
  /** 채널별 중앙값(0–255). */
  channelMedians: { red: number; green: number; blue: number };
  /** 휘도의 분위수(0–255). */
  luminance: { p1: number; p5: number; p50: number; p95: number; p99: number };
  /** 어느 한 채널이라도 끝에 닿은 픽셀의 비율(%). */
  clipping: { highPercent: number; lowPercent: number };
}

/**
 * 한 이미지의 전체 요약. **전체 해상도**에서 센다.
 *
 * `document.compare` 가 보정 전과 후를 각각 이것으로 요약해 견준다. 두 이미지를 한꺼번에 들고
 * 있지 않으려는 것이다 — 2400만 픽셀 16비트는 하나가 146MB 다.
 */
export function globalProfile(input: AnalysisInput): GlobalProfile {
  const { data, components, maxValue } = input;
  const pixels = Math.floor(data.length / components);
  const quant = quantTable(maxValue);
  const histR = new Uint32Array(Q);
  const histG = new Uint32Array(Q);
  const histB = new Uint32Array(Q);
  const histL = new Uint32Array(Q);
  let clipHigh = 0;
  let clipLow = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const at = pixel * components;
    const r = clamp(data[at] as number, maxValue);
    const g = clamp(data[at + 1] as number, maxValue);
    const b = clamp(data[at + 2] as number, maxValue);
    if (r >= maxValue || g >= maxValue || b >= maxValue) clipHigh += 1;
    if (r <= 0 || g <= 0 || b <= 0) clipLow += 1;
    const l = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b), maxValue);
    const qr = quant[r] as number;
    const qg = quant[g] as number;
    const qb = quant[b] as number;
    const ql = quant[l] as number;
    histR[qr] = (histR[qr] as number) + 1;
    histG[qg] = (histG[qg] as number) + 1;
    histB[qb] = (histB[qb] as number) + 1;
    histL[ql] = (histL[ql] as number) + 1;
  }
  const level = (hist: Uint32Array, fraction: number): number =>
    round(binToLevel(Math.max(0, quantileBin(hist, 0, pixels, fraction)), maxValue), 2);
  return {
    pixels,
    channelMedians: {
      red: level(histR, 0.5),
      green: level(histG, 0.5),
      blue: level(histB, 0.5),
    },
    luminance: {
      p1: level(histL, 0.01),
      p5: level(histL, 0.05),
      p50: level(histL, 0.5),
      p95: level(histL, 0.95),
      p99: level(histL, 0.99),
    },
    clipping: {
      highPercent: pixels === 0 ? 0 : round((100 * clipHigh) / pixels, 4),
      lowPercent: pixels === 0 ? 0 : round((100 * clipLow) / pixels, 4),
    },
  };
}

// ── 진입점 ────────────────────────────────────────────────────────────

export function analyze(input: AnalysisInput, options: AnalysisOptions): AnalysisResult {
  const wanted = new Set(options.analyses);
  const spatial = wanted.has("clipping") || wanted.has("gradient") || wanted.has("noise");
  if (spatial) {
    requireGeometry(input, "공간 분석");
  }
  const grid =
    input.width > 0 && input.height > 0
      ? gridFor(input.width, input.height, options.grid)
      : { cols: 1, rows: 1 };
  const result: AnalysisResult = { grid };

  if (wanted.has("histogram") || wanted.has("colorCast")) {
    const pass = colorPass(input, wanted.has("colorCast"));
    if (wanted.has("histogram")) {
      result.histogram = pass.histogram;
    }
    if (pass.colorCast !== null) {
      result.colorCast = pass.colorCast;
    }
  }
  if (wanted.has("clipping")) {
    result.clipping = clippingAnalysis(input, grid);
  }
  if (wanted.has("gradient")) {
    result.gradient = gradientAnalysis(input, grid);
  }
  if (wanted.has("noise")) {
    result.noise = noiseAnalysis(input, grid);
  }
  return result;
}
