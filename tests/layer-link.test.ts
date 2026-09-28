import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { LayerLinkParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.layer.link` · `photoshop.layer.unlink`. (CORE_API §5)
 *
 * 연결된 레이어들은 **함께 움직이고 함께 변형된다.** 그룹과 다르다 — 트리
 * 구조가 바뀌지 않는다. (ROADMAP §48)
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

describe("layer.link / unlink", () => {
  it("**둘 다 edit 다** — 픽셀을 건드리지 않는다", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("LAYER_LINK")).toBe("edit");
    expect(mcp.commands.permissionOf("LAYER_UNLINK")).toBe("edit");
  });

  it("**자기 자신과는 연결할 수 없다**", async () => {
    /* 통과시키면 Photoshop 이 무엇을 하는지 알 수 없고 호출자가 얻는 것도 없다. */
    await expect(
      invoke(setup(), "photoshop.layer.link", { layerId: 11, targetId: 11 }),
    ).rejects.toThrow(/자기 자신/);
  });

  it("**없는 대상은 실패한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.link", { layerId: 11, targetId: 9999 }),
    ).rejects.toThrow();
  });

  it("**targetId 는 필수다**", () => {
    expect(LayerLinkParamsSchema.safeParse({ layerId: 11 }).success).toBe(false);
    expect(LayerLinkParamsSchema.safeParse({ layerId: 11, targetId: 12 }).success).toBe(true);
  });

  /**
   * **`linked` 는 읽은 값이다.** 요청을 되풀이한 것이 아니라 `linkedLayers`
   * 를 읽어 담으므로 실제로 무엇이 묶였는지 여기서 확인한다.
   */
  it("**연결하면 상대가 목록에 들어온다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.link", {
      layerId: 11,
      targetId: 12,
    })) as { linked: number[] };

    expect(result.linked).toContain(12);
    expect(result.linked).not.toContain(11);
  });

  /** **연결은 전이적이다.** 셋을 묶으면 셋이 서로 묶인다. */
  it("**셋을 묶으면 서로 보인다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.link", { layerId: 11, targetId: 12 });
    const third = (await invoke(mcp, "photoshop.layer.link", {
      layerId: 11,
      targetId: 10,
    })) as { linked: number[] };

    expect(third.linked.sort()).toEqual([10, 12]);

    const other = (await invoke(mcp, "photoshop.layer.get", { layerId: 12 })) as {
      linkedLayerIds: number[];
    };
    expect(other.linkedLayerIds.sort()).toEqual([10, 11]);
  });

  /**
   * **`unlink` 는 그 레이어만 뺀다.** 집합 전체를 푸는 것이 아니다 — 셋이
   * 묶여 있었다면 나머지 둘은 그대로다.
   */
  it("**unlink 는 그 레이어만 뺀다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.link", { layerId: 11, targetId: 12 });
    await invoke(mcp, "photoshop.layer.link", { layerId: 11, targetId: 10 });

    const removed = (await invoke(mcp, "photoshop.layer.unlink", { layerId: 11 })) as {
      linked: number[];
    };
    expect(removed.linked).toEqual([]);

    // 나머지 둘은 서로 연결된 채로 남는다.
    const rest = (await invoke(mcp, "photoshop.layer.get", { layerId: 12 })) as {
      linkedLayerIds: number[];
    };
    expect(rest.linkedLayerIds).toEqual([10]);
  });

  it("**연결이 없어도 unlink 는 오류가 아니다**", async () => {
    const result = (await invoke(setup(), "photoshop.layer.unlink", { layerId: 11 })) as {
      linked: number[];
    };

    expect(result.linked).toEqual([]);
  });

  it("**layer.get 이 연결 상태를 준다**", async () => {
    /* 쓰는 쪽과 읽는 쪽의 어휘가 같아야 확인이 된다 — `set_lock` 과 같은 자리. */
    const got = (await invoke(setup(), "photoshop.layer.get", { layerId: 11 })) as {
      linkedLayerIds: number[];
    };

    expect(got.linkedLayerIds).toEqual([]);
  });
});
