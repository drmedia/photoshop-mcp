import { gridFor, type Grid } from "./imaging-analysis.js";

/**
 * 마스크가 어디를 얼마나 가리는지 요약한다. (ROADMAP §97)
 *
 * `photoshop` 을 import 하지 않는 순수 모듈이라 Photoshop 없이 합성 마스크로 시험한다.
 *
 * ## 왜 필요한가
 *
 * `document.analyze` 의 마스크 분석은 **거의 한 값인 마스크에서 `gradient` 가 0 을 돌려주고**(§95)
 * 모양을 말해 주지 않는다. 비파괴 보정에서 마스크는 "어디에 효과가 걸리는가" 를 정하는 것이라 그것을
 * 직접 말하는 요약이 필요하다 — 흑·백 비율, 효과가 닿는 경계 상자, 위치별 강도.
 *
 * ## 판정이 없다
 *
 * "마스크가 좋다·나쁘다" 를 담지 않는다. 숫자와 위치만 준다(MEASUREMENT.md §2).
 *
 * ## 임계는 값의 양 끝이다
 *
 * 0–255 눈금에서 `< 0.5` 를 **완전히 가림**, `>= 254.5` 를 **완전히 보임** 으로 센다. 8비트 마스크에서는
 * 정확히 0 과 255 다. 16비트(Photoshop 은 0–32768)는 같은 눈금으로 환산한다. 임계를 넓히면 가장자리의
 * 번짐이 "완전" 에 섞여 경계 상자가 부풀려진다.
 */

export interface MaskInput {
  /** 청키 버퍼. 성분이 여럿이면 첫 성분을 쓴다(마스크는 한 채널이다). */
  data: { length: number; [index: number]: number };
  width: number;
  height: number;
  components: number;
  /** 원래 심도에서의 최대값. 8비트 255, 16비트 32768. */
  maxValue: number;
}

/** 픽셀 경계 상자. `right` · `bottom` 은 **포함하지 않는다**(= left + 가로 폭). */
export interface MaskBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MaskCoverage {
  area: { width: number; height: number };
  /** 완전히 가린 픽셀의 %. 0–100. */
  hiddenPercent: number;
  /** 완전히 보이는 픽셀의 %. 0–100. */
  revealedPercent: number;
  /** 그 사이(번짐)의 %. 0–100. */
  partialPercent: number;
  /** 평균 강도 %. 0–100. 100 이면 전부 보인다. */
  meanPercent: number;
  /** 효과가 조금이라도 닿는(완전히 가리지 않은) 픽셀의 경계 상자. 전부 가렸으면 `null`. */
  touched: MaskBox | null;
  /** 완전히 보이는 픽셀의 경계 상자. 없으면 `null`. */
  full: MaskBox | null;
  grid: Grid;
  /** rows × cols 타일의 평균 강도 %(0–100, 소수 한 자리). 위에서 아래, 왼쪽에서 오른쪽. */
  tiles: number[][];
}

const HIDDEN_BELOW = 0.5;
const REVEALED_FROM = 254.5;

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function summarizeMask(input: MaskInput, gridTiles: number): MaskCoverage {
  const { data, width, height, components, maxValue } = input;
  if (width <= 0 || height <= 0) {
    throw new Error("가로 폭을 알 수 없어 마스크를 요약할 수 없다.");
  }
  if (maxValue <= 0) {
    throw new Error("최대값을 알 수 없어 마스크를 요약할 수 없다.");
  }

  const grid = gridFor(width, height, gridTiles);
  const colOf = new Int32Array(width);
  for (let x = 0; x < width; x += 1) {
    colOf[x] = Math.min(grid.cols - 1, Math.floor((x * grid.cols) / width));
  }
  const tileSum = new Float64Array(grid.rows * grid.cols);
  const tileCount = new Float64Array(grid.rows * grid.cols);

  const scale = 255 / maxValue;
  let hidden = 0;
  let revealed = 0;
  let sum = 0;

  let touchedLeft = width;
  let touchedTop = height;
  let touchedRight = -1;
  let touchedBottom = -1;
  let fullLeft = width;
  let fullTop = height;
  let fullRight = -1;
  let fullBottom = -1;

  for (let y = 0; y < height; y += 1) {
    const row = Math.min(grid.rows - 1, Math.floor((y * grid.rows) / height));
    const rowBase = row * grid.cols;
    for (let x = 0; x < width; x += 1) {
      const level = (data[(y * width + x) * components] as number) * scale;
      sum += level;
      const tile = rowBase + (colOf[x] as number);
      tileSum[tile] = (tileSum[tile] as number) + level;
      tileCount[tile] = (tileCount[tile] as number) + 1;

      if (level < HIDDEN_BELOW) {
        hidden += 1;
        continue;
      }
      if (x < touchedLeft) touchedLeft = x;
      if (x > touchedRight) touchedRight = x;
      if (y < touchedTop) touchedTop = y;
      if (y > touchedBottom) touchedBottom = y;
      if (level >= REVEALED_FROM) {
        revealed += 1;
        if (x < fullLeft) fullLeft = x;
        if (x > fullRight) fullRight = x;
        if (y < fullTop) fullTop = y;
        if (y > fullBottom) fullBottom = y;
      }
    }
  }

  const pixels = width * height;
  const tiles: number[][] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    const values: number[] = [];
    for (let col = 0; col < grid.cols; col += 1) {
      const at = row * grid.cols + col;
      const count = tileCount[at] as number;
      values.push(count === 0 ? 0 : round(((tileSum[at] as number) / count / 255) * 100, 1));
    }
    tiles.push(values);
  }

  const hiddenPercent = round((hidden / pixels) * 100, 3);
  const revealedPercent = round((revealed / pixels) * 100, 3);
  return {
    area: { width, height },
    hiddenPercent,
    revealedPercent,
    partialPercent: round(100 - hiddenPercent - revealedPercent, 3),
    meanPercent: round((sum / pixels / 255) * 100, 2),
    touched:
      touchedRight < 0
        ? null
        : {
            left: touchedLeft,
            top: touchedTop,
            right: touchedRight + 1,
            bottom: touchedBottom + 1,
          },
    full:
      fullRight < 0
        ? null
        : { left: fullLeft, top: fullTop, right: fullRight + 1, bottom: fullBottom + 1 },
    grid,
    tiles,
  };
}
