import { compareProfiles, profileOf } from "../photoshop-uxp/src/dom/image-compare.js";
import { gridFor, type AnalysisInput } from "../photoshop-uxp/src/dom/imaging-analysis.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, isCapturedImage } from "@photoshop-mcp/photoshop-bridge";
import { DocumentCompareParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.document.compare`. (ROADMAP §91)
 *
 * 계산은 `image-compare.test.ts` 가 합성 이미지로 시험한다. 여기서는 **배선**을 본다 — 파라미터 ·
 * 대상 검증 · 결과 검증 · 이미지 응답 형식 · Mock 이 현실과 같은 모양인지.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

const setup = (bridge: MockPhotoshopBridge = new MockPhotoshopBridge()): Mcp =>
  createPhotoshopMcp({ bridge, logger: createSilentLogger() });

const invoke = async (
  mcp: Mcp,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

const compare = (mcp: Mcp, args: Record<string, unknown>): Promise<Record<string, unknown>> =>
  invoke(mcp, "photoshop.document.compare", args);

/** 새 픽셀 레이어를 만들고 id 를 돌려준다. */
async function newLayer(mcp: Mcp): Promise<number> {
  return ((await invoke(mcp, "photoshop.layer.create", { name: "Work" })) as { id: number }).id;
}

describe("document.compare — 파라미터", () => {
  it("읽기 전용이다", () => {
    expect(setup().tools.get("photoshop.document.compare")?.permission).toBe("read");
  });

  it("보정 전 레이어는 필수다 — 무엇과 견줄지 짐작하지 않는다", () => {
    expect(DocumentCompareParamsSchema.safeParse({}).success).toBe(false);
    expect(DocumentCompareParamsSchema.safeParse({ beforeLayerId: 1 }).success).toBe(true);
  });

  it("모르는 키와 잘못된 값을 거절한다", () => {
    const parse = (extra: Record<string, unknown>): boolean =>
      DocumentCompareParamsSchema.safeParse({ beforeLayerId: 1, ...extra }).success;
    expect(parse({ bogus: 1 })).toBe(false);
    expect(parse({ beforeLayerId: 0 })).toBe(false);
    expect(parse({ afterLayerId: -2 })).toBe(false);
    expect(parse({ grid: 3 })).toBe(false);
    expect(parse({ grid: 17 })).toBe(false);
    expect(parse({ longEdge: 100 })).toBe(false);
    expect(parse({ longEdge: 3000 })).toBe(false);
    expect(parse({ quality: 0 })).toBe(false);
    expect(parse({ quality: 101 })).toBe(false);
    expect(parse({ diff: "yes" })).toBe(false);
    expect(parse({ region: "selection", diff: true, grid: 12, longEdge: 2048, quality: 90 })).toBe(
      true,
    );
  });
});

describe("document.compare — 대상 검증은 statistics 와 같다", () => {
  it("없는 보정 전 레이어를 거부한다", async () => {
    await expect(compare(setup(), { beforeLayerId: 9999 })).rejects.toThrow(/찾을 수 없습니다/u);
  });

  it("없는 보정 후 레이어를 거부한다 — 후 쪽도 검증한다", async () => {
    const mcp = setup();
    const before = await newLayer(mcp);
    await expect(compare(mcp, { beforeLayerId: before, afterLayerId: 9999 })).rejects.toThrow(
      /찾을 수 없습니다/u,
    );
  });

  it("조정 레이어를 보정 전으로 줄 수 없다 — 픽셀이 없다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.adjustment.curves", {
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 255 },
      ],
    });
    const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; type: string }[];
    };
    const adjustment = layers.find((entry) => entry.type === "adjustment");
    expect(adjustment).toBeDefined();
    await expect(compare(mcp, { beforeLayerId: adjustment?.id })).rejects.toThrow(
      /잴 픽셀이 없습니다/u,
    );
  });

  it("선택이 없으면 selection 범위는 실패한다 — 문서 전체로 물러나지 않는다", async () => {
    const mcp = setup();
    const before = await newLayer(mcp);
    await expect(compare(mcp, { beforeLayerId: before, region: "selection" })).rejects.toThrow(
      /선택 영역/u,
    );
  });
});

describe("document.compare — 응답 형식", () => {
  it("이미지 결과로 알아볼 수 있다 — 서버가 이미지 블록으로 내보낸다", async () => {
    const mcp = setup();
    const before = await newLayer(mcp);
    const result = await compare(mcp, { beforeLayerId: before });
    // mcp-server 는 isCapturedImage 이면 base64 를 이미지 블록으로, 나머지를 텍스트(JSON)로 낸다.
    expect(isCapturedImage(result)).toBe(true);
    expect(result).toHaveProperty("change");
    expect(result).toHaveProperty("panels");
  });

  it("패널 순서를 말한다 — 그림에는 글자가 없다", async () => {
    const mcp = setup();
    const before = await newLayer(mcp);
    expect((await compare(mcp, { beforeLayerId: before }))["panels"]).toEqual(["before", "after"]);
    expect((await compare(mcp, { beforeLayerId: before, diff: true }))["panels"]).toEqual([
      "before",
      "after",
      "difference",
    ]);
  });

  it("무엇을 견주었는지 source 에 밝힌다", async () => {
    const mcp = setup();
    const before = await newLayer(mcp);
    expect((await compare(mcp, { beforeLayerId: before }))["source"]).toMatch(
      /^compare:before=layer:\d+ after=document/u,
    );
  });
});

describe("document.compare — Mock 은 현실과 같은 모양이다", () => {
  /** 평평한 회색 128 인 w×h 이미지. Mock 의 문서가 이것이다. */
  const flat = (width: number, height: number): AnalysisInput => ({
    data: new Uint8Array(width * height * 3).fill(128),
    width,
    height,
    components: 3,
    maxValue: 255,
  });

  it("선택 영역(100×100)에서 순수 모듈의 평평한 회색 비교와 같다", async () => {
    const mcp = setup();
    const before = await newLayer(mcp);
    await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
    const result = await compare(mcp, { beforeLayerId: before, region: "selection" });

    const grid = gridFor(100, 100, 8);
    const image = flat(100, 100);
    const real = compareProfiles(
      profileOf(image, grid),
      profileOf(image, grid),
      { width: 100, height: 100 },
      grid,
    );
    expect(result["area"]).toEqual({ width: 100, height: 100 });
    expect(result["grid"]).toEqual(grid);
    expect(result["before"]).toEqual(real.before);
    expect(result["after"]).toEqual(real.after);
    expect(result["change"]).toEqual(real.change);
  });

  it("문서 전체에서도 격자와 핫스팟의 좌표가 플러그인의 계산과 같다", async () => {
    // Mock 의 문서는 document.create 로 바뀌지 않는다. 크기는 document.get 이 말한다.
    const mcp = setup();
    const before = await newLayer(mcp);
    const { width, height } = (await invoke(mcp, "photoshop.document.get")) as {
      width: number;
      height: number;
    };
    const result = await compare(mcp, { beforeLayerId: before, grid: 5 });
    const grid = gridFor(width, height, 5);
    expect(result["grid"]).toEqual(grid);
    const spots = (result["change"] as { hotspots: { left: number; right: number }[] }).hotspots;
    expect(spots[0]).toMatchObject({ left: 0, top: 0 });
    expect(spots[1]?.left).toBe(Math.floor(width / grid.cols));
  });
});

describe("document.compare — 결과 검증", () => {
  it("**요청한 패널 수와 다르면 오류다** — 서버만 새 버전일 때 차이 패널이 조용히 빠지지 않게", async () => {
    class OldPlugin extends MockPhotoshopBridge {
      override async executeCommand<TResult>(
        command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
      ): Promise<TResult> {
        const result = await super.executeCommand<Record<string, unknown>>(command);
        if (command.type === "DOCUMENT_COMPARE") {
          result["panels"] = ["before", "after"]; // diff 를 모르는 옛 플러그인
        }
        return result as TResult;
      }
    }
    const mcp = setup(new OldPlugin());
    const before = await newLayer(mcp);
    await expect(compare(mcp, { beforeLayerId: before, diff: true })).rejects.toThrow(
      /요청한 패널 수\(3\)와 결과\(2\)가 다릅니다/u,
    );
    await expect(compare(mcp, { beforeLayerId: before, diff: true })).rejects.toThrow(
      /버전이 같은지/u,
    );
    // 차이를 요청하지 않았으면 문제없다.
    await expect(compare(mcp, { beforeLayerId: before })).resolves.toBeDefined();
  });

  it("모양이 틀린 결과는 PROTOCOL_ERROR 다", async () => {
    class Broken extends MockPhotoshopBridge {
      override async executeCommand<TResult>(
        command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
      ): Promise<TResult> {
        if (command.type === "DOCUMENT_COMPARE") {
          return { kind: "image" } as TResult;
        }
        return super.executeCommand<TResult>(command);
      }
    }
    const mcp = setup(new Broken());
    const before = await newLayer(mcp);
    await expect(compare(mcp, { beforeLayerId: before })).rejects.toThrow(
      /비교 결과가 예상과 다릅니다/u,
    );
  });
});
