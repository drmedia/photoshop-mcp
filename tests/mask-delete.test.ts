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
