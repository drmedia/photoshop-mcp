import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  DEFAULT_MOCK_DOCUMENT,
  MockPhotoshopBridge,
  PermissionPolicy,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 색 칠하기와 마스크 칠하기. (ROADMAP §17.32)
 *
 * Mock 에는 픽셀이 없으므로 실제로 칠하는 경로는 여기서 검증되지 않는다.
 * 고정하는 것은 **무엇을 거절하는가** 다 — 두 Command 에서 위험하거나
 * 헷갈리는 자리가 거기다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const DAB = { x: 100, y: 100, radius: 50, strength: 15 };
const COLOR = { red: 200, green: 120, blue: 40 };

const paint = async (mcp: Mcp, args: Record<string, unknown>): Promise<unknown> =>
  mcp.tools.invoke("photoshop.paint.dab", args, { requestId: "r" });

const maskDab = async (mcp: Mcp, args: Record<string, unknown>): Promise<unknown> =>
  mcp.tools.invoke("photoshop.mask.dab", args, { requestId: "r" });

/** 배경이 아닌 빈 픽셀 레이어. */
async function pixelLayer(mcp: Mcp): Promise<number> {
  const created = (await mcp.tools.invoke(
    "photoshop.layer.create",
    { name: "칠하기" },
    { requestId: "r" },
  )) as { id: number };
  return created.id;
}

/** 마스크가 달린 레이어. */
async function maskedLayer(mcp: Mcp): Promise<number> {
  const id = await pixelLayer(mcp);
  await mcp.tools.invoke("photoshop.mask.create", { layerId: id }, { requestId: "r" });
  return id;
}

describe("permission", () => {
  it("둘 다 edit 이다", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.paint.dab")?.permission).toBe("edit");
    expect(mcp.tools.get("photoshop.mask.dab")?.permission).toBe("edit");
  });

  it("읽기 전용 서버에서는 막힌다", async () => {
    await expect(paint(setup(["read"]), { dabs: [DAB], color: COLOR })).rejects.toThrow(
      /권한|permission/iu,
    );
    await expect(maskDab(setup(["read"]), { dabs: [DAB], mode: "reveal" })).rejects.toThrow(
      /권한|permission/iu,
    );
  });
});

describe("paint.dab — **원본을 지킨다**", () => {
  it("배경 레이어를 거절한다", async () => {
    // 픽셀을 덮어쓰므로 배경에 칠하면 되돌릴 수 없다.
    await expect(paint(setup(), { dabs: [DAB], color: COLOR })).rejects.toThrow(/배경 레이어/u);
  });

  it("무엇을 하라고 말한다", async () => {
    await expect(paint(setup(), { dabs: [DAB], color: COLOR })).rejects.toThrow(/layer\.create/u);
  });

  it("빈 픽셀 레이어에는 칠한다", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    const result = (await paint(mcp, { dabs: [DAB], color: COLOR, layerId })) as {
      applied: number;
    };
    expect(result.applied).toBe(1);
  });

  it("**마스크에 칠하려면 다른 Tool 이라고 알려준다**", async () => {
    // 이름이 비슷해 헷갈리기 쉽다. 오류가 길을 가리켜야 한다.
    const mcp = setup();
    await mcp.tools.invoke(
      "photoshop.adjustment.curves",
      {
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 255 },
        ],
      },
      { requestId: "r" },
    );
    const active = (await mcp.tools.invoke(
      "photoshop.layer.get_active",
      {},
      { requestId: "r" },
    )) as {
      id: number;
    };
    await expect(paint(mcp, { dabs: [DAB], color: COLOR, layerId: active.id })).rejects.toThrow(
      /mask\.dab/u,
    );
  });
});

describe("mask.dab — **마스크가 있어야 한다**", () => {
  it("마스크가 없으면 거절한다", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    await expect(maskDab(mcp, { dabs: [DAB], mode: "reveal", layerId })).rejects.toThrow(
      /마스크가 없습니다/u,
    );
  });

  it("어떻게 만드는지 말한다", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    await expect(maskDab(mcp, { dabs: [DAB], mode: "reveal", layerId })).rejects.toThrow(
      /mask\.create|hasMask/u,
    );
  });

  it("마스크가 있으면 칠한다", async () => {
    const mcp = setup();
    const layerId = await maskedLayer(mcp);
    const result = (await maskDab(mcp, { dabs: [DAB], mode: "hide", layerId })) as {
      applied: number;
    };
    expect(result.applied).toBe(1);
  });

  it("**reveal · hide 로 받는다**", async () => {
    // white/black 으로 두면 호출자가 매번 어느 쪽이 보이는 쪽인지 되짚어야 한다.
    const mcp = setup();
    const layerId = await maskedLayer(mcp);
    await expect(maskDab(mcp, { dabs: [DAB], mode: "white", layerId })).rejects.toThrow();
    await expect(maskDab(mcp, { dabs: [DAB], mode: "reveal", layerId })).resolves.toBeDefined();
  });
});

describe("공통", () => {
  it("여러 얼룩을 한 번에 받는다", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    const result = (await paint(mcp, {
      dabs: [DAB, { ...DAB, x: 300 }, { ...DAB, y: 400 }],
      color: COLOR,
      layerId,
    })) as { applied: number };
    expect(result.applied).toBe(3);
  });

  it("**선택을 남기지 않는다**", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    await paint(mcp, { dabs: [DAB], color: COLOR, layerId });
    const state = (await mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" })) as {
      selection?: { hasSelection?: boolean };
    };
    expect(state.selection?.hasSelection ?? false).toBe(false);
  });

  it("문서 밖 얼룩을 거절한다", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    const outside = DEFAULT_MOCK_DOCUMENT.width + 500;
    await expect(
      paint(mcp, { dabs: [{ ...DAB, x: outside }], color: COLOR, layerId }),
    ).rejects.toThrow(/문서|밖/u);
  });
});

describe("스키마", () => {
  it("색 범위를 지킨다", async () => {
    const mcp = setup();
    const layerId = await pixelLayer(mcp);
    await expect(
      paint(mcp, { dabs: [DAB], color: { red: 256, green: 0, blue: 0 }, layerId }),
    ).rejects.toThrow();
    await expect(
      paint(mcp, { dabs: [DAB], color: { red: -1, green: 0, blue: 0 }, layerId }),
    ).rejects.toThrow();
  });

  it("색을 요구한다", async () => {
    await expect(paint(setup(), { dabs: [DAB] })).rejects.toThrow();
  });

  it("mask.dab 은 색을 받지 않는다", async () => {
    // 마스크는 회색조다. 색을 받으면 무시되는데 호출자는 통과한 줄 안다.
    const mcp = setup();
    const layerId = await maskedLayer(mcp);
    await expect(
      maskDab(mcp, { dabs: [DAB], mode: "reveal", color: COLOR, layerId }),
    ).rejects.toThrow();
  });

  it("빈 목록을 거절한다", async () => {
    await expect(paint(setup(), { dabs: [], color: COLOR })).rejects.toThrow();
    await expect(maskDab(setup(), { dabs: [], mode: "reveal" })).rejects.toThrow();
  });
});
