import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.layer.select_multiple`. (CORE_API §5 P1)
 *
 * `layer.select` 는 하나만 고른다. Photoshop 은 여러 장을 동시에 고를 수 있고
 * `layer.get_active` 가 그 상태를 이미 보고했다 — 읽기만 되고 쓰기가 없었다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"] as never),
  });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

describe("layer.select_multiple", () => {
  it("**edit 다**", () => {
    expect(setup().tools.get("photoshop.layer.select_multiple")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("LAYER_SELECT_MULTIPLE")).toBe("edit");
  });

  it("**layer.get_active 와 같은 모양이다**", async () => {
    /* 두 Tool 이 다른 모양을 주면 호출자가 둘을 따로 배워야 한다.
     * layer 는 서버가 layers[0] 에서 뽑는다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.select_multiple", {
      layerIds: [11, 10],
    })) as { layer: { id: number }; layers: { id: number }[] };

    expect(result.layers.map((entry) => entry.id)).toEqual([11, 10]);
    expect(result.layer.id).toBe(result.layers[0]?.id);
  });

  it("**선택이 다음 조회에 남는다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.select_multiple", { layerIds: [11, 10] });

    const active = (await invoke(mcp, "photoshop.layer.get_active")) as {
      layers: { id: number }[];
    };
    expect(active.layers.map((entry) => entry.id)).toEqual([11, 10]);
  });

  it("**다른 Command 가 활성을 바꾸면 목록이 따라간다**", async () => {
    /* Mock 이 다중 목록을 따로 들고 있어서, 동기화를 안 하면 낡은 값이 남는다.
     * 첫 번째가 활성과 다르면 버리도록 해 뒀다. */
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.select_multiple", { layerIds: [11, 10] });
    await invoke(mcp, "photoshop.layer.select", { layerId: 10 });

    const active = (await invoke(mcp, "photoshop.layer.get_active")) as {
      layers: { id: number }[];
    };
    expect(active.layers.map((entry) => entry.id)).toEqual([10]);
  });

  it("**하나라도 없으면 아무것도 선택하지 않는다**", async () => {
    /* 일부만 선택된 채로 실패하면 호출자가 무엇이 선택됐는지 모른다.
     * group.create 에서 같은 실수를 했다 — 검증은 바꾸기 전에 한다. */
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer.get_active")) as {
      layers: { id: number }[];
    };

    await expect(
      invoke(mcp, "photoshop.layer.select_multiple", { layerIds: [10, 999] }),
    ).rejects.toThrow(/999/u);

    const after = (await invoke(mcp, "photoshop.layer.get_active")) as {
      layers: { id: number }[];
    };
    expect(after.layers).toEqual(before.layers);
  });

  it("같은 id 를 두 번 주면 거절한다", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.select_multiple", { layerIds: [10, 10] }),
    ).rejects.toThrow();
  });

  it("빈 배열은 거절한다", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.select_multiple", { layerIds: [] }),
    ).rejects.toThrow();
  });
});
