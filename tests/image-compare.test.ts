import {
  globalProfile,
  gridFor,
  type AnalysisInput,
} from "../photoshop-uxp/src/dom/imaging-analysis.js";
import {
  compareProfiles,
  composePanels,
  heatDiff,
  panelSize,
  profileOf,
  type Rgb8,
} from "../photoshop-uxp/src/dom/image-compare.js";
import { describe, expect, it } from "vitest";

/**
 * 보정 전후 비교. (ROADMAP §91)
 *
 * 정답을 아는 합성 이미지로 본다 — 아랫부분만 +30 단계 밝힌 이미지, 한 타일만 색이 옮겨 간 이미지.
 * 실기 사진으로만 확인하면 숫자가 그럴듯해서 틀려도 모른다.
 */

type Pixel = [number, number, number];

function image(
  width: number,
  height: number,
  fill: (x: number, y: number) => Pixel,
  maxValue = 255,
): AnalysisInput {
  const data = new Uint16Array(width * height * 3);
  const scale = maxValue / 255;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y);
      const at = (y * width + x) * 3;
      data[at] = Math.max(0, Math.min(maxValue, Math.round(r * scale)));
      data[at + 1] = Math.max(0, Math.min(maxValue, Math.round(g * scale)));
      data[at + 2] = Math.max(0, Math.min(maxValue, Math.round(b * scale)));
    }
  }
  return { data, width, height, components: 3, maxValue };
}

const W = 80;
const H = 80;
const grid = gridFor(W, H, 4); // 4×4, 타일 20×20
const base = (): AnalysisInput => image(W, H, () => [90, 100, 110]);
const compare = (before: AnalysisInput, after: AnalysisInput): ReturnType<typeof compareProfiles> =>
  compareProfiles(profileOf(before, grid), profileOf(after, grid), { width: W, height: H }, grid);

describe("compareProfiles — 변한 양과 위치", () => {
  it("같은 이미지는 아무것도 변하지 않는다", () => {
    const result = compare(base(), base());
    expect(result.change.deltaE).toEqual({ mean: 0, max: 0 });
    expect(result.change.luminance).toEqual({ p1: 0, p5: 0, p50: 0, p95: 0, p99: 0 });
    expect(result.change.clipping).toEqual({ highPercent: 0, lowPercent: 0 });
    expect(result.change.channelMedians).toEqual({ red: 0, green: 0, blue: 0 });
  });

  it("아랫부분만 +30 단계 밝히면 아래 타일에만 휘도 변화가 있다", () => {
    const after = image(W, H, (_, y) => (y >= H / 2 ? [120, 130, 140] : [90, 100, 110]));
    const { change } = compare(base(), after);
    const rows = change.tiles.deltaLuminance;
    expect(rows).toHaveLength(4);
    for (const value of rows[0] as (number | null)[]) expect(value).toBe(0);
    for (const value of rows[1] as (number | null)[]) expect(value).toBe(0);
    for (const value of rows[3] as (number | null)[]) expect(value).toBeGreaterThan(28);
    for (const value of rows[3] as (number | null)[]) expect(value).toBeLessThan(32);
  });

  it("핫스팟은 가장 크게 변한 타일의 **픽셀 좌표**를 준다", () => {
    // 4×4 격자의 (열 2, 행 1) 타일 하나만 바꾼다 → x 40–60, y 20–40.
    const after = image(W, H, (x, y) =>
      x >= 40 && x < 60 && y >= 20 && y < 40 ? [160, 100, 60] : [90, 100, 110],
    );
    const { change } = compare(base(), after);
    expect(change.hotspots[0]).toMatchObject({ left: 40, top: 20, right: 60, bottom: 40 });
    expect(change.hotspots[0]?.deltaE).toBe(change.deltaE?.max);
    // 나머지 타일은 변하지 않았으니 핫스팟 둘째는 ΔE 0 이다.
    expect(change.hotspots[1]?.deltaE).toBe(0);
  });

  it("**휘도는 같고 색만 옮겨 간 타일**은 ΔL 이 작고 ΔE 가 크다 — ΔL 만 보면 놓친다", () => {
    // R 을 올리고 B 를 같은 휘도 몫만큼 내린다. 0.2126·ΔR = 0.0722·ΔB → ΔB = 2.944·ΔR.
    const after = image(W, H, (x, y) =>
      x < 20 && y < 20 ? [90 + 20, 100, 110 - 59] : [90, 100, 110],
    );
    const { change } = compare(base(), after);
    const dl = Math.abs((change.tiles.deltaLuminance[0]?.[0] ?? 99) as number);
    const de = (change.tiles.deltaE[0]?.[0] ?? 0) as number;
    expect(dl).toBeLessThan(1.5);
    expect(de).toBeGreaterThan(8);
  });

  it("클리핑의 변화는 퍼센트포인트다 — 10% 를 흰색으로 날리면 +10", () => {
    const after = image(W, H, (x, y) => (x < 80 && y < 8 ? [255, 255, 255] : [90, 100, 110]));
    const { change, before, after: afterGlobal } = compare(base(), after);
    expect(before.clipping.highPercent).toBe(0);
    expect(afterGlobal.clipping.highPercent).toBeCloseTo(10, 1);
    expect(change.clipping.highPercent).toBeCloseTo(10, 1);
    expect(change.clipping.lowPercent).toBe(0);
  });

  it("분위수의 변화는 (후 − 전) 이고 전체를 +30 밝히면 모두 +30 근처다", () => {
    const after = image(W, H, () => [120, 130, 140]);
    const { change } = compare(base(), after);
    for (const key of ["p1", "p5", "p50", "p95", "p99"] as const) {
      expect(change.luminance[key], key).toBeGreaterThan(28);
      expect(change.luminance[key], key).toBeLessThan(32);
    }
    expect(change.channelMedians.red).toBeCloseTo(30, 0);
  });

  it("전후가 바뀌면 부호가 바뀐다", () => {
    const brighter = image(W, H, () => [120, 130, 140]);
    const up = compare(base(), brighter).change.luminance.p50;
    const down = compare(brighter, base()).change.luminance.p50;
    expect(up).toBeGreaterThan(0);
    expect(down).toBeCloseTo(-up, 1);
  });

  it("표본이 없어 비교할 수 없는 타일은 0 이 아니라 null 이다", () => {
    const before = profileOf(base(), grid);
    const after = profileOf(base(), grid);
    // 한쪽 타일에서 표본이 없는 상황을 만든다.
    after.tiles.luminance[5] = Number.NaN;
    const result = compareProfiles(before, after, { width: W, height: H }, grid);
    expect(result.change.tiles.deltaLuminance[1]?.[1]).toBeNull();
    expect(result.change.tiles.deltaE[1]?.[1]).toBeNull();
    // 평균은 나머지 타일로 낸다.
    expect(result.change.deltaE?.mean).toBe(0);
  });

  it("16비트도 0–255 눈금으로 같은 변화량을 낸다", () => {
    const before = image(W, H, () => [90, 100, 110], 32768);
    const after = image(W, H, () => [120, 130, 140], 32768);
    const result = compare(before, after);
    expect(result.change.luminance.p50).toBeGreaterThan(28);
    expect(result.change.luminance.p50).toBeLessThan(32);
  });
});

describe("globalProfile", () => {
  it("반은 검정 반은 흰색: 어느 채널이든 끝에 닿으면 클리핑이다", () => {
    const half = image(40, 40, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255]));
    const profile = globalProfile(half);
    expect(profile.clipping).toEqual({ highPercent: 50, lowPercent: 50 });
  });

  it("한 채널만 끝에 닿아도 센다", () => {
    const profile = globalProfile(image(10, 10, () => [255, 100, 100]));
    expect(profile.clipping.highPercent).toBe(100);
    expect(profile.channelMedians).toEqual({ red: 255, green: 100, blue: 100 });
  });
});

describe("그림 — 패널 배치와 차이 열지도", () => {
  const solid = (width: number, height: number, value: number): Rgb8 => ({
    data: new Uint8Array(width * height * 3).fill(value),
    width,
    height,
  });

  it("panelSize — 합친 그림의 긴 변이 longEdge 를 넘지 않는다", () => {
    for (const panels of [2, 3]) {
      const size = panelSize(4032, 6048, panels, 1280, 8);
      expect(size.width * panels + 8 * (panels - 1)).toBeLessThanOrEqual(1280);
      expect(size.height).toBeLessThanOrEqual(1280);
      // 비율을 유지한다.
      expect(size.width / size.height).toBeCloseTo(4032 / 6048, 2);
    }
  });

  it("panelSize — 원본보다 크게 늘리지 않는다", () => {
    expect(panelSize(100, 80, 2, 2048, 8)).toEqual({ width: 100, height: 80 });
  });

  it("composePanels — 패널을 가로로 잇고 사이에 틈을 둔다", () => {
    const left = solid(4, 3, 10);
    const right = solid(4, 3, 200);
    const out = composePanels([left, right], 2);
    expect(out.width).toBe(10);
    expect(out.height).toBe(3);
    const at = (x: number, y: number): number => out.data[(y * out.width + x) * 3] as number;
    expect(at(0, 0)).toBe(10);
    expect(at(3, 2)).toBe(10);
    expect(at(4, 1)).toBe(96); // 틈
    expect(at(5, 1)).toBe(96);
    expect(at(6, 0)).toBe(200);
    expect(at(9, 2)).toBe(200);
  });

  it("composePanels — 크기가 다르면 던진다", () => {
    expect(() => composePanels([solid(4, 3, 0), solid(5, 3, 0)], 2)).toThrow(/패널 크기가 다르다/u);
  });

  it("heatDiff — 같으면 검정, 크게 다르면 밝은 쪽으로", () => {
    const same = heatDiff(solid(2, 2, 100), solid(2, 2, 100), 4);
    expect(Array.from(same.data)).toEqual(new Array(12).fill(0));
    const big = heatDiff(solid(2, 2, 0), solid(2, 2, 200), 4);
    expect(Array.from(big.data.subarray(0, 3))).toEqual([255, 255, 255]);
  });

  it("heatDiff — 작은 차이는 gain 이 키워서 붉게 보인다", () => {
    const small = heatDiff(solid(1, 1, 100), solid(1, 1, 110), 8); // 차이 10 × 8 = 80
    expect(small.data[0] as number).toBeGreaterThan(200); // 빨강이 먼저 오른다
    expect(small.data[2] as number).toBe(0);
  });

  it("heatDiff — 크기가 다르면 던진다", () => {
    expect(() => heatDiff(solid(2, 2, 0), solid(3, 2, 0), 4)).toThrow(/크기가 다르다/u);
  });
});
