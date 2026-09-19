import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 레이어 순서 변경. (ROADMAP §17.23)
 *
 * §17.9 가 "아직 없다" 고 적어 둔 자리다. 실기 보정에서 채도 레이어가 그룹에
 * 갇힌 것을 꺼낼 때 `group.move_layer` 로 우회했다 — 그것은 "그룹에서 꺼낸다"
 * 는 뜻의 API 이고 놓이는 자리는 부수 효과였다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"]),
  });
}

interface ReorderResult {
  layer: LayerInfo;
  moved: boolean;
  previousIndex: number;
  index: number;
  siblings: number;
}

const reorder = async (mcp: Mcp, args: Record<string, unknown>): Promise<ReorderResult> =>
  (await mcp.tools.invoke("photoshop.layer.reorder", args, { requestId: "r" })) as ReorderResult;

const listing = async (mcp: Mcp): Promise<LayerInfo[]> =>
  (
    (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: LayerInfo[];
    }
  ).layers;

/** 조정 레이어 셋을 만들고 위에서부터의 id 를 돌려준다. */
async function threeLayers(mcp: Mcp): Promise<number[]> {
  const ids: number[] = [];
  for (const name of ["A", "B", "C"]) {
    const layer = (await mcp.tools.invoke(
      "photoshop.adjustment.curves",
      {
        name,
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 200 },
        ],
      },
      { requestId: "r" },
    )) as LayerInfo;
    ids.push(layer.id);
  }
  // 나중에 만든 것이 위에 쌓인다.
  return ids.reverse();
}

describe("레이어 순서 변경", () => {
  it("edit 이다", () => {
    expect(setup().tools.get("photoshop.layer.reorder")?.permission).toBe("edit");
  });

  describe("같은 부모 안에서", () => {
    it("한 칸 아래로 내린다", async () => {
      const mcp = setup();
      const [top] = await threeLayers(mcp);
      const result = await reorder(mcp, { layerId: top, placement: "down" });
      expect(result.moved).toBe(true);
      expect(result.previousIndex).toBe(0);
      expect(result.index).toBe(1);
    });

    it("한 칸 위로 올린다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      const result = await reorder(mcp, { layerId: ids[2] as number, placement: "up" });
      expect(result.previousIndex).toBe(2);
      expect(result.index).toBe(1);
    });

    it("**맨 위로 올린다**", async () => {
      // 실기에서 필요했던 바로 그 동작이다.
      const mcp = setup();
      const ids = await threeLayers(mcp);
      const result = await reorder(mcp, { layerId: ids[2] as number, placement: "top" });
      expect(result.index).toBe(0);
      expect((await listing(mcp))[0]?.id).toBe(ids[2]);
    });

    it("맨 아래로 내린다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      const result = await reorder(mcp, { layerId: ids[0] as number, placement: "bottom" });
      expect(result.index).toBe(result.siblings - 1);
    });
  });

  describe("이미 그 자리면", () => {
    it("**실패가 아니라 moved: false 다**", async () => {
      // 오류로 두면 호출자가 매번 현재 위치를 확인해야 한다.
      const mcp = setup();
      const [top] = await threeLayers(mcp);
      const result = await reorder(mcp, { layerId: top as number, placement: "up" });
      expect(result.moved).toBe(false);
      expect(result.index).toBe(result.previousIndex);
    });

    it("top 을 두 번 해도 조용히 성공한다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      await reorder(mcp, { layerId: ids[2] as number, placement: "top" });
      expect((await reorder(mcp, { layerId: ids[2] as number, placement: "top" })).moved).toBe(
        false,
      );
    });
  });

  describe("above · below", () => {
    it("기준 레이어 아래로 옮긴다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      const result = await reorder(mcp, {
        layerId: ids[0] as number,
        placement: "below",
        referenceId: ids[2] as number,
      });
      expect(result.index).toBeGreaterThan(result.previousIndex);
    });

    it("referenceId 가 없으면 거절한다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      await expect(reorder(mcp, { layerId: ids[0] as number, placement: "above" })).rejects.toThrow(
        /referenceId/u,
      );
    });

    it("**쓰지 않는 placement 에 주면 거절한다**", async () => {
      // 조용히 무시하면 호출자는 기준이 쓰인 줄 안다.
      const mcp = setup();
      const ids = await threeLayers(mcp);
      await expect(
        reorder(mcp, {
          layerId: ids[0] as number,
          placement: "top",
          referenceId: ids[1] as number,
        }),
      ).rejects.toThrow(/referenceId/u);
    });

    it("자기 자신을 기준으로 삼을 수 없다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      await expect(
        reorder(mcp, {
          layerId: ids[0] as number,
          placement: "above",
          referenceId: ids[0] as number,
        }),
      ).rejects.toThrow(/자기 자신/u);
    });

    it("없는 기준을 거절한다", async () => {
      const mcp = setup();
      const ids = await threeLayers(mcp);
      await expect(
        reorder(mcp, { layerId: ids[0] as number, placement: "above", referenceId: 9999 }),
      ).rejects.toThrow(/9999/u);
    });
  });

  it("없는 레이어를 거절한다", async () => {
    await expect(reorder(setup(), { layerId: 9999, placement: "top" })).rejects.toThrow(/9999/u);
  });

  it("**배경 레이어는 움직이지 않는다**", async () => {
    // Photoshop 이 맨 아래에 고정한다. 성공으로 보고하면 호출자는 올라간 줄 안다.
    const mcp = setup();
    const background = (await listing(mcp)).find((layer) => layer.isBackground === true);
    expect(background).toBeDefined();

    const result = await reorder(mcp, { layerId: background?.id ?? 0, placement: "top" });
    expect(result.moved).toBe(false);
  });

  it("되돌릴 수 있다", async () => {
    const mcp = setup();
    const ids = await threeLayers(mcp);
    const before = (await listing(mcp)).map((layer) => layer.id);

    await reorder(mcp, { layerId: ids[0] as number, placement: "bottom" });
    await mcp.tools.invoke("photoshop.history.undo", {}, { requestId: "r" });

    expect((await listing(mcp)).map((layer) => layer.id)).toEqual(before);
  });
});
