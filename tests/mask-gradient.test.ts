import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 마스크 그라디언트. (ROADMAP §17.8, §17.22)
 *
 * Mock 에는 픽셀이 없어 마스크의 **모양**은 여기서 검증되지 않는다. 방사형이
 * 정말 방사형인지는 실기에서 재야 한다. 여기서 고정하는 것은 계약이다 —
 * 어떤 입력을 받고 무엇을 거절하는가.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"]),
  });
}

/** 마스크가 있는 조정 레이어를 하나 만들어 돌려준다. */
async function layerWithMask(mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> {
  const layer = (await mcp.tools.invoke(
    "photoshop.adjustment.curves",
    {
      name: "T",
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 200 },
      ],
    },
    { requestId: "r" },
  )) as LayerInfo;
  await mcp.tools.invoke(
    "photoshop.mask.create",
    { layerId: layer.id, from: "revealAll" },
    { requestId: "r" },
  );
  return layer.id;
}

const gradient = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  args: Record<string, unknown>,
): Promise<LayerInfo> =>
  (await mcp.tools.invoke("photoshop.mask.gradient", args, { requestId: "r" })) as LayerInfo;

describe("마스크 그라디언트", () => {
  it("type 을 생략하면 동작한다 — 기본은 linear", async () => {
    const mcp = setup();
    const layerId = await layerWithMask(mcp);
    const result = await gradient(mcp, {
      layerId,
      from: { x: 0, y: 0 },
      to: { x: 1000, y: 0 },
    });
    expect(result.hasMask).toBe(true);
  });

  it("**radial 을 받는다**", async () => {
    const mcp = setup();
    const layerId = await layerWithMask(mcp);
    const result = await gradient(mcp, {
      layerId,
      type: "radial",
      from: { x: 500, y: 500 },
      to: { x: 1500, y: 500 },
      reverse: true,
    });
    expect(result.hasMask).toBe(true);
  });

  it("모르는 type 은 거절한다", async () => {
    // angle · reflected · diamond 는 일부러 넣지 않았다. 조용히 linear 로
    // 떨어뜨리면 호출자는 방사형이 걸린 줄 안다.
    const mcp = setup();
    const layerId = await layerWithMask(mcp);
    await expect(
      gradient(mcp, { layerId, type: "angle", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }),
    ).rejects.toThrow();
  });

  describe("길이가 0 이면 거절한다", () => {
    it("linear", async () => {
      // Photoshop 은 조용히 아무것도 하지 않을 수 있다.
      const mcp = setup();
      const layerId = await layerWithMask(mcp);
      await expect(
        gradient(mcp, { layerId, from: { x: 100, y: 100 }, to: { x: 100, y: 100 } }),
      ).rejects.toThrow(/길이/u);
    });

    it("**radial 은 반지름이라고 말한다**", async () => {
      // 같은 제약이지만 호출자가 고칠 곳이 다르다. linear 는 방향을,
      // radial 은 크기를 잘못 준 것이다.
      const mcp = setup();
      const layerId = await layerWithMask(mcp);
      await expect(
        gradient(mcp, {
          layerId,
          type: "radial",
          from: { x: 100, y: 100 },
          to: { x: 100, y: 100 },
        }),
      ).rejects.toThrow(/반지름/u);
    });
  });

  it("마스크가 없으면 무엇을 하라고 말한다", async () => {
    // "명령을 사용할 수 없습니다" 만으로는 원인을 알 수 없다.
    const mcp = setup();
    const layer = (await mcp.tools.invoke(
      "photoshop.adjustment.curves",
      {
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 200 },
        ],
      },
      { requestId: "r" },
    )) as LayerInfo;

    await expect(
      gradient(mcp, {
        layerId: layer.id,
        type: "radial",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      }),
    ).rejects.toThrow(/mask\.create/u);
  });

  it("음수 좌표를 거절한다", async () => {
    const mcp = setup();
    const layerId = await layerWithMask(mcp);
    await expect(
      gradient(mcp, { layerId, type: "radial", from: { x: -1, y: 0 }, to: { x: 100, y: 0 } }),
    ).rejects.toThrow();
  });
});
