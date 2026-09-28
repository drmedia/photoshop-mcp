import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.mask.delete` — 마스크를 버린다. (ROADMAP §50)
 *
 * `mask.apply` 와 **같은 descriptor 에서 `apply` 플래그만 다르다.** 그래서 새로
 * 잡을 descriptor 가 없었고, 갈리는 것은 의미뿐이다.
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

/** 마스크가 붙은 레이어를 만들어 id 를 준다. */
const layerWithMask = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> => {
  const layer = (await invoke(mcp, "photoshop.layer.create", { name: "M" })) as { id: number };
  await invoke(mcp, "photoshop.mask.create", { layerId: layer.id, from: "revealAll" });
  return layer.id;
};

describe("mask.delete — 마스크를 버린다", () => {
  /**
   * **`destructive` 인 이유가 `apply` 와 다르다.** `apply` 는 가려 둔 픽셀이
   * 사라져서이고, `delete` 는 마스크 자체가 사라져서다 — `mask.dab` ·
   * `mask.gradient` 로 쌓아 둔 것이 한 번에 없어진다.
   */
  it("**destructive 다** — disable 과 갈리는 자리", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("MASK_DELETE")).toBe("destructive");
    expect(mcp.commands.permissionOf("MASK_APPLY")).toBe("destructive");
    expect(mcp.commands.permissionOf("MASK_DISABLE")).toBe("edit");
  });

  it("**기본 권한으로는 막힌다**", async () => {
    /* 기본 허용은 read · edit 뿐이다. 마스크를 버리는 것이 그 안에 들어가면
     * 아무 선언 없이 쌓아 둔 마스크가 날아간다. */
    const mcp = setup(["read", "edit"]);
    const id = await layerWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.delete", { layerId: id })).rejects.toThrow();
  });

  it("**마스크가 사라진다**", async () => {
    const mcp = setup();
    const id = await layerWithMask(mcp);

    /* `layer.get` 은 `{ layer }` 로 감싸서 준다 — 편집 결과와 다른 출처로
     * 확인해야 "지웠다고 말하고 안 지운" 경우가 잡힌다. */
    const before = (await invoke(mcp, "photoshop.layer.get", { layerId: id })) as {
      layer: { hasMask?: boolean };
    };
    expect(before.layer.hasMask).toBe(true);

    const result = (await invoke(mcp, "photoshop.mask.delete", { layerId: id })) as {
      hasMask?: boolean;
      maskEnabled?: boolean;
    };
    expect(result.hasMask).toBe(false);
    expect(result.maskEnabled).toBe(false);

    const after = (await invoke(mcp, "photoshop.layer.get", { layerId: id })) as {
      layer: { hasMask?: boolean };
    };
    expect(after.layer.hasMask).toBe(false);
  });

  /**
   * **마스크가 없으면 거절한다.** 통과시키면 Photoshop 이 무엇을 지울지 알 수
   * 없다.
   */
  it("**마스크 없는 레이어는 거절한다**", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "N" })) as { id: number };
    await expect(invoke(mcp, "photoshop.mask.delete", { layerId: layer.id })).rejects.toThrow();
  });

  /**
   * **`disable` 은 마스크를 남긴다.** 둘을 헷갈리면 되돌릴 수 없는 쪽을 고르게
   * 된다 — 실제로 필요한 것이 "잠깐 꺼 보기" 인 경우가 많다.
   */
  it("**disable 은 마스크를 남긴다** — delete 와 가르는 축", async () => {
    const mcp = setup();
    const id = await layerWithMask(mcp);

    const disabled = (await invoke(mcp, "photoshop.mask.disable", { layerId: id })) as {
      hasMask?: boolean;
      maskEnabled?: boolean;
    };
    expect(disabled.hasMask).toBe(true);
    expect(disabled.maskEnabled).toBe(false);

    /* 껐어도 다시 켤 수 있다. */
    const enabled = (await invoke(mcp, "photoshop.mask.enable", { layerId: id })) as {
      maskEnabled?: boolean;
    };
    expect(enabled.maskEnabled).toBe(true);
  });

  it("**모르는 파라미터는 거절한다**", async () => {
    const mcp = setup();
    const id = await layerWithMask(mcp);
    await expect(
      invoke(mcp, "photoshop.mask.delete", { layerId: id, apply: false }),
    ).rejects.toThrow();
  });
});

/**
 * `photoshop.mask.link` · `photoshop.mask.unlink` — 마스크 연결. (ROADMAP §51)
 *
 * descriptor 는 `["all"]` 알림으로 잡았다 — 사람이 레이어 패널의 사슬 아이콘을
 * 누르는 동안 받은 `set { userMaskLinked: false }` 가 그것이다. **`true` 방향은
 * 잡히지 않아 짐작하지 않고 걸고 나서 다시 읽어 확인한다.**
 */
describe("mask.link · mask.unlink — 마스크 연결", () => {
  it("**둘 다 edit 다** — 사라지는 것이 없다", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("MASK_LINK")).toBe("edit");
    expect(mcp.commands.permissionOf("MASK_UNLINK")).toBe("edit");
    /* 같은 마스크를 다루지만 이쪽은 없애지 않는다. */
    expect(mcp.commands.permissionOf("MASK_DELETE")).toBe("destructive");
  });

  it("**기본 권한으로 돈다**", async () => {
    const mcp = setup(["read", "edit"]);
    const id = await layerWithMask(mcp);
    await expect(invoke(mcp, "photoshop.mask.unlink", { layerId: id })).resolves.toBeTruthy();
  });

  it("**요청한 값이 들어갔는지 결과가 말한다**", async () => {
    const mcp = setup();
    const id = await layerWithMask(mcp);

    const unlinked = (await invoke(mcp, "photoshop.mask.unlink", { layerId: id })) as {
      linked: boolean | null;
      applied: boolean | null;
      layer: { id: number };
    };
    expect(unlinked.linked).toBe(false);
    expect(unlinked.applied).toBe(true);
    expect(unlinked.layer.id).toBe(id);

    const linked = (await invoke(mcp, "photoshop.mask.link", { layerId: id })) as {
      linked: boolean | null;
      applied: boolean | null;
    };
    expect(linked.linked).toBe(true);
    expect(linked.applied).toBe(true);
  });

  /** 마스크가 없으면 연결할 것이 없다. */
  it("**마스크 없는 레이어는 거절한다**", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "N" })) as { id: number };
    await expect(invoke(mcp, "photoshop.mask.link", { layerId: layer.id })).rejects.toThrow();
    await expect(invoke(mcp, "photoshop.mask.unlink", { layerId: layer.id })).rejects.toThrow();
  });

  /**
   * **연결을 끊어도 마스크는 남는다.** `delete` 와 헷갈리면 되돌릴 수 없는 쪽을
   * 고르게 된다.
   */
  it("**연결을 끊어도 마스크는 남는다** — delete 와 가르는 축", async () => {
    const mcp = setup();
    const id = await layerWithMask(mcp);
    const result = (await invoke(mcp, "photoshop.mask.unlink", { layerId: id })) as {
      layer: { hasMask?: boolean };
    };
    expect(result.layer.hasMask).toBe(true);
  });

  it("**모르는 파라미터는 거절한다**", async () => {
    const mcp = setup();
    const id = await layerWithMask(mcp);
    await expect(
      invoke(mcp, "photoshop.mask.link", { layerId: id, linked: true }),
    ).rejects.toThrow();
  });
});
