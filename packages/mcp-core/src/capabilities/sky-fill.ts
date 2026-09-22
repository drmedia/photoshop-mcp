import { open, type FileHandle } from "node:fs/promises";
import { tiffHeader } from "./fits.js";

/**
 * 지상부를 하늘의 연장선으로 덮는다. (ROADMAP §19)
 *
 * ## 왜 필요한가
 *
 * GraXpert 에 지상 풍경이 든 사진을 그냥 넣으면 **산·나무가 배경 모델을
 * 끌어당긴다.** 실기에서 전체 이미지로 돌린 결과가 원본과 눈으로 구분되지
 * 않았다 — 하늘에서 뺄 것을 거의 못 찾은 것이다.
 *
 * `-preferences_file` 로 하늘에만 샘플 포인트를 주는 길도 된다(CLI 로 재 봤고
 * 표본 99.9%가 달라졌다). 다만 그러면 GraXpert 가 `interpolation type - RBF`
 * 로 떨어진다 — **AI 배경 추출을 끄는 것**이라 쓰지 않는다.
 *
 * ## 무엇으로 덮는가
 *
 * **단색이 아니라 평면이다.** 하늘의 기울기를 지상까지 연장해 덮으므로 AI 가
 * 경계를 구조로 읽지 않는다. 단색 블록을 넣으면 그 경계 자체가 신호가 된다.
 *
 * ```text
 * 1. 하늘 픽셀을 16×16 타일로 표본 추출 (타일마다 중앙값)
 * 2. 채널마다 1차 평면 a + b·x + c·y 를 적합
 *    MAD 기반으로 이상치를 3번 걸러낸다 — 별과 옅은 구름이 평면을 끌어당긴다
 * 3. 표본 범위 ±패딩으로 값을 가둔다 — 외삽이 화면 밖으로 튀지 않게
 * 4. 지상 픽셀을 그 평면 값으로 바꾼다 (마스크 가중치로 섞는다)
 * ```
 *
 * `D:/Dev/Codex/GraXpert_Photoshop_Panel` 의 `client/sky-fill.js` 를 옮긴
 * 것이다. 상수와 절차를 바꾸지 않았다 — 그쪽이 실기로 다듬어진 값이다.
 */

/** 16비트 최댓값. */
const MAX = 65535;

/** 이 값 이상이면 하늘로 본다. 경계의 반투명 픽셀을 표본에서 뺀다. */
const SKY_THRESHOLD = 65500;

/** 표본을 모을 타일 격자. 화면을 고르게 덮으려는 것이다. */
const TILES = 16;

/** 타일 하나가 표본이 되려면 필요한 픽셀 수. */
const MIN_PER_TILE = 4;

/** 평면을 적합하려면 필요한 표본 수. */
const MIN_SAMPLES = 6;

/** 하늘이 이보다 적으면 평면을 믿을 수 없다. */
const MIN_SKY_PIXELS = 64;

export interface PlaneSample {
  /** 0~1 로 정규화한 가로 위치. */
  x: number;
  /** 0~1 로 정규화한 세로 위치. */
  y: number;
  /** 채널 셋의 값 (0~65535). */
  rgb: [number, number, number];
}

export interface ChannelModel {
  /** `[a, b, c]` — 값 = a + b·x + c·y. */
  coeff: [number, number, number];
  min: number;
  max: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/**
 * 최소제곱으로 1차 평면을 구한다.
 *
 * 3×4 확대 행렬을 가우스 소거한다. 대각에 `1e-9` 를 두는 것은 표본이 한 줄에
 * 몰렸을 때 행렬이 특이해지는 것을 막기 위함이다 — 하늘이 가로로 얇게만
 * 선택된 경우가 실제로 있다.
 */
export function fitPlane(
  samples: readonly PlaneSample[],
  channel: number,
): [number, number, number] {
  const m: number[][] = [
    [1e-9, 0, 0, 0],
    [0, 1e-9, 0, 0],
    [0, 0, 1e-9, 0],
  ];
  for (const sample of samples) {
    const v: number[] = [1, sample.x, sample.y];
    const value = sample.rgb[channel] as number;
    for (let i = 0; i < 3; i += 1) {
      const rowI = m[i] as number[];
      const vi = v[i] as number;
      for (let j = 0; j < 3; j += 1) {
        rowI[j] = (rowI[j] as number) + vi * (v[j] as number);
      }
      rowI[3] = (rowI[3] as number) + vi * value;
    }
  }

  for (let k = 0; k < 3; k += 1) {
    let pivot = k;
    for (let p = k + 1; p < 3; p += 1) {
      if (
        Math.abs((m[p] as number[])[k] as number) > Math.abs((m[pivot] as number[])[k] as number)
      ) {
        pivot = p;
      }
    }
    const swap = m[k] as number[];
    m[k] = m[pivot] as number[];
    m[pivot] = swap;

    const d = (m[k] as number[])[k] as number;
    for (let c = k; c < 4; c += 1) {
      (m[k] as number[])[c] = ((m[k] as number[])[c] as number) / d;
    }
    for (let r = 0; r < 3; r += 1) {
      if (r === k) {
        continue;
      }
      const f = (m[r] as number[])[k] as number;
      for (let c = k; c < 4; c += 1) {
        (m[r] as number[])[c] =
          ((m[r] as number[])[c] as number) - f * ((m[k] as number[])[c] as number);
      }
    }
  }

  return [
    (m[0] as number[])[3] as number,
    (m[1] as number[])[3] as number,
    (m[2] as number[])[3] as number,
  ];
}

/**
 * 채널마다 평면과 값 범위를 구한다.
 *
 * **이상치를 세 번 걸러낸다.** 별·옅은 구름·비행기 궤적이 표본에 섞이면
 * 평면이 그쪽으로 끌려간다. 중앙값과 MAD 로 판정하므로 평균보다 덜 흔들린다.
 *
 * 남는 표본이 {@link MIN_SAMPLES} 아래로 떨어지면 거기서 멈춘다 — 더 걸러
 * 내다가 평면을 못 구하는 것보다 덜 정제된 평면이 낫다.
 */
export function fitSkyModel(
  samples: readonly PlaneSample[],
): [ChannelModel, ChannelModel, ChannelModel] {
  if (samples.length < MIN_SAMPLES) {
    throw new Error(
      `가상 하늘을 만들 배경 표본이 부족합니다 (${String(samples.length)}개). 하늘 선택을 넓히세요.`,
    );
  }

  const models = [0, 1, 2].map((channel): ChannelModel => {
    let selected = [...samples];
    for (let pass = 0; pass < 3; pass += 1) {
      const coeff = fitPlane(selected, channel);
      const residual = selected.map(
        (s) => (s.rgb[channel] as number) - coeff[0] - coeff[1] * s.x - coeff[2] * s.y,
      );
      const center = median(residual);
      const mad = median(residual.map((v) => Math.abs(v - center)));
      // 1.4826 은 MAD 를 표준편차로 바꾸는 상수다. 256 은 16비트에서의 하한.
      const limit = Math.max(256, 3 * 1.4826 * mad);
      const retained = selected.filter(
        (_, i) => Math.abs((residual[i] as number) - center) <= limit,
      );
      if (retained.length < MIN_SAMPLES) {
        break;
      }
      selected = retained;
    }

    const coeff = fitPlane(selected, channel);
    const values = selected.map((s) => s.rgb[channel] as number);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    /* **외삽을 가둔다.** 평면을 지상까지 늘리면 표본 범위 밖으로 한참 나갈 수
     * 있다. 패딩을 두는 것은 하늘이 실제로 조금 더 밝거나 어두울 수 있어서다. */
    const pad = Math.max(512, (hi - lo) * 0.25);
    return { coeff, min: Math.max(0, lo - pad), max: Math.min(MAX, hi + pad) };
  });

  return models as [ChannelModel, ChannelModel, ChannelModel];
}

/** 평면 값을 그 채널의 범위 안으로 가둔다. */
export function planeValue(model: ChannelModel, x: number, y: number): number {
  const [a, b, c] = model.coeff;
  return Math.max(model.min, Math.min(model.max, a + b * x + c * y));
}

// ---------------------------------------------------------------------------
// TIFF 읽기 — `fits.ts` 가 쓰는 것과 같은 모양(16비트 RGB, 무압축)만 읽는다
// ---------------------------------------------------------------------------

interface TiffInfo {
  width: number;
  height: number;
  /** 픽셀당 채널 수. 3보다 클 수 있다 — 아래 참조. */
  samples: number;
  /** 한 픽셀이 차지하는 바이트. */
  pixelBytes: number;
  rowBytes: number;
  rowsPerStrip: number;
  stripOffsets: number[];
}

async function readTiffInfo(handle: FileHandle, label: string): Promise<TiffInfo> {
  const head = Buffer.alloc(8);
  await handle.read(head, 0, 8, 0);
  if (head.toString("ascii", 0, 2) !== "II" || head.readUInt16LE(2) !== 42) {
    throw new Error(`${label}: little-endian TIFF 만 읽을 수 있습니다.`);
  }

  const ifdAt = head.readUInt32LE(4);
  const countBuffer = Buffer.alloc(2);
  await handle.read(countBuffer, 0, 2, ifdAt);
  const count = countBuffer.readUInt16LE(0);
  const entries = Buffer.alloc(count * 12);
  await handle.read(entries, 0, entries.length, ifdAt + 2);

  const scalars = new Map<number, number>();
  const arrays = new Map<number, number[]>();

  for (let i = 0; i < count; i += 1) {
    const at = i * 12;
    const tag = entries.readUInt16LE(at);
    const type = entries.readUInt16LE(at + 2);
    const items = entries.readUInt32LE(at + 4);
    const size = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (size === 0) {
      continue;
    }
    const bytes = size * items;
    let source: Buffer;
    if (bytes <= 4) {
      source = entries.subarray(at + 8, at + 8 + bytes);
    } else {
      source = Buffer.alloc(bytes);
      await handle.read(source, 0, bytes, entries.readUInt32LE(at + 8));
    }
    const values: number[] = [];
    for (let v = 0; v < items; v += 1) {
      values.push(type === 3 ? source.readUInt16LE(v * 2) : source.readUInt32LE(v * 4));
    }
    if (items === 1) {
      scalars.set(tag, values[0] as number);
    }
    arrays.set(tag, values);
  }

  const width = scalars.get(256);
  const height = scalars.get(257);
  const bits = arrays.get(258)?.[0];
  const samples = scalars.get(277);
  const compression = scalars.get(259) ?? 1;
  const offsets = arrays.get(273);

  if (width === undefined || height === undefined || offsets === undefined) {
    throw new Error(`${label}: TIFF 태그가 모자랍니다.`);
  }
  /* **채널이 3보다 많을 수 있다.** Photoshop 문서에 알파 채널이 있으면 TIFF 에
   * 함께 실린다 — 실기에서 4채널이 왔다. 앞의 셋만 읽고 나머지는 건너뛴다.
   * 거절하면 알파 채널을 쓰는 사용자가 이 경로를 아예 못 쓴다. */
  if (bits !== 16 || samples === undefined || samples < 3) {
    throw new Error(
      `${label}: 16비트 RGB 가 필요합니다 (${String(bits)}비트 ${String(samples)}채널).`,
    );
  }
  if (compression !== 1) {
    throw new Error(`${label}: 압축된 TIFF 는 읽을 수 없습니다.`);
  }

  const pixelBytes = samples * 2;
  return {
    width,
    height,
    samples,
    pixelBytes,
    rowBytes: width * pixelBytes,
    rowsPerStrip: scalars.get(278) ?? height,
    stripOffsets: offsets,
  };
}

/** 그 행이 파일 어디에 있는지. 스트립이 여럿일 수 있다. */
function rowOffset(info: TiffInfo, row: number): number {
  const strip = Math.floor(row / info.rowsPerStrip);
  const base = info.stripOffsets[strip];
  if (base === undefined) {
    throw new Error("TIFF strip 정보가 모자랍니다.");
  }
  return base + (row - strip * info.rowsPerStrip) * info.rowBytes;
}

export interface SkyFillResult {
  width: number;
  height: number;
  /** 평면을 적합하는 데 쓴 표본 수. */
  samples: number;
  /** 지상이 하나도 없어 원본을 그대로 복사했는지. */
  fullSky: boolean;
}

/**
 * 하늘 마스크 밖(지상부)을 하늘 평면으로 덮어 새 파일에 쓴다.
 *
 * @param source 원본 16비트 RGB TIFF
 * @param mask   같은 크기의 16비트 RGB TIFF. 흰색이 하늘이다
 * @param target 결과를 쓸 경로. `source`·`mask` 와 달라야 한다
 */
export async function fillGroundWithSkyPlane(
  source: string,
  mask: string,
  target: string,
): Promise<SkyFillResult> {
  if (target === source || target === mask) {
    throw new Error("가상 하늘 출력은 별도 파일이어야 합니다.");
  }

  const input = await open(source, "r");
  try {
    const maskHandle = await open(mask, "r");
    try {
      const info = await readTiffInfo(input, "원본");
      const maskInfo = await readTiffInfo(maskHandle, "마스크");
      if (info.width !== maskInfo.width || info.height !== maskInfo.height) {
        throw new Error(
          `마스크 크기가 다릅니다: ${String(info.width)}×${String(info.height)} 대 ` +
            `${String(maskInfo.width)}×${String(maskInfo.height)}.`,
        );
      }

      const row = Buffer.alloc(info.rowBytes);
      const maskRow = Buffer.alloc(maskInfo.rowBytes);

      /* **표본은 성기게 모은다.** 2440만 픽셀을 다 읽을 이유가 없다 —
       * 평면 하나를 구하는 데 필요한 것은 고르게 퍼진 몇백 점이다. */
      const dx = Math.max(1, Math.floor(info.width / 256));
      const dy = Math.max(1, Math.floor(info.height / 256));
      const tiles = new Map<
        number,
        { x: number[]; y: number[]; rgb: [number[], number[], number[]] }
      >();
      let skyCount = 0;
      let groundCount = 0;

      for (let y = 0; y < info.height; y += dy) {
        await input.read(row, 0, info.rowBytes, rowOffset(info, y));
        await maskHandle.read(maskRow, 0, maskInfo.rowBytes, rowOffset(maskInfo, y));
        for (let x = 0; x < info.width; x += dx) {
          if (maskRow.readUInt16LE(x * maskInfo.pixelBytes) < SKY_THRESHOLD) {
            groundCount += 1;
            continue;
          }
          skyCount += 1;
          const key =
            Math.min(TILES - 1, Math.floor((y * TILES) / info.height)) * TILES +
            Math.min(TILES - 1, Math.floor((x * TILES) / info.width));
          let tile = tiles.get(key);
          if (tile === undefined) {
            tile = { x: [], y: [], rgb: [[], [], []] };
            tiles.set(key, tile);
          }
          tile.x.push(x / Math.max(1, info.width - 1));
          tile.y.push(y / Math.max(1, info.height - 1));
          for (let c = 0; c < 3; c += 1) {
            (tile.rgb[c] as number[]).push(row.readUInt16LE(x * info.pixelBytes + c * 2));
          }
        }
      }

      if (skyCount < MIN_SKY_PIXELS) {
        throw new Error(
          `가상 하늘을 만들 배경 표본이 부족합니다 (${String(skyCount)}점). 하늘 선택을 넓히세요.`,
        );
      }

      /* **지상이 없으면 그대로 베낀다.** 하늘 전체를 고른 경우다 — 덮을 것이
       * 없는데 평면을 만들어 씌우면 원본을 근사값으로 바꾸게 된다. */
      if (groundCount === 0) {
        await copyFile(input, target, info);
        return { width: info.width, height: info.height, samples: 0, fullSky: true };
      }

      const samples: PlaneSample[] = [];
      for (const tile of tiles.values()) {
        if (tile.x.length < MIN_PER_TILE) {
          continue;
        }
        samples.push({
          x: median(tile.x),
          y: median(tile.y),
          rgb: [median(tile.rgb[0]), median(tile.rgb[1]), median(tile.rgb[2])],
        });
      }
      const model = fitSkyModel(samples);

      const output = await open(target, "w");
      try {
        const header = tiffHeader(info.width, info.height);
        await output.write(header, 0, header.length, 0);
        const pixelOffset = header.length;

        /* **출력은 언제나 3채널이다.** 입력에 알파가 있어도 싣지 않는다 —
         * 외부 처리기가 읽는 것은 RGB 이고, 알파를 넘기면 그 의미를 우리가
         * 보증할 수 없다. 그래서 행 버퍼를 따로 둔다. */
        const outRowBytes = info.width * 3 * 2;
        const outRow = Buffer.alloc(outRowBytes);

        for (let y = 0; y < info.height; y += 1) {
          await input.read(row, 0, info.rowBytes, rowOffset(info, y));
          await maskHandle.read(maskRow, 0, maskInfo.rowBytes, rowOffset(maskInfo, y));
          const ny = y / Math.max(1, info.height - 1);
          for (let x = 0; x < info.width; x += 1) {
            const at = x * info.pixelBytes;
            const weight = maskRow.readUInt16LE(x * maskInfo.pixelBytes) / MAX;
            const nx = x / Math.max(1, info.width - 1);
            for (let c = 0; c < 3; c += 1) {
              const original = row.readUInt16LE(at + c * 2);
              if (weight === 1) {
                outRow.writeUInt16LE(original, (x * 3 + c) * 2);
                continue;
              }
              const fake = planeValue(model[c] as ChannelModel, nx, ny);
              /* 경계에서 갑자기 바뀌지 않게 마스크 값으로 섞는다. 페더된
               * 선택이 그대로 부드러운 이음매가 된다. */
              outRow.writeUInt16LE(
                Math.round(original * weight + fake * (1 - weight)),
                (x * 3 + c) * 2,
              );
            }
          }
          await output.write(outRow, 0, outRowBytes, pixelOffset + y * outRowBytes);
        }
      } finally {
        await output.close();
      }

      return { width: info.width, height: info.height, samples: samples.length, fullSky: false };
    } finally {
      await maskHandle.close();
    }
  } finally {
    await input.close();
  }
}

/** 원본을 우리 헤더로 다시 쓴다. 태그를 그대로 베끼는 것보다 단순하다. */
async function copyFile(input: FileHandle, target: string, info: TiffInfo): Promise<void> {
  const output = await open(target, "w");
  try {
    const header = tiffHeader(info.width, info.height);
    await output.write(header, 0, header.length, 0);
    const row = Buffer.alloc(info.rowBytes);
    const outRowBytes = info.width * 3 * 2;
    const outRow = Buffer.alloc(outRowBytes);
    for (let y = 0; y < info.height; y += 1) {
      await input.read(row, 0, info.rowBytes, rowOffset(info, y));
      // 알파는 싣지 않는다. 위 write 루프와 같은 이유다.
      for (let x = 0; x < info.width; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          outRow.writeUInt16LE(row.readUInt16LE(x * info.pixelBytes + c * 2), (x * 3 + c) * 2);
        }
      }
      await output.write(outRow, 0, outRowBytes, header.length + y * outRowBytes);
    }
  } finally {
    await output.close();
  }
}

export interface MaskMergeResult {
  width: number;
  height: number;
  /** 마스크 안(처리본을 쓴 쪽) 픽셀 수. */
  inside: number;
  /** 마스크 밖(원본을 되돌린 쪽) 픽셀 수. */
  outside: number;
}

/**
 * 마스크 밖을 원본으로 되돌려 한 장으로 합친다.
 *
 * `fillGroundWithSkyPlane` 의 짝이다. 들어갈 때는 지상을 가짜 평면으로 덮고,
 * 나올 때는 그 가짜를 **원본 지상으로 되돌린다.**
 *
 * ## 왜 마스크 레이어로 두지 않는가
 *
 * 처음에는 결과를 그대로 배치하고 Photoshop 마스크를 씌웠다. 합성 화면은
 * 같지만 **그 레이어 하나는 지상이 투명하다.** 그리고 투명은 다음 작업마다
 * 걸린다 — `document.statistics` 는 알파를 안 보고 RGB 만 읽으므로 투명한 곳이
 * 0 으로 섞여 평균이 내려간다. 실기에서 첫 측정이 바로 그것에 걸렸다.
 *
 * **통짜 레이어 한 장이면 뒤따르는 Tool 이 아무것도 몰라도 된다.**
 *
 * @param processed 처리기가 낸 16비트 RGB TIFF. 이 파일은 읽기만 한다
 * @param original  원본 16비트 TIFF. 마스크 밖에 쓸 픽셀
 * @param mask      같은 크기의 마스크 TIFF. 흰색이 처리본을 쓸 쪽이다
 * @param target    결과를 쓸 경로. 위 셋과 달라야 한다
 */
export async function restoreOutsideMask(
  processed: string,
  original: string,
  mask: string,
  target: string,
): Promise<MaskMergeResult> {
  if (target === processed || target === original || target === mask) {
    throw new Error("합성 출력은 별도 파일이어야 합니다.");
  }

  const processedHandle = await open(processed, "r");
  try {
    const originalHandle = await open(original, "r");
    try {
      const maskHandle = await open(mask, "r");
      try {
        const info = await readTiffInfo(processedHandle, "처리 결과");
        const originalInfo = await readTiffInfo(originalHandle, "원본");
        const maskInfo = await readTiffInfo(maskHandle, "마스크");

        /* 셋의 크기가 같아야 한다. 하나라도 다르면 픽셀이 어긋난 채로 섞여
         * **오류 없이 틀린 그림**이 나온다. */
        for (const [label, other] of [
          ["원본", originalInfo],
          ["마스크", maskInfo],
        ] as const) {
          if (other.width !== info.width || other.height !== info.height) {
            throw new Error(
              `${label} 크기가 처리 결과와 다릅니다: ` +
                `${String(other.width)}×${String(other.height)} 대 ` +
                `${String(info.width)}×${String(info.height)}.`,
            );
          }
        }

        const row = Buffer.alloc(info.rowBytes);
        const originalRow = Buffer.alloc(originalInfo.rowBytes);
        const maskRow = Buffer.alloc(maskInfo.rowBytes);
        const outRowBytes = info.width * 3 * 2;
        const outRow = Buffer.alloc(outRowBytes);
        let inside = 0;
        let outside = 0;

        const output = await open(target, "w");
        try {
          const header = tiffHeader(info.width, info.height);
          await output.write(header, 0, header.length, 0);

          for (let y = 0; y < info.height; y += 1) {
            await processedHandle.read(row, 0, info.rowBytes, rowOffset(info, y));
            await originalHandle.read(
              originalRow,
              0,
              originalInfo.rowBytes,
              rowOffset(originalInfo, y),
            );
            await maskHandle.read(maskRow, 0, maskInfo.rowBytes, rowOffset(maskInfo, y));

            for (let x = 0; x < info.width; x += 1) {
              const weight = maskRow.readUInt16LE(x * maskInfo.pixelBytes) / MAX;
              if (weight >= 1) {
                inside += 1;
              } else if (weight <= 0) {
                outside += 1;
              }
              for (let c = 0; c < 3; c += 1) {
                const processedValue = row.readUInt16LE(x * info.pixelBytes + c * 2);
                if (weight >= 1) {
                  outRow.writeUInt16LE(processedValue, (x * 3 + c) * 2);
                  continue;
                }
                const originalValue = originalRow.readUInt16LE(x * originalInfo.pixelBytes + c * 2);
                /* 페더된 선택이 그대로 부드러운 이음매가 된다.
                 * `fillGroundWithSkyPlane` 의 섞는 방식과 같다. */
                outRow.writeUInt16LE(
                  Math.round(processedValue * weight + originalValue * (1 - weight)),
                  (x * 3 + c) * 2,
                );
              }
            }
            await output.write(outRow, 0, outRowBytes, header.length + y * outRowBytes);
          }
        } finally {
          await output.close();
        }

        return { width: info.width, height: info.height, inside, outside };
      } finally {
        await maskHandle.close();
      }
    } finally {
      await originalHandle.close();
    }
  } finally {
    await processedHandle.close();
  }
}
