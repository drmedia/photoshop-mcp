import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertFitsToTiff, normalizationFor } from "@photoshop-mcp/mcp-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * FITS → 16비트 TIFF. (GraXpert 연동)
 *
 * GraXpert 3.0.2 CLI 는 FITS 만 출력하고 Photoshop 은 FITS 를 못 읽는다.
 *
 * 가장 조심해야 할 것은 **정규화**다. min/max 로 무조건 늘리면 그래디언트 제거
 * 결과의 계조가 조용히 바뀐다 — 배경을 뺀 이미지는 원래 어둡고, 그것을 늘리면
 * 다른 그림이 된다. 규칙은 기존 CEP 패널이 검증해 둔 것을 따른다.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fits-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 80자 카드. FITS 헤더의 단위다. */
function card(text: string): string {
  return text.padEnd(80, " ").slice(0, 80);
}

/**
 * 합성 FITS 를 만든다.
 *
 * 값은 **평면 우선**으로 넣는다 — 채널 하나가 통째로 오고 그다음 채널이 온다.
 * 실제 GraXpert 출력이 그 배치다.
 */
async function writeFits(
  path: string,
  options: {
    width: number;
    height: number;
    channels: number;
    /** `(channel, x, y) => value` */
    sample: (c: number, x: number, y: number) => number;
    bitpix?: number;
    bzero?: number;
    bscale?: number;
  },
): Promise<void> {
  const bitpix = options.bitpix ?? -32;
  const cards = [
    card("SIMPLE  =                    T"),
    card(`BITPIX  = ${String(bitpix).padStart(20)}`),
    card(`NAXIS   = ${String(options.channels === 1 ? 2 : 3).padStart(20)}`),
    card(`NAXIS1  = ${String(options.width).padStart(20)}`),
    card(`NAXIS2  = ${String(options.height).padStart(20)}`),
  ];
  if (options.channels !== 1) {
    cards.push(card(`NAXIS3  = ${String(options.channels).padStart(20)}`));
  }
  if (options.bzero !== undefined) {
    cards.push(card(`BZERO   = ${String(options.bzero).padStart(20)}`));
  }
  if (options.bscale !== undefined) {
    cards.push(card(`BSCALE  = ${String(options.bscale).padStart(20)}`));
  }
  cards.push(card("END"));

  const headerText = cards.join("");
  const blocks = Math.ceil(headerText.length / 2880);
  const header = Buffer.alloc(blocks * 2880, " ");
  header.write(headerText, 0, "ascii");

  const bytesPer = Math.abs(bitpix) / 8;
  const count = options.width * options.height * options.channels;
  const data = Buffer.alloc(Math.ceil((count * bytesPer) / 2880) * 2880);

  let at = 0;
  for (let c = 0; c < options.channels; c += 1) {
    for (let y = 0; y < options.height; y += 1) {
      for (let x = 0; x < options.width; x += 1) {
        const value = options.sample(c, x, y);
        if (bitpix === -32) {
          data.writeFloatBE(value, at);
        } else if (bitpix === 16) {
          data.writeInt16BE(value, at);
        } else if (bitpix === 8) {
          data.writeUInt8(value, at);
        }
        at += bytesPer;
      }
    }
  }

  await writeFile(path, Buffer.concat([header, data]));
}

/** 만들어진 TIFF 에서 픽셀을 읽는다. 우리가 쓴 것을 우리가 읽는 셈이라 구조도 함께 검증된다. */
async function readTiffPixel(
  path: string,
  x: number,
  y: number,
  width: number,
): Promise<[number, number, number]> {
  const buffer = await readFile(path);
  const ifd = buffer.readUInt32LE(4);
  const entries = buffer.readUInt16LE(ifd);
  let dataOffset = 0;
  for (let i = 0; i < entries; i += 1) {
    const at = ifd + 2 + i * 12;
    if (buffer.readUInt16LE(at) === 273) {
      dataOffset = buffer.readUInt32LE(at + 8);
    }
  }
  const base = dataOffset + (y * width + x) * 6;
  return [buffer.readUInt16LE(base), buffer.readUInt16LE(base + 2), buffer.readUInt16LE(base + 4)];
}

describe("정규화 규칙", () => {
  it("이미 0..1 이면 늘리지 않는다", () => {
    // 여기가 핵심이다. 0.2 짜리 어두운 배경 제거 결과를 1.0 으로 늘리면 다른 그림이 된다.
    const norm = normalizationFor(0, 0.2);
    expect(norm.scale).toBe(1);
    expect(norm.mode).toBe("0..1 float");
  });

  it("0..255 범위는 255 로 나눈다", () => {
    expect(normalizationFor(0, 255).scale).toBeCloseTo(1 / 255);
  });

  it("0..65535 범위는 65535 로 나눈다", () => {
    expect(normalizationFor(0, 60000).scale).toBeCloseTo(1 / 65535);
  });

  it("알 수 없는 범위에서만 최댓값으로 늘린다", () => {
    const norm = normalizationFor(0, 1e6);
    expect(norm.scale).toBeCloseTo(1 / 1e6);
    expect(norm.mode).toContain("최댓값");
  });

  it("음수가 섞인 범위는 그대로 둔다", () => {
    // 늘릴 근거가 없다. 클램프가 처리한다.
    expect(normalizationFor(-5000, 1e6).scale).toBe(1);
  });
});

describe("변환", () => {
  it("0..1 float RGB 를 16비트로 옮긴다", async () => {
    const source = join(dir, "a.fits");
    const target = join(dir, "a.tif");
    // 채널마다 다른 값을 넣어 평면 배치가 맞는지 본다.
    await writeFits(source, {
      width: 4,
      height: 2,
      channels: 3,
      sample: (c) => [0, 0.5, 1][c] as number,
    });

    const result = await convertFitsToTiff(source, target);
    expect(result).toMatchObject({ width: 4, height: 2, channels: 3, bitpix: -32 });
    expect(result.normalization.mode).toBe("0..1 float");

    const [r, g, b] = await readTiffPixel(target, 1, 1, 4);
    expect(r).toBe(0);
    expect(g).toBe(Math.round(0.5 * 65535));
    expect(b).toBe(65535);
  });

  it("평면 우선 배치를 픽셀 단위로 엮는다", async () => {
    // 채널이 통째로 온 뒤 다음 채널이 온다. 잘못 읽으면 색이 뒤섞인다.
    const source = join(dir, "b.fits");
    const target = join(dir, "b.tif");
    await writeFits(source, {
      width: 3,
      height: 2,
      channels: 3,
      // 위치마다 다른 값 → 배치가 틀리면 바로 드러난다.
      sample: (c, x, y) => (c * 100 + y * 10 + x) / 1000,
    });

    await convertFitsToTiff(source, target);
    const expected = (c: number, x: number, y: number): number =>
      Math.round(((c * 100 + y * 10 + x) / 1000) * 65535);

    expect(await readTiffPixel(target, 2, 1, 3)).toEqual([
      expected(0, 2, 1),
      expected(1, 2, 1),
      expected(2, 2, 1),
    ]);
  });

  it("흑백은 세 채널로 복제한다", async () => {
    const source = join(dir, "g.fits");
    const target = join(dir, "g.tif");
    await writeFits(source, { width: 2, height: 2, channels: 1, sample: () => 0.25 });

    const result = await convertFitsToTiff(source, target);
    expect(result.channels).toBe(1);
    const pixel = await readTiffPixel(target, 0, 0, 2);
    expect(pixel[0]).toBe(pixel[1]);
    expect(pixel[1]).toBe(pixel[2]);
    expect(pixel[0]).toBe(Math.round(0.25 * 65535));
  });

  it("범위를 벗어난 값을 자른다", async () => {
    const source = join(dir, "c.fits");
    const target = join(dir, "c.tif");
    // 0..1 로 판정되는 범위 안에서 음수와 1 초과를 섞는다.
    await writeFits(source, {
      width: 2,
      height: 1,
      channels: 3,
      sample: (_c, x) => (x === 0 ? -0.04 : 1.5),
    });

    await convertFitsToTiff(source, target);
    expect((await readTiffPixel(target, 0, 0, 2))[0]).toBe(0);
    expect((await readTiffPixel(target, 1, 0, 2))[0]).toBe(65535);
  });

  it("NaN 은 0 으로 둔다", async () => {
    // 버리면 구멍이 생기고 최댓값으로 채우면 흰 점이 박힌다.
    const source = join(dir, "n.fits");
    const target = join(dir, "n.tif");
    await writeFits(source, {
      width: 2,
      height: 1,
      channels: 3,
      sample: (_c, x) => (x === 0 ? Number.NaN : 0.5),
    });

    await convertFitsToTiff(source, target);
    expect((await readTiffPixel(target, 0, 0, 2))[0]).toBe(0);
    expect((await readTiffPixel(target, 1, 0, 2))[0]).toBe(Math.round(0.5 * 65535));
  });

  it("전부 NaN 이면 거부한다", async () => {
    // 조용히 검은 이미지를 만들면 사용자가 원인을 못 찾는다.
    // 실제로 GraXpert 가 작은 이미지에서 0 으로 나눠 이런 파일을 만들었다.
    const source = join(dir, "all-nan.fits");
    await writeFits(source, {
      width: 2,
      height: 2,
      channels: 3,
      sample: () => Number.NaN,
    });

    await expect(convertFitsToTiff(source, join(dir, "x.tif"))).rejects.toThrow(/유효한 픽셀/u);
  });

  it("BZERO·BSCALE 을 적용한다", async () => {
    // 16비트 정수 FITS 는 부호 있는 값에 BZERO 32768 을 더해 쓴다.
    const source = join(dir, "i.fits");
    const target = join(dir, "i.tif");
    await writeFits(source, {
      width: 2,
      height: 1,
      channels: 3,
      bitpix: 16,
      bzero: 32768,
      sample: () => 0, // 0 + 32768 = 32768
    });

    const result = await convertFitsToTiff(source, target);
    expect(result.normalization.mode).toBe("0..65535 → 0..1");
    expect((await readTiffPixel(target, 0, 0, 2))[0]).toBe(Math.round((32768 / 65535) * 65535));
  });
});

describe("깨진 파일", () => {
  it("END 카드가 없으면 거부한다", async () => {
    // 블록은 온전한데 내용이 FITS 가 아닌 경우. 공백으로만 채운다.
    const source = join(dir, "not.fits");
    await writeFile(source, Buffer.alloc(2880 * 64, 0x20));
    await expect(convertFitsToTiff(source, join(dir, "x.tif"))).rejects.toThrow(/END 카드/u);
  });

  it("잘린 헤더를 거부한다", async () => {
    const source = join(dir, "short.fits");
    await writeFile(source, Buffer.from("SIMPLE  =                    T"));
    await expect(convertFitsToTiff(source, join(dir, "x.tif"))).rejects.toThrow(/잘렸/u);
  });

  it("지원하지 않는 차원을 거부한다", async () => {
    const source = join(dir, "4d.fits");
    const cards = [
      card("SIMPLE  =                    T"),
      card("BITPIX  =                  -32"),
      card("NAXIS   =                    4"),
      card("NAXIS1  =                    2"),
      card("NAXIS2  =                    2"),
      card("END"),
    ].join("");
    const header = Buffer.alloc(2880, " ");
    header.write(cards, 0, "ascii");
    await writeFile(source, Buffer.concat([header, Buffer.alloc(2880)]));

    await expect(convertFitsToTiff(source, join(dir, "x.tif"))).rejects.toThrow(/NAXIS=4/u);
  });
});
