import { open, type FileHandle } from "node:fs/promises";

/**
 * FITS → 16비트 TIFF 변환. (ROADMAP §12 GraXpert 연동)
 *
 * GraXpert 3.0.2 CLI 는 **FITS 만 출력한다.** 출력 형식 옵션이 없고(`-h` 로 확인),
 * `-output out.tif` 를 줘도 `out.tif.fits` 를 만든다. Photoshop 은 FITS 를 못 읽는다.
 *
 * 규칙은 기존 CEP 패널(`GraXpert-Photoshop-Panel`)이 검증해 둔 것을 따른다.
 * 특히 **정규화는 자동 스트레치가 아니다** — 범위를 보고 의도된 인코딩을 추론한다.
 * min/max 로 무조건 늘리면 그래디언트 제거 결과의 계조가 조용히 바뀐다.
 */

/** FITS 블록 크기. 헤더와 데이터가 모두 이 배수로 정렬된다. */
const BLOCK = 2880;
const CARD = 80;

export interface FitsMetadata {
  bitpix: number;
  width: number;
  height: number;
  /** 1(흑백) 또는 3(RGB). */
  channels: number;
  bscale: number;
  bzero: number;
  /** 데이터가 시작하는 바이트 위치. */
  dataOffset: number;
  bytesPerSample: number;
}

/** BITPIX 당 바이트 수. 음수는 IEEE 부동소수점이다. */
function bytesFor(bitpix: number): number {
  switch (bitpix) {
    case 8:
      return 1;
    case 16:
      return 2;
    case 32:
    case -32:
      return 4;
    case 64:
    case -64:
      return 8;
    default:
      throw new Error(`지원하지 않는 FITS BITPIX=${bitpix}`);
  }
}

/** 카드에서 값을 꺼낸다. `KEY     = value / comment` 형태다. */
function cardValue(card: string): string | null {
  if (card.charAt(8) !== "=") {
    return null;
  }
  const rest = card.slice(9);
  const slash = rest.indexOf("/");
  return (slash === -1 ? rest : rest.slice(0, slash)).trim();
}

/**
 * 헤더를 읽는다.
 *
 * `END` 카드가 나올 때까지 블록 단위로 읽는다. 헤더가 한 블록을 넘을 수 있다.
 */
export async function readFitsHeader(handle: FileHandle): Promise<FitsMetadata> {
  const values = new Map<string, string>();
  let offset = 0;
  let done = false;

  // 블록을 무한정 읽지 않는다. 깨진 파일이면 여기서 멈춘다.
  for (let block = 0; block < 64 && !done; block += 1) {
    const buffer = Buffer.alloc(BLOCK);
    const { bytesRead } = await handle.read(buffer, 0, BLOCK, offset);
    if (bytesRead < BLOCK) {
      throw new Error("FITS 헤더가 잘렸습니다.");
    }
    offset += BLOCK;

    for (let i = 0; i < BLOCK; i += CARD) {
      const card = buffer.toString("ascii", i, i + CARD);
      const key = card.slice(0, 8).trim();
      if (key === "END") {
        done = true;
        break;
      }
      const value = cardValue(card);
      if (key.length > 0 && value !== null) {
        values.set(key, value);
      }
    }
  }

  if (!done) {
    throw new Error("FITS END 카드를 찾지 못했습니다.");
  }

  const num = (key: string, fallback?: number): number => {
    const raw = values.get(key);
    if (raw === undefined) {
      if (fallback === undefined) {
        throw new Error(`FITS 헤더에 ${key} 가 없습니다.`);
      }
      return fallback;
    }
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(`FITS ${key} 값이 올바르지 않습니다: ${raw}`);
    }
    return parsed;
  };

  const bitpix = num("BITPIX");
  const naxis = num("NAXIS");
  if (naxis !== 2 && naxis !== 3) {
    throw new Error(`지원하지 않는 FITS NAXIS=${naxis} (2D/3D 만 지원)`);
  }

  // FITS 는 NAXIS1 이 가장 빠르게 변한다. 이미지에서는 가로다.
  const width = num("NAXIS1");
  const height = num("NAXIS2");
  const channels = naxis === 3 ? num("NAXIS3") : 1;
  if (channels !== 1 && channels !== 3) {
    throw new Error(`지원하지 않는 채널 수: ${channels}`);
  }

  return {
    bitpix,
    width,
    height,
    channels,
    bscale: num("BSCALE", 1),
    bzero: num("BZERO", 0),
    dataOffset: offset,
    bytesPerSample: bytesFor(bitpix),
  };
}

/** 표본 하나를 읽는다. FITS 는 항상 빅엔디언이다. */
function readSample(buffer: Buffer, at: number, meta: FitsMetadata): number {
  let raw: number;
  switch (meta.bitpix) {
    case 8:
      raw = buffer.readUInt8(at);
      break;
    case 16:
      raw = buffer.readInt16BE(at);
      break;
    case 32:
      raw = buffer.readInt32BE(at);
      break;
    case -32:
      raw = buffer.readFloatBE(at);
      break;
    case -64:
      raw = buffer.readDoubleBE(at);
      break;
    case 64:
      // 64비트 정수는 double 로 담을 수 없는 값이 있지만 이미지 데이터에서는
      // 실질적으로 나타나지 않는다. Number 로 변환한다.
      raw = Number(buffer.readBigInt64BE(at));
      break;
    default:
      throw new Error(`지원하지 않는 FITS BITPIX=${meta.bitpix}`);
  }
  return raw * meta.bscale + meta.bzero;
}

export interface Normalization {
  scale: number;
  mode: string;
  sourceMin: number;
  sourceMax: number;
}

/**
 * 값 범위로 **의도된 인코딩**을 추론한다.
 *
 * 자동 스트레치가 아니다. min/max 로 무조건 늘리면 그래디언트 제거 결과의 계조가
 * 조용히 바뀐다 — 배경을 뺀 이미지는 원래 어둡고, 그것을 늘리면 다른 그림이 된다.
 *
 * 기존 CEP 패널이 검증해 둔 규칙이다.
 */
export function normalizationFor(min: number, max: number): Normalization {
  if (min >= -0.05 && max <= 2.0) {
    return { scale: 1, mode: "0..1 float", sourceMin: min, sourceMax: max };
  }
  if (min >= -32 && max <= 512) {
    return { scale: 1 / 255, mode: "0..255 → 0..1", sourceMin: min, sourceMax: max };
  }
  if (min >= -1024 && max <= 131072) {
    return { scale: 1 / 65535, mode: "0..65535 → 0..1", sourceMin: min, sourceMax: max };
  }
  if (min >= 0 && max > 1) {
    // 여기서만 늘린다. 인코딩을 알 수 없으면 최댓값에 맞추는 수밖에 없다.
    return { scale: 1 / max, mode: "최댓값 기준 정규화", sourceMin: min, sourceMax: max };
  }
  return { scale: 1, mode: "원본 그대로", sourceMin: min, sourceMax: max };
}

/** 유한한 값의 범위. NaN·Inf 는 건너뛴다. */
async function scanRange(
  handle: FileHandle,
  meta: FitsMetadata,
): Promise<{ min: number; max: number }> {
  const total = meta.width * meta.height * meta.channels * meta.bytesPerSample;
  const chunk = Math.max(
    meta.bytesPerSample,
    4 * 1024 * 1024 - ((4 * 1024 * 1024) % meta.bytesPerSample),
  );
  const buffer = Buffer.alloc(chunk);

  let min = Infinity;
  let max = -Infinity;
  let finite = 0;
  let position = meta.dataOffset;
  let remaining = total;

  while (remaining > 0) {
    const wanted = Math.min(chunk, remaining);
    const { bytesRead } = await handle.read(buffer, 0, wanted, position);
    if (bytesRead < wanted) {
      throw new Error("FITS 데이터가 예상보다 짧습니다.");
    }
    for (let at = 0; at < wanted; at += meta.bytesPerSample) {
      const value = readSample(buffer, at, meta);
      if (!Number.isFinite(value)) {
        continue;
      }
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
      finite += 1;
    }
    position += wanted;
    remaining -= wanted;
  }

  if (finite === 0) {
    throw new Error("FITS 에 유효한 픽셀 값이 없습니다.");
  }
  return { min, max };
}

/** 16비트 무압축 RGB TIFF 헤더. 우리가 내보내는 것과 같은 모양이다. */
function tiffHeader(width: number, height: number): Buffer {
  const entries = 10;
  // 헤더(8) + IFD 개수(2) + 항목(12×n) + 다음 IFD(4) + BitsPerSample(6) + SampleFormat(6)
  const ifdOffset = 8;
  const bitsOffset = ifdOffset + 2 + entries * 12 + 4;
  const formatOffset = bitsOffset + 6;
  const dataOffset = formatOffset + 6;

  const head = Buffer.alloc(dataOffset);
  head.write("II", 0, "ascii");
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(ifdOffset, 4);
  head.writeUInt16LE(entries, ifdOffset);

  let at = ifdOffset + 2;
  const entry = (tag: number, type: number, count: number, value: number): void => {
    head.writeUInt16LE(tag, at);
    head.writeUInt16LE(type, at + 2);
    head.writeUInt32LE(count, at + 4);
    // SHORT 한 개는 앞 2바이트에 넣는다. TIFF 규약이다.
    if (type === 3 && count === 1) {
      head.writeUInt16LE(value, at + 8);
      head.writeUInt16LE(0, at + 10);
    } else {
      head.writeUInt32LE(value, at + 8);
    }
    at += 12;
  };

  entry(256, 3, 1, width); // ImageWidth
  entry(257, 3, 1, height); // ImageLength
  entry(258, 3, 3, bitsOffset); // BitsPerSample 16,16,16
  entry(259, 3, 1, 1); // Compression: none
  entry(262, 3, 1, 2); // PhotometricInterpretation: RGB
  entry(273, 4, 1, dataOffset); // StripOffsets
  entry(277, 3, 1, 3); // SamplesPerPixel
  entry(278, 3, 1, height); // RowsPerStrip: 전체를 한 스트립으로
  entry(279, 4, 1, width * height * 3 * 2); // StripByteCounts
  entry(339, 3, 3, formatOffset); // SampleFormat 1,1,1 (부호 없는 정수)

  head.writeUInt32LE(0, at); // 다음 IFD 없음
  for (let i = 0; i < 3; i += 1) {
    head.writeUInt16LE(16, bitsOffset + i * 2);
    head.writeUInt16LE(1, formatOffset + i * 2);
  }
  return head;
}

export interface ConvertResult {
  width: number;
  height: number;
  channels: number;
  bitpix: number;
  normalization: Normalization;
}

/**
 * FITS 를 16비트 무압축 RGB TIFF 로 바꾼다.
 *
 * 한 줄씩 처리한다. 4032×6048 32비트 float 는 292MB 라 통째로 올리면 안 된다.
 *
 * FITS 3축 데이터는 **평면 우선**이다 — 채널 하나가 통째로 있고 그다음 채널이 온다.
 * TIFF 는 픽셀마다 RGB 가 붙어 있으므로 줄마다 채널 3개를 따로 읽어 엮는다.
 */
export async function convertFitsToTiff(source: string, target: string): Promise<ConvertResult> {
  const input = await open(source, "r");
  try {
    const meta = await readFitsHeader(input);
    const { min, max } = await scanRange(input, meta);
    const norm = normalizationFor(min, max);

    const output = await open(target, "w");
    try {
      await output.write(tiffHeader(meta.width, meta.height));

      const planeBytes = meta.width * meta.height * meta.bytesPerSample;
      const rowBytes = meta.width * meta.bytesPerSample;
      const planes = [Buffer.alloc(rowBytes), Buffer.alloc(rowBytes), Buffer.alloc(rowBytes)];
      const row = Buffer.alloc(meta.width * 3 * 2);

      for (let y = 0; y < meta.height; y += 1) {
        for (let c = 0; c < 3; c += 1) {
          // 흑백이면 같은 평면을 세 번 쓴다.
          const plane = meta.channels === 1 ? 0 : c;
          const at = meta.dataOffset + plane * planeBytes + y * rowBytes;
          const { bytesRead } = await input.read(planes[c] as Buffer, 0, rowBytes, at);
          if (bytesRead < rowBytes) {
            throw new Error(`FITS 데이터가 부족합니다: ${y}번째 줄`);
          }
        }

        for (let x = 0; x < meta.width; x += 1) {
          for (let c = 0; c < 3; c += 1) {
            const value = readSample(planes[c] as Buffer, x * meta.bytesPerSample, meta);
            // NaN 은 0 으로 둔다. 버리면 구멍이 생기고, 최댓값으로 채우면 흰 점이 박힌다.
            const scaled = Number.isFinite(value) ? value * norm.scale : 0;
            const clamped = scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
            row.writeUInt16LE(Math.round(clamped * 65535), (x * 3 + c) * 2);
          }
        }
        await output.write(row);
      }

      return {
        width: meta.width,
        height: meta.height,
        channels: meta.channels,
        bitpix: meta.bitpix,
        normalization: norm,
      };
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
