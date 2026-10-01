import { summarizeMask, type MaskInput } from "../photoshop-uxp/src/dom/mask-coverage.js";
import { gridFor } from "../photoshop-uxp/src/dom/imaging-analysis.js";
import { describe, expect, it } from "vitest";

/**
 * 마스크 요약의 계산. (ROADMAP §97)
 *
 * 합성 마스크로 시험한다 — 정답을 손으로 셀 수 있어야 하므로 값이 단순한 모양만 쓴다.
 */

type Fill = (x: number, y: number) => number;

function mask(
  width: number,
  height: number,
  fill: Fill,
  options: { components?: number; maxValue?: number } = {},
): MaskInput {
  const components = options.components ?? 1;
  const data = new Uint16Array(width * height * components);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < components; c += 1) {
        // 첫 성분만 의미가 있다. 나머지는 일부러 엉뚱한 값을 넣어 읽지 않는지 본다.
        data[(y * width + x) * components + c] = c === 0 ? fill(x, y) : 7;
      }
    }
  }
  return { data, width, height, components, maxValue: options.maxValue ?? 255 };
}

describe("summarizeMask — 비율", () => {
  it("전부 검정: 전부 가렸고 닿는 곳이 없다", () => {
    const result = summarizeMask(
      mask(40, 30, () => 0),
      8,
    );
    expect(result.hiddenPercent).toBe(100);
    expect(result.revealedPercent).toBe(0);
    expect(result.partialPercent).toBe(0);
    expect(result.meanPercent).toBe(0);
    expect(result.touched).toBeNull();
    expect(result.full).toBeNull();
  });

  it("전부 흰색: 전부 보이고 경계 상자가 영역 전체다", () => {
    const result = summarizeMask(
      mask(40, 30, () => 255),
      8,
    );
    expect(result.revealedPercent).toBe(100);
    expect(result.hiddenPercent).toBe(0);
    expect(result.meanPercent).toBe(100);
    expect(result.touched).toEqual({ left: 0, top: 0, right: 40, bottom: 30 });
    expect(result.full).toEqual({ left: 0, top: 0, right: 40, bottom: 30 });
  });

  it("왼쪽 절반만 흰색: 50 / 50 이고 완전한 영역은 왼쪽 절반이다", () => {
    const result = summarizeMask(
      mask(40, 30, (x) => (x < 20 ? 255 : 0)),
      8,
    );
    expect(result.revealedPercent).toBe(50);
    expect(result.hiddenPercent).toBe(50);
    expect(result.meanPercent).toBe(50);
    expect(result.full).toEqual({ left: 0, top: 0, right: 20, bottom: 30 });
  });

  it("**오른쪽·아래는 포함하지 않는다** — 점 하나는 (x, y, x+1, y+1) 이다", () => {
    const result = summarizeMask(
      mask(10, 8, (x, y) => (x === 3 && y === 2 ? 255 : 0)),
      4,
    );
    expect(result.full).toEqual({ left: 3, top: 2, right: 4, bottom: 3 });
    expect(result.touched).toEqual({ left: 3, top: 2, right: 4, bottom: 3 });
  });

  it("중앙에 떨어진 사각형: 경계 상자가 그 사각형이고 나머지는 가림이다", () => {
    const result = summarizeMask(
      mask(100, 80, (x, y) => (x >= 20 && x < 60 && y >= 10 && y < 50 ? 255 : 0)),
      8,
    );
    expect(result.full).toEqual({ left: 20, top: 10, right: 60, bottom: 50 });
    expect(result.touched).toEqual(result.full);
    expect(result.revealedPercent).toBe(20); // 40×40 / 100×80
    expect(result.hiddenPercent).toBe(80);
  });
});

describe("summarizeMask — 번짐과 임계", () => {
  it("번지는 마스크: touched 는 부분값까지 닿고 full 은 완전한 곳만이다", () => {
    // x 0..9 는 0, 10..19 는 128(부분), 20..29 는 255.
    const result = summarizeMask(
      mask(30, 10, (x) => (x < 10 ? 0 : x < 20 ? 128 : 255)),
      4,
    );
    expect(result.hiddenPercent).toBeCloseTo(33.333, 2);
    expect(result.partialPercent).toBeCloseTo(33.333, 2);
    expect(result.revealedPercent).toBeCloseTo(33.333, 2);
    expect(result.touched).toEqual({ left: 10, top: 0, right: 30, bottom: 10 });
    expect(result.full).toEqual({ left: 20, top: 0, right: 30, bottom: 10 });
  });

  it("**1 은 닿는 곳이고 254 는 아직 완전하지 않다** — 임계는 값의 양 끝(±0.5)이다", () => {
    const result = summarizeMask(
      mask(4, 1, (x) => [0, 1, 254, 255][x] as number),
      4,
    );
    expect(result.hiddenPercent).toBe(25); // 0
    expect(result.revealedPercent).toBe(25); // 255
    expect(result.partialPercent).toBe(50); // 1, 254
    expect(result.touched).toEqual({ left: 1, top: 0, right: 4, bottom: 1 });
    expect(result.full).toEqual({ left: 3, top: 0, right: 4, bottom: 1 });
  });

  it("16비트: 0–32768 눈금을 0–255 로 환산한다 — 절반이면 부분이고 평균 50%", () => {
    const result = summarizeMask(
      mask(10, 10, () => 16384, { maxValue: 32768 }),
      4,
    );
    expect(result.partialPercent).toBe(100);
    expect(result.meanPercent).toBe(50);
    expect(result.full).toBeNull();
  });

  it("16비트의 양 끝(0 과 32768)은 가림과 보임이다", () => {
    const result = summarizeMask(
      mask(2, 1, (x) => (x === 0 ? 0 : 32768), { maxValue: 32768 }),
      4,
    );
    expect(result.hiddenPercent).toBe(50);
    expect(result.revealedPercent).toBe(50);
  });

  it("성분이 여럿이어도 첫 성분만 읽는다", () => {
    const result = summarizeMask(
      mask(10, 10, () => 255, { components: 3 }),
      4,
    );
    expect(result.revealedPercent).toBe(100);
  });
});

describe("summarizeMask — 위치별 강도(tiles)", () => {
  it("rows × cols 모양은 document.analyze 의 격자와 같다", () => {
    const result = summarizeMask(
      mask(80, 120, () => 0),
      8,
    );
    const grid = gridFor(80, 120, 8);
    expect(result.grid).toEqual(grid);
    expect(result.tiles).toHaveLength(grid.rows);
    expect(result.tiles.every((row) => row.length === grid.cols)).toBe(true);
  });

  it("왼쪽 위 사분면만 흰색이면 그 타일만 100 이다", () => {
    const result = summarizeMask(
      mask(80, 80, (x, y) => (x < 40 && y < 40 ? 255 : 0)),
      4,
    );
    expect(result.grid).toEqual({ cols: 4, rows: 4 });
    expect(result.tiles[0]).toEqual([100, 100, 0, 0]);
    expect(result.tiles[1]).toEqual([100, 100, 0, 0]);
    expect(result.tiles[2]).toEqual([0, 0, 0, 0]);
    expect(result.tiles[3]).toEqual([0, 0, 0, 0]);
  });

  it("오른쪽 아래만 흰색이면 마지막 타일만 100 이다 — 행과 열이 뒤바뀌지 않는다", () => {
    const result = summarizeMask(
      mask(80, 40, (x, y) => (x >= 60 && y >= 30 ? 255 : 0)),
      4,
    );
    const { cols, rows } = result.grid;
    const last = result.tiles[rows - 1]?.[cols - 1];
    expect(last).toBeGreaterThan(0);
    expect(result.tiles[0]?.[0]).toBe(0);
    expect(result.tiles[0]?.[cols - 1]).toBe(0);
    expect(result.tiles[rows - 1]?.[0]).toBe(0);
  });

  it("세로로 번지는 마스크는 타일이 위에서 아래로 단조롭게 늘어난다", () => {
    const result = summarizeMask(
      mask(40, 100, (_x, y) => Math.round((y / 99) * 255)),
      4,
    );
    const column = result.tiles.map((row) => row[0] as number);
    expect(column).toEqual([...column].sort((a, b) => a - b));
    expect(column[0]).toBeLessThan(column[column.length - 1] as number);
  });
});

describe("summarizeMask — 잘못된 입력", () => {
  it("가로 폭을 모르면 던진다 — 이웃을 알 수 없는 값으로 요약하지 않는다", () => {
    expect(() => summarizeMask({ ...mask(4, 4, () => 0), width: 0 }, 4)).toThrow(/가로 폭/u);
  });

  it("최대값을 모르면 던진다", () => {
    expect(() => summarizeMask({ ...mask(4, 4, () => 0), maxValue: 0 }, 4)).toThrow(/최대값/u);
  });
});
