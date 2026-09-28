import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { LayerSetLockParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.layer.set_lock`. (CORE_API §5 P2)
 *
 * **넷이 독립 플래그가 아니다.** Adobe 레퍼런스는 각각 읽기/쓰기 불린으로
 * 적지만 실기는 다르다 — 하나를 쓰면 나머지가 전부 지워진다. (ROADMAP §43)
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

const locksOf = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  lock: string,
): Promise<Record<string, boolean | null>> =>
  (
    (await invoke(mcp, "photoshop.layer.set_lock", { layerId: 12, lock })) as {
      locks: Record<string, boolean | null>;
    }
  ).locks;

describe("layer.set_lock", () => {
  it("**edit 다** — 잠금은 되돌릴 수 있다", () => {
    expect(setup().tools.get("photoshop.layer.set_lock")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("LAYER_SET_LOCK")).toBe("edit");
  });

  /**
   * **네 불린을 받는 모양으로 먼저 만들었다가 바꿨다.** 그러면 `pixels` 와
   * `position` 을 함께 달라는 **절대 성공할 수 없는 요청**을 받아들이게 된다.
   */
  it("**한 번에 하나만 받는다**", () => {
    expect(LayerSetLockParamsSchema.safeParse({ lock: "pixels" }).success).toBe(true);
    expect(LayerSetLockParamsSchema.safeParse({ lock: "pixels", position: true }).success).toBe(
      false,
    );
    expect(LayerSetLockParamsSchema.safeParse({ pixels: true }).success).toBe(false);
  });

  it("**lock 은 필수이고 다섯 중 하나다**", () => {
    expect(LayerSetLockParamsSchema.safeParse({}).success).toBe(false);
    for (const lock of ["none", "all", "pixels", "position", "transparentPixels"]) {
      expect(LayerSetLockParamsSchema.safeParse({ lock }).success).toBe(true);
    }
    /* `locked` 는 읽기 전용 파생값이라 대상이 될 수 없다. */
    expect(LayerSetLockParamsSchema.safeParse({ lock: "locked" }).success).toBe(false);
    expect(LayerSetLockParamsSchema.safeParse({ lock: "any" }).success).toBe(false);
  });

  /**
   * **하나를 쓰면 나머지가 지워진다.** 실기에서 확인한 규칙이고 Mock 도
   * 같아야 한다 — 다르면 이 놀라움이 테스트에 영영 나오지 않는다.
   */
  it("**새 잠금이 이전 잠금을 지운다**", async () => {
    const mcp = setup();
    const first = await locksOf(mcp, "pixels");
    expect(first["pixels"]).toBe(true);
    expect(first["position"]).toBe(false);

    const second = await locksOf(mcp, "position");
    expect(second["position"]).toBe(true);
    expect(second["pixels"]).toBe(false);

    const third = await locksOf(mcp, "transparentPixels");
    expect(third["transparentPixels"]).toBe(true);
    expect(third["position"]).toBe(false);
  });

  it("**none 이 전부 풀기다**", async () => {
    const mcp = setup();
    await locksOf(mcp, "all");
    const cleared = await locksOf(mcp, "none");

    expect(cleared["any"]).toBe(false);
    expect(cleared["all"]).toBe(false);
    expect(cleared["pixels"]).toBe(false);
  });

  it("**any 는 파생값이다**", async () => {
    const mcp = setup();
    const locked = await locksOf(mcp, "pixels");

    expect(locked["any"]).toBe(true);
    expect(locked["all"]).toBe(false);
  });

  /**
   * **다섯을 다 주는 이유가 있다.** 배경 레이어는 `position` 과
   * `transparentPixels` 를 동시에 갖는다 — 설정기로 도달할 수 없는 상태라
   * 단일 값으로 요약하면 그 사실을 말할 수 없다.
   */
  it("**locks 는 다섯을 모두 담는다**", async () => {
    const locks = await locksOf(setup(), "pixels");

    for (const key of ["any", "all", "pixels", "position", "transparentPixels"]) {
      expect(locks).toHaveProperty(key);
    }
  });

  it("**layer.get 이 다섯 값을 모두 준다**", async () => {
    /* 쓰는 쪽과 읽는 쪽의 어휘가 같아야 확인이 된다. */
    const mcp = setup();
    await locksOf(mcp, "position");
    const got = (await invoke(mcp, "photoshop.layer.get", { layerId: 12 })) as Record<
      string,
      unknown
    >;

    expect(got["positionLocked"]).toBe(true);
    expect(got["pixelsLocked"]).toBe(false);
    expect(got["locked"]).toBe(true);
    expect(got).toHaveProperty("transparentPixelsLocked");
  });

  it("**건드린 적 없으면 null 이다**", async () => {
    /* 못 읽은 것을 `false` 로 덮으면 "안 잠겼다" 는 틀린 사실이 된다. */
    const got = (await invoke(setup(), "photoshop.layer.get", { layerId: 12 })) as Record<
      string,
      unknown
    >;

    expect(got["allLocked"]).toBeNull();
    expect(got["pixelsLocked"]).toBeNull();
  });

  it("**없는 레이어는 실패한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.set_lock", { layerId: 9999, lock: "all" }),
    ).rejects.toThrow();
  });
});
