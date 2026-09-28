import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.history.redo`. (CORE_API §5 P1)
 *
 * `undo` 의 거울이다. **되돌린 뒤 새로 편집하면 앞쪽 이력이 사라진다** —
 * Photoshop 의 동작이고 Mock 도 그것을 흉내낸다. (ROADMAP §34)
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

const layerCount = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> =>
  ((await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] }).layers.length;

describe("history.redo", () => {
  it("**edit 다** — 되돌린 것을 다시 놓을 뿐 잃는 것이 없다", () => {
    expect(setup().tools.get("photoshop.history.redo")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("HISTORY_REDO")).toBe("edit");
  });

  it("**undo 를 되돌린다**", async () => {
    const mcp = setup();
    const before = await layerCount(mcp);

    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    expect(await layerCount(mcp)).toBe(before + 1);

    await invoke(mcp, "photoshop.history.undo");
    expect(await layerCount(mcp)).toBe(before);

    await invoke(mcp, "photoshop.history.redo");
    expect(await layerCount(mcp)).toBe(before + 1);
  });

  it("**결과 모양이 undo 와 같다**", async () => {
    /* 둘을 따로 배우게 하지 않는다. */
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    const undone = (await invoke(mcp, "photoshop.history.undo")) as Record<string, unknown>;
    const redone = (await invoke(mcp, "photoshop.history.redo")) as Record<string, unknown>;

    expect(Object.keys(redone)).toEqual(Object.keys(undone));
    expect(typeof redone["currentState"]).toBe("string");
  });

  it("**다시 실행할 것이 없으면 실패한다**", async () => {
    /* 아무 일도 안 하고 성공을 돌려주면 호출자가 한 단계 갔다고 믿는다 —
     * 이 프로젝트가 반복해서 겪은 "조용한 실패" 다. */
    await expect(invoke(setup(), "photoshop.history.redo")).rejects.toThrow();
  });

  /**
   * **새 편집을 하면 앞쪽 이력이 사라진다.** Photoshop 이 그렇게 한다.
   * Mock 이 흉내내지 않으면 "되돌리고 편집한 뒤에도 redo 가 된다" 는 있을 수
   * 없는 상태가 테스트에서 정상으로 보인다.
   */
  it("**되돌린 뒤 새로 편집하면 redo 가 사라진다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    await invoke(mcp, "photoshop.history.undo");

    await invoke(mcp, "photoshop.layer.create", { name: "B" });

    await expect(invoke(mcp, "photoshop.history.redo")).rejects.toThrow();
  });

  it("**다시 실행한 것은 또 되돌릴 수 있다**", async () => {
    const mcp = setup();
    const before = await layerCount(mcp);

    await invoke(mcp, "photoshop.layer.create", { name: "A" });
    await invoke(mcp, "photoshop.history.undo");
    await invoke(mcp, "photoshop.history.redo");
    await invoke(mcp, "photoshop.history.undo");

    expect(await layerCount(mcp)).toBe(before);
  });

  it("**인자를 받지 않는다**", async () => {
    await expect(invoke(setup(), "photoshop.history.redo", { steps: 2 })).rejects.toThrow();
  });
});
