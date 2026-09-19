import { imaging } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { toLayerType } from "./mappings.js";
import { findLayerById } from "./layer-edit.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";
import { selectionBounds } from "./state-read.js";

/**
 * 문서 통계. (ROADMAP §17.13)
 *
 * **전체 해상도에서 잰다.** 축소본에서 재면 단일 픽셀 클리핑이 평균에 묻혀,
 * 그동안 미리보기를 밖에서 재던 것과 똑같아진다. 그것을 고치려고 만드는 것이다.
 *
 * ## 노이즈도 같이 잰다
 *
 * 히스토그램은 **분포**를 주지만 인접 픽셀의 흔들림은 주지 못한다. 그래서 네 번의
 * 실기 보정에서 노이즈만은 매번 눈으로 판단했고, 결국 천체사진 스트레치에서
 * "얼마나 올려도 되는가" 를 숫자 없이 정하게 됐다.
 *
 * 가로 이웃 차의 **중앙값**으로 추정한다. 평균이 아니라 중앙값인 것이 요점이다 —
 * 가장자리와 별은 큰 차를 만들지만 소수라서 중앙값을 움직이지 못한다.
 *
 * 평탄한 영역에서 독립 잡음 두 표본의 차는 σ√2 로 퍼지고, 정규분포의 중앙 절대
 * 편차는 0.6745σ 다. 그래서 `σ ≈ median|diff| / 0.954` 다.
 *
 * 완만한 그라디언트는 영향이 없다 — 2000px 에 20단계면 픽셀당 0.01 이다.
 *
 * 값은 0–255 로 정규화해 돌려주되 **클리핑 판정은 원래 심도에서** 한다.
 * 16비트를 먼저 8비트로 내리면 32768 과 32700 이 똑같이 255 가 되어 클리핑이
 * 부풀려진다. (Photoshop 의 16비트 최대값은 65535 가 아니라 32768 이다 —
 * 캡처에서 이미 한 번 덴 자리다)
 */

const BINS = 64;

interface ChannelStats {
  mean: number;
  noise: number | null;
  p1: number;
  p5: number;
  p50: number;
  p95: number;
  p99: number;
  clippedHigh: number;
  clippedLow: number;
}

/** 누적 분포에서 백분위를 찾는다. 히스토그램을 두 번 훑지 않기 위해 한 번에 구한다. */
function percentiles(
  counts: Uint32Array,
  total: number,
  levels: number[],
  scale: number,
): number[] {
  const targets = levels.map((level) => level * total);
  const out = new Array<number>(levels.length).fill(0);
  let cumulative = 0;
  let next = 0;
  for (let value = 0; value < counts.length && next < targets.length; value += 1) {
    cumulative += counts[value] as number;
    while (next < targets.length && cumulative >= (targets[next] as number)) {
      out[next] = value * scale;
      next += 1;
    }
  }
  while (next < targets.length) {
    out[next] = (counts.length - 1) * scale;
    next += 1;
  }
  return out;
}

/**
 * 이웃 차 히스토그램에서 노이즈 σ 를 추정한다.
 *
 * 중앙값을 쓰는 이유는 위 주석에 있다. 표본이 없으면(폭 1짜리 영역 등) `null` 이다 —
 * 0 으로 돌려주면 "노이즈가 없다" 는 틀린 사실을 말하게 된다.
 */
function estimateNoise(diffs: Uint32Array, total: number, scale: number): number | null {
  if (total === 0) {
    return null;
  }
  const half = total / 2;
  let cumulative = 0;
  for (let value = 0; value < diffs.length; value += 1) {
    cumulative += diffs[value] as number;
    if (cumulative >= half) {
      return Number(((value * scale) / 0.954).toFixed(3));
    }
  }
  return null;
}

function describe(
  counts: Uint32Array,
  total: number,
  maxValue: number,
  diffs: Uint32Array,
  diffTotal: number,
): ChannelStats {
  const scale = 255 / maxValue;
  let sum = 0;
  for (let value = 0; value < counts.length; value += 1) {
    sum += value * (counts[value] as number);
  }
  const [p1, p5, p50, p95, p99] = percentiles(counts, total, [0.01, 0.05, 0.5, 0.95, 0.99], scale);
  return {
    mean: Number(((sum / total) * scale).toFixed(2)),
    p1: Number((p1 as number).toFixed(1)),
    p5: Number((p5 as number).toFixed(1)),
    p50: Number((p50 as number).toFixed(1)),
    p95: Number((p95 as number).toFixed(1)),
    p99: Number((p99 as number).toFixed(1)),
    // **원래 심도에서 판정한다.** 정규화한 뒤 세면 클리핑이 부풀려진다.
    clippedHigh: Number(((100 * (counts[maxValue] as number)) / total).toFixed(4)),
    clippedLow: Number(((100 * (counts[0] as number)) / total).toFixed(4)),
    noise: estimateNoise(diffs, diffTotal, scale),
  };
}

export async function documentStatistics(params: {
  region?: "document" | "selection";
  layerId?: number;
}): Promise<unknown> {
  return runModal("Document statistics", async () => {
    const api = imaging;
    if (api === undefined || typeof api.getPixels !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 버전에는 Imaging API 가 없어 통계를 낼 수 없습니다.",
        { recoverable: false },
      );
    }

    const document = requireActiveDocument();
    const request: Record<string, unknown> = { documentID: document.id };
    let source = "document";

    if (params.layerId !== undefined) {
      const layer = findLayerById(document.layers, params.layerId);
      if (layer === undefined || layer === null) {
        throw new DispatchError(
          "LAYER_NOT_FOUND",
          `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
          { recoverable: true, details: { layerId: params.layerId } },
        );
      }
      // **조정 레이어와 그룹은 막는다.**
      //
      // 실기에서 조정 레이어를 재 보니 모든 채널 평균이 255 로 나왔다. 픽셀이
      // 아니라 마스크 영역을 잰 것이다. 숫자 자체는 돌아오므로 호출자는 "이
      // 레이어는 순백" 이라고 읽는다 — 아무 값도 안 주는 것보다 나쁘다.
      const kind = toLayerType(layer.kind).type;
      if (kind === "adjustment" || kind === "group") {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `${kind === "group" ? "그룹" : "조정 레이어"}에는 잴 픽셀이 없습니다. ` +
            "layerId 를 빼면 조정이 반영된 합성 결과를 잽니다.",
          { recoverable: true, details: { layerId: layer.id, type: kind } },
        );
      }

      request["layerID"] = layer.id;
      source = `layer:${layer.id}`;
    }

    if (params.region === "selection") {
      if (!hasSelection()) {
        throw new DispatchError("INVALID_PARAMETER", "잴 선택 영역이 없습니다.", {
          recoverable: true,
        });
      }
      const bounds = selectionBounds();
      if (bounds === null) {
        throw new DispatchError("COMMAND_FAILED", "선택 영역의 경계를 읽지 못했습니다.", {
          recoverable: true,
        });
      }
      request["sourceBounds"] = bounds;
      source = `selection:${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
    }

    const started = Date.now();

    // **targetSize 를 주지 않는다.** 축소하면 클리핑이 사라진다.
    let pixelData;
    try {
      pixelData = await api.getPixels(request);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `픽셀을 읽지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { source } },
      );
    }

    try {
      const raw = pixelData.imageData as {
        componentSize?: number;
        components?: number;
        width?: number;
        height?: number;
        getData?: (options?: unknown) => Promise<ArrayBufferView>;
      };
      if (typeof raw.getData !== "function") {
        throw new DispatchError("COMMAND_NOT_SUPPORTED", "픽셀 버퍼를 읽을 수 없습니다.", {
          recoverable: false,
        });
      }

      const componentSize = raw.componentSize ?? 8;
      const components = raw.components ?? 3;
      // 16비트 문서의 최대값은 32768 이다. 65535 로 두면 모든 값이 절반으로 보인다.
      const maxValue = componentSize > 8 ? 32768 : 255;

      const buffer = (await raw.getData({ chunky: true })) as unknown as {
        length: number;
        [index: number]: number;
      };
      const pixels = Math.floor(buffer.length / components);

      const red = new Uint32Array(maxValue + 1);
      const green = new Uint32Array(maxValue + 1);
      const blue = new Uint32Array(maxValue + 1);
      const luminance = new Uint32Array(maxValue + 1);
      // 가로 이웃 차의 히스토그램. 중앙값을 여기서 뽑는다.
      const dRed = new Uint32Array(maxValue + 1);
      const dGreen = new Uint32Array(maxValue + 1);
      const dBlue = new Uint32Array(maxValue + 1);
      const dLum = new Uint32Array(maxValue + 1);

      // 폭을 모르면 이웃이 누구인지 알 수 없다. 그때는 노이즈를 재지 않는다 —
      // 0 을 돌려주면 "노이즈가 없다" 는 틀린 사실이 된다.
      const width = raw.width ?? 0;
      const height = width > 0 ? Math.floor(pixels / width) : 0;
      let diffTotal = 0;

      const clamp = (value: number): number =>
        value > maxValue ? maxValue : value < 0 ? 0 : value;

      if (width > 1 && height > 0) {
        for (let y = 0; y < height; y += 1) {
          const rowStart = y * width;
          let pr = 0;
          let pg = 0;
          let pb = 0;
          let pl = 0;
          for (let x = 0; x < width; x += 1) {
            const at = (rowStart + x) * components;
            const r = clamp(buffer[at] as number);
            const g = clamp(buffer[at + 1] as number);
            const b = clamp(buffer[at + 2] as number);
            const l = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
            red[r] = (red[r] as number) + 1;
            green[g] = (green[g] as number) + 1;
            blue[b] = (blue[b] as number) + 1;
            luminance[l] = (luminance[l] as number) + 1;
            if (x > 0) {
              const dr = r > pr ? r - pr : pr - r;
              const dg = g > pg ? g - pg : pg - g;
              const db = b > pb ? b - pb : pb - b;
              const dl = l > pl ? l - pl : pl - l;
              dRed[dr] = (dRed[dr] as number) + 1;
              dGreen[dg] = (dGreen[dg] as number) + 1;
              dBlue[db] = (dBlue[db] as number) + 1;
              dLum[dl] = (dLum[dl] as number) + 1;
              diffTotal += 1;
            }
            pr = r;
            pg = g;
            pb = b;
            pl = l;
          }
        }
      } else {
        for (let pixel = 0; pixel < pixels; pixel += 1) {
          const at = pixel * components;
          const r = clamp(buffer[at] as number);
          const g = clamp(buffer[at + 1] as number);
          const b = clamp(buffer[at + 2] as number);
          const l = clamp(Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b));
          red[r] = (red[r] as number) + 1;
          green[g] = (green[g] as number) + 1;
          blue[b] = (blue[b] as number) + 1;
          luminance[l] = (luminance[l] as number) + 1;
        }
      }

      // 휘도 분포를 64구간 비율로 접는다. 원래 구간 수를 그대로 보내면
      // 16비트에서 32769개가 되어 아무도 읽지 못한다.
      const histogram = new Array<number>(BINS).fill(0);
      const perBin = (maxValue + 1) / BINS;
      for (let value = 0; value <= maxValue; value += 1) {
        const bin = Math.min(BINS - 1, Math.floor(value / perBin));
        histogram[bin] = (histogram[bin] as number) + (luminance[value] as number);
      }

      const elapsedMs = Date.now() - started;
      return {
        source,
        pixels,
        bitDepth: componentSize,
        channels: {
          red: describe(red, pixels, maxValue, dRed, diffTotal),
          green: describe(green, pixels, maxValue, dGreen, diffTotal),
          blue: describe(blue, pixels, maxValue, dBlue, diffTotal),
          luminance: describe(luminance, pixels, maxValue, dLum, diffTotal),
        },
        histogram: histogram.map((count) => Number(((100 * count) / pixels).toFixed(3))),
        // 언젠가 표본 추출이나 다른 경로가 생기면 호출자가 구분할 수 있어야 한다.
        method: "getPixels",
        elapsedMs,
      };
    } finally {
      pixelData.imageData?.dispose?.();
    }
  });
}
