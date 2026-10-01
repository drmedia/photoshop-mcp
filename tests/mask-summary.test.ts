import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { MaskSummaryParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.mask.summary`. (ROADMAP §97)
 *
 * 계산은 `mask-coverage.test.ts` 가 합성 마스크로 시험한다. 여기서는 **배선**을 본다 — 파라미터 ·
 * 마스크 없는 레이어 · Mock 의 정직한 실패 · 결과 검증.
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

/**
 * 마스크가 붙은 조정 레이어의 id.
 *
 * 실제 Photoshop 의 조정 레이어는 마스크가 붙은 채 생기지만 Mock 은 그렇게 모델링하지 않는다.
 * 그래서 마스크를 명시적으로 만든다 — Mock 에 맞춰 단언을 느슨하게 하지 않는다.
 */
async function adjustmentWithMask(mcp: Mcp): Promise<number> {
  await invoke(mcp, "photoshop.adjustment.curves", {
    points: [
      { input: 0, output: 0 },
      { input: 255, output: 255 },
    ],
  });
  const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
    layers: { id: number; type: string }[];
  };
  const found = layers.find((entry) => entry.type === "adjustment");
  expect(found, "조정 레이어가 만들어졌다").toBeDefined();
  const id = (found as { id: number }).id;
  await invoke(mcp, "photoshop.mask.create", { layerId: id, from: "revealAll" });
  const after = (await invoke(mcp, "photoshop.layer.list")) as {
    layers: { id: number; hasMask?: boolean }[];
  };
  expect(after.layers.find((entry) => entry.id === id)?.hasMask, "마스크가 붙었다").toBe(true);
  return id;
}

/** 실기에서 받을 법한 정상 응답. 격자 8×12 = 짧은 변 8 타일. */
function plausibleSummary(layer: unknown): Record<string, unknown> {
  const tiles = Array.from({ length: 12 }, () => Array.from({ length: 8 }, () => 50));
  return {
    layer,
    source: "mask:9",
    area: { width: 4024, height: 6048 },
    hiddenPercent: 58.3,
    revealedPercent: 5.3,
    partialPercent: 36.4,
    meanPercent: 40.1,
    touched: { left: 0, top: 0, right: 4024, bottom: 5000 },
    full: { left: 100, top: 200, right: 1000, bottom: 3000 },
    grid: { cols: 8, rows: 12 },
    tiles,
    elapsedMs: 1200,
  };
}

describe("mask.summary — 파라미터", () => {
  it("읽기 전용이다", () => {
    expect(setup().tools.get("photoshop.mask.summary")?.permission).toBe("read");
  });

  it("layerId 는 양의 정수, grid 는 4–16, 모르는 키는 거절한다", () => {
    const parse = (value: Record<string, unknown>): boolean =>
      MaskSummaryParamsSchema.safeParse(value).success;
    expect(parse({})).toBe(true);
    expect(parse({ layerId: 5, grid: 8 })).toBe(true);
    expect(parse({ layerId: 0 })).toBe(false);
    expect(parse({ grid: 3 })).toBe(false);
    expect(parse({ grid: 17 })).toBe(false);
    expect(parse({ bogus: 1 })).toBe(false);
  });
});

describe("mask.summary — 대상", () => {
  it("없는 레이어는 거절한다", async () => {
    await expect(invoke(setup(), "photoshop.mask.summary", { layerId: 9999 })).rejects.toThrow(
      /찾을 수 없습니다/u,
    );
  });

  it("**마스크가 없는 레이어는 거절한다** — 없는 마스크를 전부 보임으로 요약하지 않는다", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "Plain" })) as {
      id: number;
    };
    await expect(invoke(mcp, "photoshop.mask.summary", { layerId: layer.id })).rejects.toThrow(
      /마스크가 없습니다/u,
    );
  });

  it("**Mock 은 비율을 지어내지 않고 실패한다** — 마스크 픽셀을 모른다", async () => {
    const mcp = setup();
    const id = await adjustmentWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.summary", { layerId: id })).rejects.toThrow(
      /Mock Bridge 는 마스크 픽셀을 읽지 않아/u,
    );
  });
});

describe("mask.summary — 결과 검증", () => {
  /** 플러그인이 `mutate` 한 결과를 돌려주는 가짜. */
  function pluginReturning(
    mutate: (summary: Record<string, unknown>) => void,
  ): MockPhotoshopBridge {
    class Plugin extends MockPhotoshopBridge {
      override async executeCommand<TResult>(
        command: Parameters<MockPhotoshopBridge["executeCommand"]>[0],
      ): Promise<TResult> {
        if (command.type === "MASK_SUMMARY") {
          const layerId = (command.params as { layerId?: number }).layerId;
          const layers = await super.executeCommand<{ id: number }[]>({
            type: "LAYER_LIST",
            params: {},
          });
          const layer = layers.find((entry) => entry.id === layerId) ?? layers[0];
          const summary = plausibleSummary(layer);
          mutate(summary);
          return summary as TResult;
        }
        return super.executeCommand<TResult>(command);
      }
    }
    return new Plugin();
  }

  it("정상 응답은 그대로 통과한다", async () => {
    const mcp = setup(pluginReturning(() => undefined));
    const id = await adjustmentWithMask(mcp);
    const result = await invoke(mcp, "photoshop.mask.summary", { layerId: id });
    expect(result["hiddenPercent"]).toBe(58.3);
    expect(result["full"]).toEqual({ left: 100, top: 200, right: 1000, bottom: 3000 });
    expect((result["tiles"] as number[][]).length).toBe(12);
  });

  it("**타일 표의 행 수가 격자와 다르면 PROTOCOL_ERROR 다** — 좌표를 잘못 읽게 하지 않는다", async () => {
    const mcp = setup(
      pluginReturning((summary) => {
        summary["tiles"] = (summary["tiles"] as number[][]).slice(0, 11);
      }),
    );
    const id = await adjustmentWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.summary", { layerId: id })).rejects.toThrow(
      /격자.*다릅니다/u,
    );
  });

  it("타일 한 행의 열 수가 다르면 PROTOCOL_ERROR 다", async () => {
    const mcp = setup(
      pluginReturning((summary) => {
        (summary["tiles"] as number[][])[3] = [1, 2, 3];
      }),
    );
    const id = await adjustmentWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.summary", { layerId: id })).rejects.toThrow(
      /격자.*다릅니다/u,
    );
  });

  it("비율의 합이 100 이 아니면 PROTOCOL_ERROR 다", async () => {
    const mcp = setup(
      pluginReturning((summary) => {
        summary["partialPercent"] = 10;
      }),
    );
    const id = await adjustmentWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.summary", { layerId: id })).rejects.toThrow(
      /합이 100/u,
    );
  });

  it("비율이 범위(0–100)를 벗어나면 모양이 틀린 결과다", async () => {
    const mcp = setup(
      pluginReturning((summary) => {
        summary["hiddenPercent"] = 150;
      }),
    );
    const id = await adjustmentWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.summary", { layerId: id })).rejects.toThrow(
      /예상과 다릅니다/u,
    );
  });

  it("경계 상자가 null 이어도 통과한다 — 효과가 닿는 곳이 없는 마스크", async () => {
    const mcp = setup(
      pluginReturning((summary) => {
        summary["hiddenPercent"] = 100;
        summary["revealedPercent"] = 0;
        summary["partialPercent"] = 0;
        summary["meanPercent"] = 0;
        summary["touched"] = null;
        summary["full"] = null;
      }),
    );
    const id = await adjustmentWithMask(mcp);
    const result = await invoke(mcp, "photoshop.mask.summary", { layerId: id });
    expect(result["touched"]).toBeNull();
    expect(result["full"]).toBeNull();
  });
});
