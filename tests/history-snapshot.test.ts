import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.history.create_snapshot` · `restore_snapshot` · `list_snapshots`. (ROADMAP §101)
 *
 * History 상태 참조가 아니라 **이름 붙은 스냅샷**이다 — History 는 50개만 들고 있다.
 */

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

const layerCount = async (mcp: Mcp): Promise<number> =>
  ((await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] }).layers.length;

describe("history 스냅샷", () => {
  it("권한: 만들기·돌아가기는 edit, 목록은 read", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.history.create_snapshot")?.permission).toBe("edit");
    expect(mcp.tools.get("photoshop.history.restore_snapshot")?.permission).toBe("edit");
    expect(mcp.tools.get("photoshop.history.list_snapshots")?.permission).toBe("read");
    expect(mcp.commands.permissionOf("HISTORY_CREATE_SNAPSHOT")).toBe("edit");
    expect(mcp.commands.permissionOf("HISTORY_RESTORE_SNAPSHOT")).toBe("edit");
    expect(mcp.commands.permissionOf("HISTORY_LIST_SNAPSHOTS")).toBe("read");
  });

  it("만든 시점으로 돌아간다 — 뒤에 만든 레이어가 사라진다", async () => {
    const mcp = setup();
    const before = await layerCount(mcp);
    await invoke(mcp, "photoshop.history.create_snapshot", { name: "base" });

    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    await invoke(mcp, "photoshop.layer.create", { name: "B" });
    expect(await layerCount(mcp)).toBe(before + 2);

    const restored = await invoke(mcp, "photoshop.history.restore_snapshot", { name: "base" });
    expect(await layerCount(mcp)).toBe(before);
    expect(restored["layerIdsMatch"]).toBe(true);
  });

  it("돌아간 뒤에도 스냅샷이 남아 다시 돌아갈 수 있다", async () => {
    const mcp = setup();
    const before = await layerCount(mcp);
    await invoke(mcp, "photoshop.history.create_snapshot", { name: "base" });

    for (let round = 0; round < 2; round += 1) {
      await invoke(mcp, "photoshop.layer.create", { name: `L${round}` });
      await invoke(mcp, "photoshop.history.restore_snapshot", { name: "base" });
      expect(await layerCount(mcp)).toBe(before);
    }
  });

  it("같은 이름은 덮어쓰지 않고 거절한다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.history.create_snapshot", { name: "base" });
    await expect(
      invoke(mcp, "photoshop.history.create_snapshot", { name: "base" }),
    ).rejects.toThrow();
  });

  it("모르는 이름은 거절한다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.history.create_snapshot", { name: "base" });
    await expect(
      invoke(mcp, "photoshop.history.restore_snapshot", { name: "nope" }),
    ).rejects.toThrow();
  });

  it("빈 이름 · 줄바꿈이 든 이름은 스키마가 거절한다", async () => {
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.history.create_snapshot", { name: "   " }),
    ).rejects.toThrow();
    await expect(
      invoke(mcp, "photoshop.history.create_snapshot", { name: "a\nb" }),
    ).rejects.toThrow();
  });

  it("목록은 만든 것만 담는다", async () => {
    const mcp = setup();
    expect(((await invoke(mcp, "photoshop.history.list_snapshots")) as { snapshots: unknown[] }).snapshots).toEqual([]);

    await invoke(mcp, "photoshop.history.create_snapshot", { name: "one" });
    await invoke(mcp, "photoshop.history.create_snapshot", { name: "two" });
    const listed = (await invoke(mcp, "photoshop.history.list_snapshots")) as {
      snapshots: { name: string }[];
    };
    expect(listed.snapshots.map((s) => s.name)).toEqual(["one", "two"]);
  });
});
