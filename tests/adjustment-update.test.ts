import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/** `photoshop.adjustment.update`. (ROADMAP §101) */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"] as never),
  });
}

const invoke = async (
  mcp: Mcp,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

const curve = (mid: number): Record<string, unknown> => ({
  points: [
    { input: 0, output: 0 },
    { input: 128, output: mid },
    { input: 255, output: 255 },
  ],
});

describe("adjustment.update", () => {
  it("권한은 edit 다", () => {
    expect(setup().tools.get("photoshop.adjustment.update")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("ADJUSTMENT_UPDATE")).toBe("edit");
  });

  it("같은 레이어의 값을 고친다 — 레이어는 늘지 않는다", async () => {
    const mcp = setup();
    const made = (await invoke(mcp, "photoshop.adjustment.curves", curve(100))) as { id: number };
    const count = ((await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] }).layers
      .length;

    const result = await invoke(mcp, "photoshop.adjustment.update", {
      layerId: made.id,
      kind: "curves",
      settings: curve(140),
    });

    expect(result["changed"]).toBe(true);
    expect((result["layer"] as { id: number }).id).toBe(made.id);
    expect(
      ((await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] }).layers.length,
    ).toBe(count);
  });

  it("같은 값을 다시 넣으면 changed 가 false 다", async () => {
    const mcp = setup();
    const made = (await invoke(mcp, "photoshop.adjustment.curves", curve(100))) as { id: number };
    const result = await invoke(mcp, "photoshop.adjustment.update", {
      layerId: made.id,
      kind: "curves",
      settings: curve(100),
    });
    expect(result["changed"]).toBe(false);
  });

  it("종류가 다르면 거절한다", async () => {
    const mcp = setup();
    const made = (await invoke(mcp, "photoshop.adjustment.curves", curve(100))) as { id: number };
    await expect(
      invoke(mcp, "photoshop.adjustment.update", {
        layerId: made.id,
        kind: "hue_saturation",
        settings: { saturation: 10 },
      }),
    ).rejects.toThrow(/종류/u);
  });

  it("조정 레이어가 아니면 거절한다", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "px" })) as { id: number };
    await expect(
      invoke(mcp, "photoshop.adjustment.update", {
        layerId: layer.id,
        kind: "curves",
        settings: curve(100),
      }),
    ).rejects.toThrow(/조정 레이어/u);
  });

  it("settings 는 만들 때와 같은 스키마로 검증한다", async () => {
    const mcp = setup();
    const made = (await invoke(mcp, "photoshop.adjustment.curves", curve(100))) as { id: number };
    await expect(
      invoke(mcp, "photoshop.adjustment.update", {
        layerId: made.id,
        kind: "curves",
        settings: { points: [{ input: 0, output: 0 }] },
      }),
    ).rejects.toThrow();
  });

  it("settings 에 name 을 쓸 수 없다", async () => {
    const mcp = setup();
    const made = (await invoke(mcp, "photoshop.adjustment.curves", curve(100))) as { id: number };
    await expect(
      invoke(mcp, "photoshop.adjustment.update", {
        layerId: made.id,
        kind: "curves",
        settings: { ...curve(100), name: "x" },
      }),
    ).rejects.toThrow(/rename/u);
  });

  it("고친 것은 history.undo 로 되돌린다", async () => {
    const mcp = setup();
    const made = (await invoke(mcp, "photoshop.adjustment.curves", curve(100))) as { id: number };
    await invoke(mcp, "photoshop.adjustment.update", {
      layerId: made.id,
      kind: "curves",
      settings: curve(140),
    });
    const undone = await invoke(mcp, "photoshop.history.undo");
    expect(typeof undone["currentState"]).toBe("string");
  });
});
