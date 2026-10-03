import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/** `photoshop.layer.list_created` · `delete_created`. (ROADMAP §101) */

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

const ids = (result: Record<string, unknown>): number[] =>
  (result["layers"] as { id: number }[]).map((layer) => layer.id);

describe("세션 생성 레이어", () => {
  it("권한: list 는 read, delete 는 edit — destructive 가 아니다", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.layer.list_created")?.permission).toBe("read");
    expect(mcp.tools.get("photoshop.layer.delete_created")?.permission).toBe("edit");
  });

  it("처음에는 아무것도 만들지 않았다", async () => {
    expect(ids(await invoke(setup(), "photoshop.layer.list_created"))).toEqual([]);
  });

  it("만든 레이어만 모은다 — 원래 있던 것은 빠진다", async () => {
    const mcp = setup();
    const originals = ids(await invoke(mcp, "photoshop.layer.list"));
    const a = (await invoke(mcp, "photoshop.layer.create", { name: "A" })) as { id: number };
    const b = (await invoke(mcp, "photoshop.layer.create", { name: "B" })) as { id: number };

    const created = ids(await invoke(mcp, "photoshop.layer.list_created"));
    expect(created.sort()).toEqual([a.id, b.id].sort());
    expect(created.some((id) => originals.includes(id))).toBe(false);
  });

  it("전부 지운다 — 원래 레이어는 남는다", async () => {
    const mcp = setup();
    const originals = ids(await invoke(mcp, "photoshop.layer.list"));
    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    await invoke(mcp, "photoshop.layer.create", { name: "B" });

    const result = await invoke(mcp, "photoshop.layer.delete_created");
    expect((result["deleted"] as number[]).length).toBe(2);
    expect(ids(await invoke(mcp, "photoshop.layer.list")).sort()).toEqual([...originals].sort());
    expect(ids(await invoke(mcp, "photoshop.layer.list_created"))).toEqual([]);
  });

  it("만들지 않은 id 는 지우지 않고 notCreated 로 알린다", async () => {
    const mcp = setup();
    const originals = ids(await invoke(mcp, "photoshop.layer.list"));
    const result = await invoke(mcp, "photoshop.layer.delete_created", {
      layerIds: [originals[0]],
    });
    expect(result["deleted"]).toEqual([]);
    expect(result["notCreated"]).toEqual([originals[0]]);
    expect(ids(await invoke(mcp, "photoshop.layer.list"))).toContain(originals[0]);
  });

  it("layerIds 를 주면 그 가운데서만 지운다", async () => {
    const mcp = setup();
    const a = (await invoke(mcp, "photoshop.layer.create", { name: "A" })) as { id: number };
    const b = (await invoke(mcp, "photoshop.layer.create", { name: "B" })) as { id: number };
    const result = await invoke(mcp, "photoshop.layer.delete_created", { layerIds: [a.id] });
    expect(result["deleted"]).toEqual([a.id]);
    expect(ids(await invoke(mcp, "photoshop.layer.list_created"))).toEqual([b.id]);
  });

  it("undo 로 사라진 레이어는 목록에서 빠진다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    await invoke(mcp, "photoshop.history.undo");
    expect(ids(await invoke(mcp, "photoshop.layer.list_created"))).toEqual([]);
  });
});
