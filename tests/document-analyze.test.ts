import { analyze, gridFor } from "../photoshop-uxp/src/dom/imaging-analysis.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { DocumentAnalyzeParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.document.analyze`. (ROADMAP §90)
 *
 * 계산 자체는 `imaging-analysis.test.ts` 가 합성 이미지로 시험한다. 여기서는 **배선**을 본다 —
 * 파라미터 · 대상 검증 · 결과 검증 · Mock 이 현실과 같은 모양인지.
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

const analyzeTool = (
  mcp: Mcp,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => invoke(mcp, "photoshop.document.analyze", args);

const ALL = ["histogram", "clipping", "gradient", "noise", "colorCast"];

describe("document.analyze — 파라미터", () => {
  it("읽기 전용이다", () => {
    expect(setup().tools.get("photoshop.document.analyze")?.permission).toBe("read");
  });

  it("statistics 와 같은 대상 선택 규칙을 쓴다 — 두 도구가 같은 곳을 재야 견줘진다", () => {
    for (const key of ["region", "layerId", "target"]) {
      expect(DocumentAnalyzeParamsSchema.shape).toHaveProperty(key);
    }
  });

  it("아무것도 안 주면 통과한다 — 다섯 모두, 문서 전체", () => {
    expect(DocumentAnalyzeParamsSchema.safeParse({}).success).toBe(true);
  });

  it("모르는 키를 거절한다", () => {
    expect(DocumentAnalyzeParamsSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });

  it("analyses 는 비어 있거나 중복이거나 모르는 이름이면 거절한다", () => {
    const parse = (analyses: unknown): boolean =>
      DocumentAnalyzeParamsSchema.safeParse({ analyses }).success;
    expect(parse([])).toBe(false);
    expect(parse(["histogram", "histogram"])).toBe(false);
    expect(parse(["sharpness"])).toBe(false);
    expect(parse(["gradient"])).toBe(true);
    expect(parse(ALL)).toBe(true);
  });

  it("grid 는 4–16 정수다", () => {
    const parse = (grid: unknown): boolean =>
      DocumentAnalyzeParamsSchema.safeParse({ grid }).success;
    expect(parse(3)).toBe(false);
    expect(parse(17)).toBe(false);
    expect(parse(8.5)).toBe(false);
    expect(parse(4)).toBe(true);
    expect(parse(16)).toBe(true);
  });
});

describe("document.analyze — 대상 검증은 statistics 와 같다", () => {
  it("선택이 없으면 selection 범위는 실패한다 — 문서 전체로 물러나지 않는다", async () => {
    await expect(analyzeTool(setup(), { region: "selection" })).rejects.toThrow(/선택 영역/u);
  });

  it("없는 레이어를 거부한다", async () => {
    await expect(analyzeTool(setup(), { layerId: 9999 })).rejects.toThrow(/찾을 수 없습니다/u);
  });

  it("조정 레이어를 거부한다 — 마스크 영역을 재서 순백으로 읽히면 안 된다", async () => {
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
    await expect(analyzeTool(mcp, { layerId: adjustment?.id })).rejects.toThrow(
      /잴 픽셀이 없습니다/u,
    );
  });
});

describe("document.analyze — Mock 은 현실과 같은 모양이다", () => {
  /** 평평한 회색 128 인 w×h 이미지를 순수 모듈에 넣은 결과. Mock 이 이것과 같아야 한다. */
  function realFlat(width: number, height: number, tiles = 8): Record<string, unknown> {
    const data = new Uint8Array(width * height * 3).fill(128);
    return analyze(
      { data, width, height, components: 3, maxValue: 255 },
      { analyses: ALL as never, grid: tiles },
    ) as never;
  }
  const strip = (result: Record<string, unknown>): Record<string, unknown> => {
    const {
      source: _s,
      area: _a,
      pixels: _p,
      bitDepth: _b,
      method: _m,
      elapsedMs: _e,
      ...rest
    } = result;
    return rest;
  };

  it("선택 영역(100×100)에서 순수 모듈의 평평한 회색 분석과 같다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
    const result = await analyzeTool(mcp, { region: "selection" });
    expect(result["area"]).toEqual({ width: 100, height: 100 });
    expect(strip(result)).toEqual(realFlat(100, 100));
  });

  it("문서 전체에서도 격자와 평탄한 타일의 위치가 플러그인의 계산과 같다", async () => {
    // Mock 의 문서는 하나뿐이고 document.create 로 바뀌지 않는다. 그 크기는 document.get 이 말한다.
    // 6백만 픽셀을 합성해 전체를 견주지 않고, 기하(격자 · 타일 경계)만 플러그인의 gridFor 와 견준다.
    const mcp = setup();
    const { width, height } = (await invoke(mcp, "photoshop.document.get")) as {
      width: number;
      height: number;
    };
    const result = await analyzeTool(mcp);
    const grid = gridFor(width, height, 8);
    expect(result["grid"]).toEqual(grid);
    expect(result["area"]).toEqual({ width, height });
    const flattest = (result["noise"] as { flat: { flattest: Record<string, number> } }).flat
      .flattest;
    expect(flattest).toMatchObject({
      left: 0,
      top: 0,
      right: Math.floor(width / grid.cols),
      bottom: Math.floor(height / grid.rows),
    });
  });

  it("격자 크기를 바꿔도 기하가 플러그인과 같다", async () => {
    const mcp = setup();
    const { width, height } = (await invoke(mcp, "photoshop.document.get")) as {
      width: number;
      height: number;
    };
    for (const tiles of [4, 5, 12, 16]) {
      const result = await analyzeTool(mcp, { grid: tiles, analyses: ["clipping"] });
      expect(result["grid"], `grid ${String(tiles)}`).toEqual(gridFor(width, height, tiles));
      const high = (result["clipping"] as { high: { tiles: number[][] } }).high.tiles;
      expect(high).toHaveLength(gridFor(width, height, tiles).rows);
    }
  });

  it("grid 를 주면 격자가 바뀐다", async () => {
    const mcp = setup();
    const small = await analyzeTool(mcp, { grid: 4, analyses: ["clipping"] });
    const large = await analyzeTool(mcp, { grid: 16, analyses: ["clipping"] });
    expect((small["grid"] as { rows: number }).rows).toBeLessThan(
      (large["grid"] as { rows: number }).rows,
    );
  });

  it("고른 분석만 돌아온다", async () => {
    const mcp = setup();
    const result = await analyzeTool(mcp, { analyses: ["histogram", "noise"] });
    expect(
      Object.keys(result)
        .filter((key) => ALL.includes(key))
        .sort(),
    ).toEqual(["histogram", "noise"]);
  });

  it("무엇을 쟀는지와 잰 영역의 크기를 밝힌다 — 좌표를 읽으려면 필요하다", async () => {
    const result = await analyzeTool(setup());
    expect(result["source"]).toBe("document");
    expect(result["area"]).toHaveProperty("width");
  });
});

describe("document.analyze — 결과 검증", () => {
  /** 옛 플러그인을 흉내 낸다: 요청한 분석 하나를 오류 없이 빼고 돌려준다. */
  class OldPlugin extends MockPhotoshopBridge {
    override async executeCommand<TResult>(
      command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
    ): Promise<TResult> {
      const result = await super.executeCommand<Record<string, unknown>>(command);
      if (command.type === "DOCUMENT_ANALYZE") {
        delete result["gradient"];
      }
      return result as TResult;
    }
  }

  it("**요청한 분석이 결과에 없으면 오류다** — 서버만 새 버전일 때 조용히 사라지지 않게", async () => {
    const mcp = setup(new OldPlugin());
    await expect(analyzeTool(mcp)).rejects.toThrow(/요청한 분석이 결과에 없습니다: gradient/u);
    await expect(analyzeTool(mcp)).rejects.toThrow(/버전이 같은지/u);
  });

  it("요청하지 않은 분석이 없는 것은 오류가 아니다", async () => {
    const mcp = setup(new OldPlugin());
    await expect(analyzeTool(mcp, { analyses: ["histogram"] })).resolves.toBeDefined();
  });

  it("모양이 틀린 결과는 PROTOCOL_ERROR 다", async () => {
    class Broken extends MockPhotoshopBridge {
      override async executeCommand<TResult>(
        command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
      ): Promise<TResult> {
        if (command.type === "DOCUMENT_ANALYZE") {
          return { source: "document" } as TResult;
        }
        return super.executeCommand<TResult>(command);
      }
    }
    await expect(analyzeTool(setup(new Broken()))).rejects.toThrow(/분석 결과가 예상과 다릅니다/u);
  });
});
