import {
  gridFor,
  globalProfile,
  srgbToLab,
  tileMedians,
  type AnalysisInput,
  type GlobalProfile,
  type Grid,
} from "./imaging-analysis.js";

/**
 * 보정 전후 비교. (ROADMAP §91)
 *
 * **`photoshop` 을 import 하지 않는다** — 픽셀 버퍼만 받는 순수 계산이라 합성 이미지로 시험한다.
 *
 * ## 그림은 보라고, 수치는 재라고
 *
 * 비교 그림은 **축소한** 미리보기다. 미리보기로 재면 단일 픽셀 클리핑이 평균에 묻히고 8비트로
 * 내리면서 값이 바뀐다(MEASUREMENT.md §6.5). 그래서 수치는 그림에서 계산하지 않고 **전체
 * 해상도 원본**에서 따로 낸다. 두 이미지를 한꺼번에 들고 있으면 메모리가 두 배라서, 한 번에
 * 하나씩 읽어 요약(`SourceProfile`)만 남기고 그 요약끼리 견준다.
 *
 * ## 판정이 없다
 *
 * "좋아졌다" · "과하다" 가 없다. 변한 양과 위치만 준다. 무엇이 좋은 변화인지는 사진이 정한다.
 */

export interface SourceProfile {
  tiles: { red: number[]; green: number[]; blue: number[]; luminance: number[] };
  global: GlobalProfile;
}

/** 한 이미지를 전체 해상도에서 요약한다. 타일 중앙값 + 전체 분위수와 클리핑. */
export function profileOf(input: AnalysisInput, grid: Grid): SourceProfile {
  return { tiles: tileMedians(input, grid), global: globalProfile(input) };
}

export interface Hotspot {
  left: number;
  top: number;
  right: number;
  bottom: number;
  deltaE: number;
  /** 휘도 중앙값의 변화(0–255 눈금). 양수면 밝아졌다. */
  deltaLuminance: number;
}

export interface CompareMetrics {
  before: GlobalProfile;
  after: GlobalProfile;
  change: {
    /** 분위수마다 (후 − 전). 0–255 눈금. */
    luminance: { p1: number; p5: number; p50: number; p95: number; p99: number };
    channelMedians: { red: number; green: number; blue: number };
    /** 클리핑 비율의 변화. **퍼센트포인트**다. */
    clipping: { highPercent: number; lowPercent: number };
    /** 타일마다. 표본이 없는 타일은 null. `rows` × `cols`. */
    tiles: { deltaLuminance: (number | null)[][]; deltaE: (number | null)[][] };
    /** 타일 중앙색의 ΔE(CIE76)를 타일 전체로 본 평균과 최대. 타일이 없으면 null. */
    deltaE: { mean: number; max: number } | null;
    /** ΔE 가 가장 큰 타일 셋. */
    hotspots: Hotspot[];
  };
}

const round = (value: number, digits: number): number => {
  const rounded = Number(value.toFixed(digits));
  return rounded === 0 ? 0 : rounded;
};

/** 두 요약을 견준다. `area` 는 잰 영역의 크기(픽셀)다 — 타일의 위치를 픽셀로 돌려주려고 쓴다. */
export function compareProfiles(
  before: SourceProfile,
  after: SourceProfile,
  area: { width: number; height: number },
  grid: Grid,
): CompareMetrics {
  const { cols, rows } = grid;
  const tiles = cols * rows;
  const deltaLuminance: (number | null)[] = new Array<number | null>(tiles).fill(null);
  const deltaE: (number | null)[] = new Array<number | null>(tiles).fill(null);

  for (let tile = 0; tile < tiles; tile += 1) {
    const b = [before.tiles.red, before.tiles.green, before.tiles.blue, before.tiles.luminance].map(
      (channel) => channel[tile] as number,
    ) as [number, number, number, number];
    const a = [after.tiles.red, after.tiles.green, after.tiles.blue, after.tiles.luminance].map(
      (channel) => channel[tile] as number,
    ) as [number, number, number, number];
    // 어느 한쪽에 표본이 없으면 비교할 수 없다 — 0 으로 지어내지 않는다.
    if (b.some(Number.isNaN) || a.some(Number.isNaN)) {
      continue;
    }
    deltaLuminance[tile] = round(a[3] - b[3], 2);
    const labBefore = srgbToLab(b[0], b[1], b[2]);
    const labAfter = srgbToLab(a[0], a[1], a[2]);
    deltaE[tile] = round(
      Math.hypot(labAfter.L - labBefore.L, labAfter.a - labBefore.a, labAfter.b - labBefore.b),
      2,
    );
  }

  const asRows = (flat: (number | null)[]): (number | null)[][] =>
    Array.from({ length: rows }, (_, row) => flat.slice(row * cols, (row + 1) * cols));

  const usable = deltaE
    .map((value, tile) => ({ value, tile }))
    .filter((entry): entry is { value: number; tile: number } => entry.value !== null);
  const summary =
    usable.length === 0
      ? null
      : {
          mean: round(usable.reduce((sum, entry) => sum + entry.value, 0) / usable.length, 2),
          max: Math.max(...usable.map((entry) => entry.value)),
        };

  const hotspots: Hotspot[] = [...usable]
    .sort((x, y) => y.value - x.value)
    .slice(0, 3)
    .map(({ value, tile }) => {
      const col = tile % cols;
      const row = Math.floor(tile / cols);
      return {
        left: Math.floor((col * area.width) / cols),
        top: Math.floor((row * area.height) / rows),
        right: Math.floor(((col + 1) * area.width) / cols),
        bottom: Math.floor(((row + 1) * area.height) / rows),
        deltaE: value,
        deltaLuminance: deltaLuminance[tile] as number,
      };
    });

  const b = before.global;
  const a = after.global;
  const d = (x: number, y: number): number => round(x - y, 2);
  return {
    before: b,
    after: a,
    change: {
      luminance: {
        p1: d(a.luminance.p1, b.luminance.p1),
        p5: d(a.luminance.p5, b.luminance.p5),
        p50: d(a.luminance.p50, b.luminance.p50),
        p95: d(a.luminance.p95, b.luminance.p95),
        p99: d(a.luminance.p99, b.luminance.p99),
      },
      channelMedians: {
        red: d(a.channelMedians.red, b.channelMedians.red),
        green: d(a.channelMedians.green, b.channelMedians.green),
        blue: d(a.channelMedians.blue, b.channelMedians.blue),
      },
      clipping: {
        highPercent: round(a.clipping.highPercent - b.clipping.highPercent, 4),
        lowPercent: round(a.clipping.lowPercent - b.clipping.lowPercent, 4),
      },
      tiles: { deltaLuminance: asRows(deltaLuminance), deltaE: asRows(deltaE) },
      deltaE: summary,
      hotspots,
    },
  };
}

// ── 그림 ──────────────────────────────────────────────────────────────

/** 8비트 RGB 한 장(청키). */
export interface Rgb8 {
  data: Uint8Array;
  width: number;
  height: number;
}

/** 패널 사이의 틈 색. 사진의 어두운 하늘과 구분되도록 중간 회색이다. */
const GAP_VALUE = 96;

/**
 * 패널 한 장의 크기. 합친 그림의 긴 변이 `longEdge` 를 넘지 않게 한다.
 *
 * 확대하지 않는다. 원본이 더 작으면 원본 크기다.
 */
export function panelSize(
  width: number,
  height: number,
  panels: number,
  longEdge: number,
  gap: number,
): { width: number; height: number } {
  const room = longEdge - gap * (panels - 1);
  const scale = Math.min(1, room / (panels * width), longEdge / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 같은 크기의 패널들을 가로로 이어 붙인다. 사이에 `gap` 픽셀의 틈을 둔다. */
export function composePanels(panels: Rgb8[], gap: number): Rgb8 {
  const first = panels[0];
  if (first === undefined) {
    throw new Error("붙일 패널이 없다.");
  }
  for (const panel of panels) {
    if (panel.width !== first.width || panel.height !== first.height) {
      throw new Error(
        `패널 크기가 다르다: ${String(first.width)}×${String(first.height)} 와 ` +
          `${String(panel.width)}×${String(panel.height)}`,
      );
    }
  }
  const width = panels.length * first.width + gap * (panels.length - 1);
  const out = new Uint8Array(width * first.height * 3).fill(GAP_VALUE);
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index] as Rgb8;
    const left = index * (first.width + gap);
    for (let y = 0; y < first.height; y += 1) {
      const from = y * first.width * 3;
      out.set(panel.data.subarray(from, from + first.width * 3), (y * width + left) * 3);
    }
  }
  return { data: out, width, height: first.height };
}

/**
 * 차이 열지도. 픽셀마다 |후 − 전| 의 휘도 가중합에 `gain` 을 곱해 "hot" 색으로 칠한다
 * (검정 → 빨강 → 노랑 → 흰색).
 *
 * **시각용이다.** 축소한 그림에서 만들고 `gain` 이 작은 차이를 키우므로 숫자로 읽지 않는다 —
 * 수치는 `change.tiles` 가 전체 해상도에서 낸다.
 */
export function heatDiff(before: Rgb8, after: Rgb8, gain: number): Rgb8 {
  if (before.width !== after.width || before.height !== after.height) {
    throw new Error("차이를 낼 두 그림의 크기가 다르다.");
  }
  const pixels = before.width * before.height;
  const out = new Uint8Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const at = pixel * 3;
    const diff =
      0.2126 * Math.abs((after.data[at] as number) - (before.data[at] as number)) +
      0.7152 * Math.abs((after.data[at + 1] as number) - (before.data[at + 1] as number)) +
      0.0722 * Math.abs((after.data[at + 2] as number) - (before.data[at + 2] as number));
    const v = Math.min(1, (diff * gain) / 255);
    out[at] = Math.round(255 * Math.min(1, 3 * v));
    out[at + 1] = Math.round(255 * Math.max(0, Math.min(1, 3 * v - 1)));
    out[at + 2] = Math.round(255 * Math.max(0, Math.min(1, 3 * v - 2)));
  }
  return { data: out, width: before.width, height: before.height };
}

export { gridFor };
