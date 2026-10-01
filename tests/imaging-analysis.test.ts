import {
  analyze,
  clippingAnalysis,
  colorPass,
  gradientAnalysis,
  gridFor,
  noiseAnalysis,
  srgbToLab,
  type AnalysisInput,
} from "../photoshop-uxp/src/dom/imaging-analysis.js";
import { describe, expect, it } from "vitest";

/**
 * 이미징 분석기. (ROADMAP §90)
 *
 * 합성 이미지로 **정답을 아는 입력에서 정답이 나오는지** 본다 — 기울기 10단계의 램프, 점과 면,
 * 알려진 σ 의 노이즈. 실기 사진으로만 확인하면 숫자가 그럴듯해서 틀려도 모른다
 * (MEASUREMENT.md §6.4 — 지표가 재려는 것을 정말 재는지 먼저 본다).
 */

/** 시드를 고정한 난수. 테스트가 실행마다 달라지지 않게 한다. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

type Pixel = [number, number, number];

/** `fill(x, y)` 가 0–255 눈금의 RGB 를 준다. `maxValue` 가 32768 이면 16비트로 환산한다. */
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

const gray = (v: number) => (): Pixel => [v, v, v];

describe("gridFor — 짧은 변을 나눈다", () => {
  it("세로 사진은 긴 변이 비율만큼 더 나뉜다", () => {
    expect(gridFor(4032, 6048, 8)).toEqual({ cols: 8, rows: 12 });
  });

  it("가로 사진은 열과 행이 바뀐다", () => {
    expect(gridFor(6048, 4032, 8)).toEqual({ cols: 12, rows: 8 });
  });

  it("작은 이미지는 픽셀 수보다 많이 나누지 않는다", () => {
    expect(gridFor(3, 2, 8)).toEqual({ cols: 3, rows: 2 });
  });

  it("극단적인 비율에서도 긴 변 타일 수를 제한한다", () => {
    expect(gridFor(100000, 100, 8).cols).toBeLessThanOrEqual(32);
  });
});

describe("히스토그램", () => {
  it("균일한 회색은 한 구간에 100% 이고 중간 톤이다", () => {
    const { histogram } = colorPass(image(40, 40, gray(128)), false);
    expect(histogram.luminance[32]).toBe(100);
    expect(histogram.zones).toEqual({ shadows: 0, midtones: 100, highlights: 0 });
    expect(histogram.peak.bin).toBe(32);
    expect(histogram.usedRange.span).toBeLessThan(0.5);
  });

  it("두 톤 이미지는 구간별 비중이 반반이다", () => {
    const { histogram } = colorPass(
      image(40, 40, (x) => (x < 20 ? [20, 20, 20] : [220, 220, 220])),
      false,
    );
    expect(histogram.zones.shadows).toBe(50);
    expect(histogram.zones.highlights).toBe(50);
    expect(histogram.zones.midtones).toBe(0);
  });

  it("채널별 분포를 따로 준다 — 한 채널만 다른 이미지", () => {
    const { histogram } = colorPass(
      image(20, 20, () => [250, 10, 10]),
      false,
    );
    expect(histogram.red[62]).toBe(100); // 250/255*64 ≈ 62.7
    expect(histogram.green[2]).toBe(100); // 10/255*64 ≈ 2.5
  });

  it("각 분포의 합이 100% 다", () => {
    const rng = mulberry32(1);
    const { histogram } = colorPass(
      image(60, 60, () => [rng() * 255, rng() * 255, rng() * 255]),
      false,
    );
    for (const channel of [histogram.red, histogram.green, histogram.blue, histogram.luminance]) {
      expect(channel.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    }
  });

  it("**document.statistics 의 64구간과 정확히 같다** — 두 도구의 숫자가 견줘져야 한다", () => {
    // statistics 는 floor(value / ((maxValue + 1) / 64)) 로 나눈다. 반올림으로 1024구간을 접었을 때는
    // 같은 사진에서 경계가 반 칸 밀려 0.1%p 씩 어긋났다(실기 대조에서 드러났다).
    for (const maxValue of [255, 32768]) {
      const rng = mulberry32(maxValue);
      const input = image(
        120,
        90,
        () => [rng() * rng() * 255, rng() * 255 * 0.6, rng() * 255 * 0.4],
        maxValue,
      );
      const counts = new Array<number>(64).fill(0);
      const perBin = (maxValue + 1) / 64;
      const pixels = input.width * input.height;
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const at = pixel * 3;
        const l = Math.min(
          maxValue,
          Math.round(
            0.2126 * (input.data[at] as number) +
              0.7152 * (input.data[at + 1] as number) +
              0.0722 * (input.data[at + 2] as number),
          ),
        );
        const bin = Math.min(63, Math.floor(l / perBin));
        counts[bin] = (counts[bin] as number) + 1;
      }
      const reference = counts.map((count) => Number(((100 * count) / pixels).toFixed(3)));
      expect(colorPass(input, false).histogram.luminance, `maxValue ${String(maxValue)}`).toEqual(
        reference,
      );
    }
  });

  it("8비트 값은 정확히 나온다 — 128 이 128.12 같은 값으로 밀리지 않는다", () => {
    const cast = colorPass(image(10, 10, gray(128)), true).colorCast?.zones.all;
    expect(cast?.median).toEqual({ red: 128, green: 128, blue: 128 });
  });

  it("16비트는 최대값 32768 로 읽는다 — 흰색이 마지막 구간이다", () => {
    const { histogram } = colorPass(image(10, 10, gray(255), 32768), false);
    expect(histogram.luminance[63]).toBe(100);
    expect(histogram.usedRange.high).toBeCloseTo(255, 0);
    // 65535 로 읽었다면 절반인 127.5 근처가 된다.
  });
});

describe("클리핑 — 점과 면을 가른다", () => {
  const dots = image(100, 100, (x, y) =>
    x % 20 === 10 && y % 20 === 10 ? [255, 255, 255] : [100, 100, 100],
  );
  const block = image(100, 100, (x, y) =>
    x >= 20 && x < 60 && y >= 30 && y < 70 ? [255, 255, 255] : [100, 100, 100],
  );

  it("흩어진 한 픽셀 점은 전부 크기 1 의 덩어리다", () => {
    const result = clippingAnalysis(dots, gridFor(100, 100, 5));
    expect(result.high.percent).toBeCloseTo(0.25, 2); // 25점 / 10000
    expect(result.high.blobs).toMatchObject({ count: 25, largestPixels: 1 });
    expect(result.high.blobs?.bySize.px1).toBe(100);
    expect(result.high.blownTiles).toBe(0);
  });

  it("날아간 면은 하나의 큰 덩어리이고 경계 상자가 그 면이다", () => {
    const result = clippingAnalysis(block, gridFor(100, 100, 5));
    expect(result.high.percent).toBeCloseTo(16, 1); // 40×40 / 10000
    expect(result.high.blobs).toMatchObject({ count: 1, largestPixels: 1600 });
    expect(result.high.blobs?.bySize.px1000plus).toBe(100);
    expect(result.high.bounds).toEqual({ left: 20, top: 30, right: 60, bottom: 70 });
    expect(result.high.blownTiles).toBeGreaterThan(0);
  });

  it("타일 격자가 위치를 말한다 — 날아간 타일만 100%", () => {
    const result = clippingAnalysis(block, gridFor(100, 100, 5));
    expect(result.high.tiles).toHaveLength(5);
    expect(result.high.tiles[0]).toHaveLength(5);
    // 타일 (열 1, 행 2) 는 x 20–40, y 40–60 이라 전부 면 안이다.
    expect(result.high.tiles[2]?.[1]).toBe(100);
    expect(result.high.tiles[0]?.[0]).toBe(0);
  });

  it("한 채널만 끝에 닿아도 클리핑이다 — 휘도만 보면 놓친다", () => {
    const result = clippingAnalysis(
      image(20, 20, () => [255, 100, 100]),
      gridFor(20, 20, 4),
    );
    expect(result.high.percent).toBe(100);
    expect(result.low.percent).toBe(0);
  });

  it("검은 쪽도 같은 방식이다", () => {
    const result = clippingAnalysis(
      image(20, 20, (x) => (x < 10 ? [0, 80, 80] : [90, 90, 90])),
      gridFor(20, 20, 4),
    );
    expect(result.low.percent).toBe(50);
    expect(result.low.bounds).toEqual({ left: 0, top: 0, right: 10, bottom: 20 });
  });

  it("클리핑이 없으면 경계 상자는 null 이고 덩어리는 0 개다", () => {
    const result = clippingAnalysis(image(30, 30, gray(100)), gridFor(30, 30, 3));
    expect(result.high).toMatchObject({
      percent: 0,
      bounds: null,
      blobs: { count: 0, largestPixels: 0 },
    });
  });

  it("**별은 점이 아니라 작은 덩어리다** — 이웃이 있어도 면으로 세지 않는다", () => {
    // 3×3 의 클리핑된 별. 처음 기준(이웃이 있으면 면)으로는 100% 가 면이 되어 날아간 하늘과 구분이 안 됐다.
    const stars = image(100, 100, (x, y) => {
      const sx = x % 25;
      const sy = y % 25;
      return sx >= 10 && sx < 13 && sy >= 10 && sy < 13 ? [255, 255, 255] : [60, 60, 60];
    });
    const result = clippingAnalysis(stars, gridFor(100, 100, 5));
    expect(result.high.blobs).toMatchObject({ count: 16, largestPixels: 9 });
    expect(result.high.blobs?.bySize.px2to9).toBe(100);
    expect(result.high.blobs?.bySize.px1000plus).toBe(0);
  });

  it("별과 날아간 하늘이 섞이면 크기별로 갈린다", () => {
    const mixed = image(100, 100, (x, y) => {
      const patch = x >= 50 && x < 90 && y >= 50 && y < 90; // 1600px
      const star =
        x % 25 >= 10 && x % 25 < 12 && y % 25 >= 10 && y % 25 < 12 && !(x >= 50 && y >= 50);
      return patch || star ? [255, 255, 255] : [60, 60, 60];
    });
    const { bySize } = clippingAnalysis(mixed, gridFor(100, 100, 5)).high.blobs ?? { bySize: null };
    expect(bySize?.px1000plus).toBeGreaterThan(80);
    expect(bySize?.px2to9).toBeGreaterThan(0);
    const sum = Object.values(bySize ?? {}).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it("대각선으로만 닿는 픽셀은 이어진 것이 아니다 — 4방향 연결", () => {
    const diagonal = image(20, 20, (x, y) => (x === y ? [255, 255, 255] : [60, 60, 60]));
    const blobs = clippingAnalysis(diagonal, gridFor(20, 20, 4)).high.blobs;
    expect(blobs?.count).toBe(20);
    expect(blobs?.largestPixels).toBe(1);
  });

  it("U 자 모양은 두 팔이 아래에서 이어져 하나의 덩어리다 — 런을 잇는 경로", () => {
    // 윗줄에서는 두 개의 런이 따로 시작해 아랫줄에서 합쳐진다.
    const u = image(30, 30, (x, y) => {
      const arm = (x >= 5 && x < 8) || (x >= 20 && x < 23);
      const bottom = y >= 20 && y < 23 && x >= 5 && x < 23;
      return (y >= 5 && y < 23 && arm) || bottom ? [255, 255, 255] : [60, 60, 60];
    });
    const blobs = clippingAnalysis(u, gridFor(30, 30, 4)).high.blobs;
    expect(blobs?.count).toBe(1);
    // 팔 54 + 54, 바닥 54, 팔과 바닥이 겹치는 18 을 뺀 144.
    expect(blobs?.largestPixels).toBe(144);
  });

  it("런이 너무 많으면 덩어리를 세지 않고 null 이다 — 퍼센트와 위치는 그대로 준다", () => {
    // 한 줄에 1500 개의 런 × 1100 줄 = 165만 런. 노이즈처럼 퍼진 클리핑에서 메모리를 지킨다.
    const speckle = image(3000, 1100, (x) => (x % 2 === 0 ? [255, 255, 255] : [60, 60, 60]));
    const result = clippingAnalysis(speckle, gridFor(3000, 1100, 4));
    expect(result.high.blobs).toBeNull();
    expect(result.high.percent).toBeCloseTo(50, 0);
    expect(result.high.bounds).not.toBeNull();
  });
});

describe("기울기 — 평면을 맞춘다", () => {
  const W = 240;
  const H = 240;
  const grid = gridFor(W, H, 8);

  it("가로 램프: 오른쪽이 10단계 밝다", () => {
    const ramp = image(W, H, (x) => {
      const v = 40 + (10 * x) / W;
      return [v, v, v];
    });
    const plane = gradientAnalysis(ramp, grid).luminance;
    expect(plane?.acrossX).toBeGreaterThan(9.3);
    expect(plane?.acrossX).toBeLessThan(10.7);
    expect(Math.abs(plane?.acrossY ?? 99)).toBeLessThan(0.6);
    expect(plane?.higherToward).toBe("right");
    // 0° 와 359.9° 는 같은 방향이다 — 각도는 원형이라 가까운 쪽으로 잰다.
    const degrees = plane?.directionDegrees ?? 180;
    expect(Math.min(degrees, 360 - degrees)).toBeLessThan(5);
  });

  it("세로 램프: 아래가 밝다", () => {
    const ramp = image(W, H, (_, y) => {
      const v = 40 + (10 * y) / H;
      return [v, v, v];
    });
    const plane = gradientAnalysis(ramp, grid).luminance;
    expect(plane?.higherToward).toBe("bottom");
    expect(plane?.acrossY).toBeGreaterThan(9.3);
  });

  it("위가 밝은 광해: 음의 acrossY 와 top 방향", () => {
    const ramp = image(W, H, (_, y) => {
      const v = 60 - (8 * y) / H;
      return [v, v, v];
    });
    const plane = gradientAnalysis(ramp, grid).luminance;
    expect(plane?.higherToward).toBe("top");
    expect(plane?.acrossY).toBeLessThan(-7);
  });

  it("**밝은 전경이 있어도 하늘의 기울기를 맞춘다** — 이상 타일을 걸러낸다", () => {
    // 위쪽 75% 는 하늘의 가로 램프, 아래 25% 는 200 근처의 전경.
    const withGround = image(W, H, (x, y) => {
      if (y > H * 0.75) {
        return [200, 200, 200];
      }
      const v = 40 + (10 * x) / W;
      return [v, v, v];
    });
    const result = gradientAnalysis(withGround, grid);
    expect(result.usedTiles).toBeLessThan(result.totalTiles);
    // 걸러내지 못했다면 세로 기울기가 수십 단계로 나온다.
    expect(Math.abs(result.luminance?.acrossY ?? 99)).toBeLessThan(1);
    expect(result.luminance?.acrossX).toBeGreaterThan(8.5);
  });

  it("균일하면 기울기가 0 이고 방향을 지어내지 않는다", () => {
    const plane = gradientAnalysis(image(W, H, gray(90)), grid).luminance;
    expect(plane?.magnitude).toBe(0);
    expect(plane?.directionDegrees).toBeNull();
    expect(plane?.higherToward).toBeNull();
  });

  it("색 차이의 기울기 — R 만 오른쪽으로 올라가면 R−G 가 기운다", () => {
    const tilted = image(W, H, (x) => [80 + (12 * x) / W, 80, 80]);
    const drift = gradientAnalysis(tilted, grid).colorDrift;
    expect(drift.redMinusGreen?.acrossX).toBeGreaterThan(10);
    expect(Math.abs(drift.blueMinusGreen?.acrossX ?? 99)).toBeLessThan(0.6);
    expect(drift.redMinusGreen?.higherToward).toBe("right");
  });

  it("비네팅: 중앙이 모서리보다 밝다", () => {
    const vignette = image(W, H, (x, y) => {
      const d = Math.hypot((x - W / 2) / (W / 2), (y - H / 2) / (H / 2)) / Math.SQRT2;
      const v = 100 - 20 * d * d;
      return [v, v, v];
    });
    const result = gradientAnalysis(vignette, grid).vignette;
    // 모서리 **픽셀**은 80 이지만 모서리 **타일**의 중앙은 가장자리에서 반 타일 안쪽이다.
    // 모델로 계산하면 중앙 타일 ≈ 98.9, 모서리 타일 ≈ 85.7 이라 차이는 13 근처다.
    expect(result?.centerMinusCorners).toBeGreaterThan(12);
    expect(result?.centerMinusCorners).toBeLessThan(15);
  });

  it("별은 타일 중앙값을 움직이지 못한다", () => {
    const rng = mulberry32(7);
    const stars = image(W, H, (x) => {
      const v = 40 + (10 * x) / W;
      return rng() < 0.01 ? [255, 255, 255] : [v, v, v];
    });
    const plane = gradientAnalysis(stars, grid).luminance;
    expect(plane?.acrossX).toBeGreaterThan(9);
    expect(plane?.acrossX).toBeLessThan(11);
  });

  it("같은 입력은 같은 결과를 낸다 — 이상 타일 선별에 난수를 쓰지만 시드가 고정이다", () => {
    const rng = mulberry32(21);
    const noisy = image(W, H, (x, y) => {
      const v = (y > H * 0.75 ? 200 : 40 + (10 * x) / W) + rng();
      return [v, v, v];
    });
    const a = gradientAnalysis(noisy, grid);
    const b = gradientAnalysis(noisy, grid);
    expect(b).toEqual(a);
  });

  it("폭을 모르면 오류다 — 지어내지 않는다", () => {
    const broken: AnalysisInput = {
      data: new Uint8Array(30),
      width: 0,
      height: 0,
      components: 3,
      maxValue: 255,
    };
    expect(() => gradientAnalysis(broken, { cols: 2, rows: 2 })).toThrow(/가로 폭을 알 수 없어/u);
  });
});

describe("노이즈", () => {
  const W = 220;
  const H = 220;
  const grid = gridFor(W, H, 8);

  it("알려진 σ 를 복원한다 — 독립 채널 잡음의 휘도 σ (16비트)", () => {
    // 16비트로 시험한다. 8비트는 이웃 차가 정수라 중앙값도 정수이고 σ 가 1/0.954 단위로 거칠다
    // (아래 테스트). 실제 천체사진은 16비트다.
    const rng = mulberry32(11);
    const sigma = 2;
    const noisy = image(
      W,
      H,
      () => [128 + sigma * gaussian(rng), 128 + sigma * gaussian(rng), 128 + sigma * gaussian(rng)],
      32768,
    );
    // 휘도 = 0.2126R + 0.7152G + 0.0722B → σ_L = σ·√(0.2126²+0.7152²+0.0722²) ≈ 0.75σ.
    const expected = sigma * Math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2);
    const noise = noiseAnalysis(noisy, grid);
    expect(noise.luminance).toBeGreaterThan(expected - 0.2);
    expect(noise.luminance).toBeLessThan(expected + 0.2);
  });

  it("8비트는 σ 가 정수 단위로 거칠다 — document.statistics 와 같은 식이라서 일관된다", () => {
    const rng = mulberry32(11);
    const noisy = image(W, H, () => [
      128 + 2 * gaussian(rng),
      128 + 2 * gaussian(rng),
      128 + 2 * gaussian(rng),
    ]);
    const lum = noiseAnalysis(noisy, grid).luminance ?? 0;
    // 중앙값이 정수 k 이므로 σ = k / 0.954 다.
    expect(Math.abs(lum * 0.954 - Math.round(lum * 0.954))).toBeLessThan(0.01);
  });

  it("색 노이즈: R 에만 잡음이 있으면 R−G 만 크다", () => {
    const rng = mulberry32(5);
    const noisy = image(W, H, () => [128 + 3 * gaussian(rng), 128, 128]);
    const { chroma } = noiseAnalysis(noisy, grid);
    expect(chroma.redMinusGreen).toBeGreaterThan(2.5);
    expect(chroma.blueMinusGreen).toBeLessThan(0.5);
  });

  it("밝기 의존: 어두운 곳은 조용하고 밝은 곳은 시끄럽다", () => {
    const rng = mulberry32(3);
    const noisy = image(
      W,
      H,
      (x) => {
        const dark = x < W / 2;
        const base = dark ? 40 : 210;
        const s = dark ? 1 : 4;
        const v = base + s * gaussian(rng);
        return [v, v, v];
      },
      32768,
    );
    const { byZone } = noiseAnalysis(noisy, grid);
    expect(byZone.shadows.sigma).toBeLessThan((byZone.highlights.sigma ?? 0) / 2);
    // 어두운 쪽과 밝은 쪽의 **경계 쌍**은 평균이 중간 톤에 든다. 한 줄에 하나뿐이라 비중이 작다 —
    // `pairsPercent` 가 그 σ 의 대표성을 말해 준다(구조가 만든 값이지 잡음이 아니다).
    expect(byZone.midtones.pairsPercent).toBeLessThan(1);
    expect(byZone.shadows.pairsPercent + byZone.highlights.pairsPercent).toBeGreaterThan(99);
  });

  it("**평탄한 타일을 찾는다** — 구조가 있는 쪽을 피한다", () => {
    const rng = mulberry32(9);
    // 왼쪽 반은 ±60 의 질감, 오른쪽 반은 σ=1 의 조용한 영역.
    const mixed = image(
      W,
      H,
      (x) => {
        const v = x < W / 2 ? 120 + (rng() - 0.5) * 120 : 120 + gaussian(rng);
        return [v, v, v];
      },
      32768,
    );
    const { flat, luminance } = noiseAnalysis(mixed, grid);
    // 전체 σ 는 **중앙값이라 질감 반쪽에 끌려가지 않는다**(≈ 질감 쪽 35 가 아니라 3 근처). 그래도
    // 조용한 영역의 σ(≈ 0.75)보다는 크다 — 평탄한 타일을 따로 찾는 이유다.
    expect(luminance ?? 0).toBeGreaterThan((flat.sigmaP10 ?? 99) * 1.5);
    expect(flat.sigmaP10 ?? 99).toBeLessThan(1.2);
    expect(flat.flattest?.left).toBeGreaterThanOrEqual(W / 2 - 1);
  });

  it("순수 검정 타일은 평탄한 것으로 세지 않는다 — 정보가 없다", () => {
    const rng = mulberry32(2);
    const half = image(W, H, (x) => {
      if (x < W / 2) {
        return [0, 0, 0];
      }
      const v = 100 + 2 * gaussian(rng);
      return [v, v, v];
    });
    const { flat } = noiseAnalysis(half, grid);
    // 검은 반을 평탄하다고 세면 σ=0 이 최소가 되어 flattest 가 왼쪽에 잡힌다.
    expect(flat.flattest?.left).toBeGreaterThanOrEqual(W / 2 - 1);
    expect(flat.sigmaMin ?? 0).toBeGreaterThan(0.5);
  });
});

describe("색 쏠림", () => {
  it("srgbToLab — 알려진 값", () => {
    expect(srgbToLab(255, 255, 255).L).toBeCloseTo(100, 0);
    const neutral = srgbToLab(128, 128, 128);
    expect(Math.abs(neutral.a)).toBeLessThan(0.1);
    expect(Math.abs(neutral.b)).toBeLessThan(0.1);
    // 순수 빨강의 Lab 은 (53.2, 80.1, 67.2) 근처다.
    const red = srgbToLab(255, 0, 0);
    expect(red.L).toBeCloseTo(53.2, 0);
    expect(red.a).toBeCloseTo(80.1, 0);
  });

  it("중립 회색은 채도가 0 이고 방향을 지어내지 않는다", () => {
    const cast = colorPass(image(30, 30, gray(128)), true).colorCast;
    const all = cast?.zones.all;
    expect(all?.chroma).toBeLessThan(0.1);
    expect(all?.direction).toBeNull();
    expect(all?.ratios.redOverGreen).toBe(1);
  });

  it("초록 쏠림은 −a 이다 — 방향은 green 쪽(yellow-green 포함)", () => {
    const cast = colorPass(
      image(30, 30, () => [100, 120, 100]),
      true,
    ).colorCast;
    const all = cast?.zones.all;
    expect(all?.lab?.a).toBeLessThan(-5);
    // 녹색 기운 회색은 Lab 에서 +b(노랑) 도 조금 가져 yellow-green 으로 나온다.
    expect(["green", "yellow-green"]).toContain(all?.direction);
    expect(all?.hueDegrees).toBeGreaterThan(112);
    expect(all?.hueDegrees).toBeLessThan(200);
    expect(all?.ratios.redOverGreen).toBeCloseTo(0.8333, 2);
  });

  it("파랑 쏠림은 −b 이다", () => {
    const cast = colorPass(
      image(30, 30, () => [90, 100, 150]),
      true,
    ).colorCast;
    expect(cast?.zones.all.lab?.b).toBeLessThan(-10);
    expect(cast?.zones.all.direction).toBe("blue");
  });

  it("**톤 구간마다 따로 잰다** — 그림자는 중립이고 밝은 곳만 기울었다", () => {
    const tinted = image(40, 40, (x) => (x < 20 ? [30, 30, 30] : [230, 200, 200]));
    const cast = colorPass(tinted, true).colorCast;
    expect(cast?.zones.shadows.chroma).toBeLessThan(0.2);
    expect(cast?.zones.highlights.chroma).toBeGreaterThan(5);
    expect(cast?.zones.midtones.median).toBeNull();
    expect(cast?.zones.midtones.pixelsPercent).toBe(0);
  });

  it("색 공간 가정을 결과에 적는다 — 문서 프로파일은 적용하지 않는다", () => {
    const cast = colorPass(image(10, 10, gray(100)), true).colorCast;
    expect(cast?.colorSpace).toMatch(/sRGB/u);
  });
});

describe("analyze — 진입점", () => {
  const input = image(64, 64, gray(100));

  it("고른 분석만 낸다", () => {
    const result = analyze(input, { analyses: ["histogram", "gradient"], grid: 4 });
    expect(Object.keys(result).sort()).toEqual(["gradient", "grid", "histogram"]);
  });

  it("다섯을 모두 고르면 다섯이 나온다", () => {
    const result = analyze(input, {
      analyses: ["histogram", "clipping", "gradient", "noise", "colorCast"],
      grid: 4,
    });
    expect(Object.keys(result).sort()).toEqual([
      "clipping",
      "colorCast",
      "gradient",
      "grid",
      "histogram",
      "noise",
    ]);
  });

  it("공간 분석에 폭이 없으면 오류, 폭이 필요 없는 분석은 된다", () => {
    const blind: AnalysisInput = {
      data: new Uint8Array(300),
      width: 0,
      height: 0,
      components: 3,
      maxValue: 255,
    };
    expect(() => analyze(blind, { analyses: ["clipping"], grid: 4 })).toThrow(
      /가로 폭을 알 수 없어/u,
    );
    expect(() => analyze(blind, { analyses: ["histogram", "colorCast"], grid: 4 })).not.toThrow();
  });

  it("RGBA 버퍼의 알파를 색으로 읽지 않는다", () => {
    const data = new Uint8Array(10 * 10 * 4);
    for (let pixel = 0; pixel < 100; pixel += 1) {
      data[pixel * 4] = 100;
      data[pixel * 4 + 1] = 100;
      data[pixel * 4 + 2] = 100;
      data[pixel * 4 + 3] = 255; // 알파가 최대여도 클리핑이 아니다.
    }
    const result = analyze(
      { data, width: 10, height: 10, components: 4, maxValue: 255 },
      { analyses: ["clipping"], grid: 2 },
    );
    expect(result.clipping?.high.percent).toBe(0);
  });
});
