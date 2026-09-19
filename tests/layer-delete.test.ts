import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 레이어 삭제. (ROADMAP §17.18)
 *
 * CORE_API §8 이 처음부터 `DESTRUCTIVE` 로 분류해 두고 구현은 미뤄 둔 것이다.
 * 실기에서 세 번 아쉬웠다 — 시험용 레이어가 문서에 열 장 넘게 쌓였다.
 */

function setup(
  allow: string[] = ["read", "edit", "destructive"],
): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

const layerIds = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number[]> => {
  const { layers } = (await invoke(mcp, "photoshop.layer.list")) as { layers: { id: number }[] };
  return layers.map((entry) => entry.id);
};

describe("레이어 삭제", () => {
  it("**destructive 다**", () => {
    // 되돌리기로 살릴 수는 있지만 작업을 없애는 것이 목적인 Command 다.
    // CORE_API §8 이 미리 정해 둔 분류를 따른다.
    expect(setup().tools.get("photoshop.layer.delete")?.permission).toBe("destructive");
  });

  it("기본 권한에서는 막힌다", async () => {
    // 기본은 read · edit 뿐이다. 사용자가 PHOTOSHOP_MCP_ALLOW 로 켜야 한다.
    const mcp = setup(["read", "edit"]);
    await expect(invoke(mcp, "photoshop.layer.delete", { layerIds: [1] })).rejects.toThrow(
      /권한|permission/iu,
    );
  });

  it("지운다", async () => {
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.layer.create", { name: "Temp" })) as {
      id: number;
    };
    const result = await invoke(mcp, "photoshop.layer.delete", { layerIds: [created.id] });
    expect(result["deleted"]).toEqual([created.id]);
    expect(await layerIds(mcp)).not.toContain(created.id);
  });

  it("여러 개를 한 번에 지운다", async () => {
    const mcp = setup();
    const before = (await layerIds(mcp)).length;
    const ids: number[] = [];
    for (const name of ["A", "B", "C"]) {
      ids.push(((await invoke(mcp, "photoshop.layer.create", { name })) as { id: number }).id);
    }
    const result = await invoke(mcp, "photoshop.layer.delete", { layerIds: ids });
    expect(result["deleted"]).toEqual(expect.arrayContaining(ids));
    // 만든 만큼 지웠으니 원래 수로 돌아와야 한다.
    expect(result["remaining"]).toBe(before);
  });

  it("**전부 지우려 하면 거절한다**", async () => {
    // Photoshop 은 빈 문서를 허용하지 않는다. 그대로 보내면 마지막 하나에서
    // 알 수 없는 메시지로 실패한다.
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.layer.delete", { layerIds: await layerIds(mcp) }),
    ).rejects.toThrow(/전부 지울 수는 없습니다/u);
  });

  it("없는 id 는 이유와 함께 failed 에 담는다", async () => {
    // 조용히 성공으로 보고하면 호출자는 지워졌다고 믿는다.
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.layer.create", { name: "Temp" })) as {
      id: number;
    };
    const result = await invoke(mcp, "photoshop.layer.delete", {
      layerIds: [created.id, 9999],
    });
    expect(result["deleted"]).toEqual([created.id]);
    expect(result["failed"]).toEqual([{ id: 9999, reason: expect.stringContaining("찾을 수 없") }]);
  });

  it("빈 목록을 거절한다", async () => {
    await expect(invoke(setup(), "photoshop.layer.delete", { layerIds: [] })).rejects.toThrow(
      /layerIds/u,
    );
  });

  it("**패턴을 받지 않는다**", async () => {
    // 별표 한 줄이 사용자의 작업을 지울 수 있다. id 만 받는다.
    // (workspace.delete 와 같은 규칙)
    await expect(
      invoke(setup(), "photoshop.layer.delete", { namePattern: "ZZ_*" }),
    ).rejects.toThrow();
  });

  it("되돌릴 수 있다", async () => {
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.layer.create", { name: "Temp" })) as {
      id: number;
    };
    await invoke(mcp, "photoshop.layer.delete", { layerIds: [created.id] });
    await invoke(mcp, "photoshop.history.undo");
    expect(await layerIds(mcp)).toContain(created.id);
  });
});
