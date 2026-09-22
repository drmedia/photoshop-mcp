import {
  fillGroundWithSkyPlane,
  fitPlane,
  fitSkyModel,
  planeValue,
  type PlaneSample,
} from "@photoshop-mcp/mcp-core";
import { tiffHeader } from "../packages/mcp-core/src/capabilities/fits.js";
import { open } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * 지상부를 하늘 평면으로 덮는다. (ROADMAP §19)
 *
 * GraXpert 에 지상 풍경이 든 사진을 그냥 넣으면 산·나무가 배경 모델을
 * 끌어당긴다 — 실기에서 결과가 원본과 눈으로 구분되지 않았다.
 *
 * 고정하는 것은 넷이다.
 *
 * 1. **평면을 정확히 복원한다** — 최소제곱이 맞게 풀리는지
 * 2. **이상치에 끌려가지 않는다** — 별·구름이 섞여도 평면이 버틴다
 * 3. **외삽을 가둔다** — 지상까지 늘린 값이 화면 밖으로 튀지 않는다
 * 4. **하늘은 건드리지 않는다** — 마스크가 흰 곳은 한 비트도 안 바뀐다
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "skyfill-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** `값 = a + b·x + c·y` 를 따르는 표본을 만든다. */
function planarSamples(a: number, b: number, c: number, count = 16): PlaneSample[] {
  const out: PlaneSample[] = [];
  for (let i = 0; i < count; i += 1) {
    const x = (i % 4) / 3;
    const y = Math.floor(i / 4) / 3;
    const v = a + b * x + c * y;
    out.push({ x, y, rgb: [v, v, v] });
  }
  return out;
}

describe("평면 적합", () => {
  it("**평면을 정확히 복원한다**", () => {
    const [a, b, c] = fitPlane(planarSamples(1000, 400, -250), 0);

    expect(a).toBeCloseTo(1000, 3);
    expect(b).toBeCloseTo(400, 3);
    expect(c).toBeCloseTo(-250, 3);
  });

  it("**표본이 한 줄에 몰려도 던지지 않는다**", () => {
    /* 하늘이 가로로 얇게만 선택된 경우다. 행렬이 특이해지는데 대각의
     * `1e-9` 가 그것을 막는다 — 값이 완벽하지 않아도 평면은 나온다. */
    const flat: PlaneSample[] = [0, 1, 2, 3, 4, 5].map((i) => ({
      x: i / 5,
      y: 0.5,
      rgb: [1000 + i * 10, 1000, 1000],
    }));

    expect(() => fitPlane(flat, 0)).not.toThrow();
    expect(Number.isFinite(fitPlane(flat, 0)[0])).toBe(true);
  });
});

describe("이상치", () => {
  it("**별이 섞여도 평면이 버틴다**", () => {
    /* 별은 배경보다 훨씬 밝다. 평균으로 적합하면 그쪽으로 끌려간다 —
     * 중앙값과 MAD 로 세 번 걸러낸다. */
    const samples = planarSamples(1000, 400, -250);
    const polluted = [...samples];
    polluted[0] = { ...(samples[0] as PlaneSample), rgb: [60000, 60000, 60000] };
    polluted[5] = { ...(samples[5] as PlaneSample), rgb: [58000, 58000, 58000] };

    const clean = fitSkyModel(samples)[0];
    const dirty = fitSkyModel(polluted)[0];

    // 가운데(0.5, 0.5)에서의 값을 견준다.
    const at = (m: typeof clean): number => planeValue(m, 0.5, 0.5);
    expect(Math.abs(at(dirty) - at(clean))).toBeLessThan(300);
  });

  it("표본이 모자라면 무엇을 해야 하는지 말한다", () => {
    expect(() => fitSkyModel(planarSamples(1000, 0, 0, 3))).toThrow(/하늘 선택을 넓히세요/u);
  });
});

describe("외삽", () => {
  it("**표본 범위 밖으로 멀리 못 간다**", () => {
    /* 평면을 지상까지 늘리면 한참 밖으로 나갈 수 있다. 가두지 않으면
     * 지상이 새까맣거나 새하얘져 그 자체가 AI 에게 구조로 읽힌다. */
    const model = fitSkyModel(planarSamples(1000, 0, 20000))[0];

    // y = 5 는 표본 범위(0~1) 밖이다.
    const far = planeValue(model, 0, 5);
    expect(far).toBeLessThanOrEqual(model.max);
    expect(far).toBeGreaterThanOrEqual(model.min);
  });
});

// ---------------------------------------------------------------------------

const WIDTH = 64;
const HEIGHT = 64;
/** 이 행부터 지상이다. */
const HORIZON = 40;

/** 16비트 RGB TIFF 를 쓴다. 픽셀 값은 `at(x, y)` 가 정한다. */
async function writeTiff(
  path: string,
  at: (x: number, y: number) => [number, number, number],
): Promise<void> {
  const handle = await open(path, "w");
  try {
    const header = tiffHeader(WIDTH, HEIGHT);
    await handle.write(header, 0, header.length, 0);
    const row = Buffer.alloc(WIDTH * 6);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const [r, g, b] = at(x, y);
        row.writeUInt16LE(r, x * 6);
        row.writeUInt16LE(g, x * 6 + 2);
        row.writeUInt16LE(b, x * 6 + 4);
      }
      await handle.write(row, 0, row.length, header.length + y * row.length);
    }
  } finally {
    await handle.close();
  }
}

/** 결과 파일의 한 픽셀. */
async function pixel(path: string, x: number, y: number): Promise<[number, number, number]> {
  const handle = await open(path, "r");
  try {
    const header = tiffHeader(WIDTH, HEIGHT);
    const row = Buffer.alloc(WIDTH * 6);
    await handle.read(row, 0, row.length, header.length + y * row.length);
    return [row.readUInt16LE(x * 6), row.readUInt16LE(x * 6 + 2), row.readUInt16LE(x * 6 + 4)];
  } finally {
    await handle.close();
  }
}

/** 하늘은 위에서 아래로 밝아지는 기울기, 지상은 거의 검다. */
function sceneAt(x: number, y: number): [number, number, number] {
  if (y >= HORIZON) {
    return [800, 700, 600];
  }
  const v = 4000 + Math.round((y / HORIZON) * 3000) + Math.round((x / WIDTH) * 500);
  return [v, v, v];
}

function maskAt(_x: number, y: number): [number, number, number] {
  const v = y < HORIZON ? 65535 : 0;
  return [v, v, v];
}

describe("지상 치환", () => {
  it("**하늘은 한 비트도 안 바뀐다**", async () => {
    const source = join(workspace, "src.tif");
    const mask = join(workspace, "mask.tif");
    const target = join(workspace, "out.tif");
    await writeTiff(source, sceneAt);
    await writeTiff(mask, maskAt);

    const result = await fillGroundWithSkyPlane(source, mask, target);
    expect(result.fullSky).toBe(false);

    for (const y of [0, 10, 39]) {
      expect(await pixel(target, 20, y), `y=${String(y)}`).toEqual(sceneAt(20, y));
    }
  });

  it("**지상은 하늘의 기울기를 이어받는다**", async () => {
    /* 원본 지상은 800 언저리로 평평하다. 덮은 뒤에는 하늘 평면의 연장이라
     * 그보다 훨씬 밝고, 아래로 갈수록 더 밝아야 한다. */
    const source = join(workspace, "src.tif");
    const mask = join(workspace, "mask.tif");
    const target = join(workspace, "out.tif");
    await writeTiff(source, sceneAt);
    await writeTiff(mask, maskAt);

    await fillGroundWithSkyPlane(source, mask, target);

    const near = (await pixel(target, 20, HORIZON + 2))[0];
    const far = (await pixel(target, 20, HEIGHT - 1))[0];

    expect(near).toBeGreaterThan(3000);
    expect(far).toBeGreaterThan(near);
  });

  it("**하늘뿐이면 그대로 베낀다**", async () => {
    /* 덮을 것이 없는데 평면을 만들어 씌우면 원본을 근사값으로 바꾸게 된다. */
    const source = join(workspace, "src.tif");
    const mask = join(workspace, "mask.tif");
    const target = join(workspace, "out.tif");
    await writeTiff(source, sceneAt);
    await writeTiff(mask, () => [65535, 65535, 65535]);

    const result = await fillGroundWithSkyPlane(source, mask, target);

    expect(result.fullSky).toBe(true);
    expect(await pixel(target, 20, HEIGHT - 1)).toEqual(sceneAt(20, HEIGHT - 1));
  });

  it("**하늘이 거의 없으면 이유를 말하며 실패한다**", async () => {
    /* 전부 검정인 마스크나 몇 점뿐인 하늘로 평면을 만들면 그 평면이 무엇을
     * 뜻하는지 아무도 모른다. 근거가 없으면 만들지 않는다. */
    const source = join(workspace, "src.tif");
    const mask = join(workspace, "mask.tif");
    const target = join(workspace, "out.tif");
    await writeTiff(source, sceneAt);
    // 30픽셀이면 하한(64) 아래다. 한 행 전체(64)는 딱 걸려 통과한다.
    await writeTiff(mask, (x, y) => {
      const v = y < 1 && x < 30 ? 65535 : 0;
      return [v, v, v];
    });

    await expect(fillGroundWithSkyPlane(source, mask, target)).rejects.toThrow(
      /하늘 선택을 넓히세요/u,
    );
  });

  it("**같은 파일에 쓰지 않는다**", async () => {
    const source = join(workspace, "src.tif");
    await writeTiff(source, sceneAt);

    await expect(fillGroundWithSkyPlane(source, source, source)).rejects.toThrow(/별도 파일/u);
  });
});
