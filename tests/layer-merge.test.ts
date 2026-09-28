import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.layer.merge`. (CORE_API §5 P2)
 *
 * **선택 개수로 뜻이 달라진다.** Adobe 레퍼런스가 "Combines selected layers;
 * merges one layer downward if only one is selected" 라고 적는다. 그 숨은
 * 의존성을 `layerIds` 로 드러냈다. (ROADMAP §46)
 */

function setup(
  allow: readonly string[] = ["read", "edit", "destructive"],
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

const ids = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number[]> =>
  ((await invoke(mcp, "photoshop.layer.list")) as { layers: { id: number }[] }).layers.map(
    (layer) => layer.id,
  );

describe("layer.merge", () => {
  it("**destructive 다** — 합쳐진 레이어들이 사라진다", () => {
    expect(setup().tools.get("photoshop.layer.merge")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("LAYER_MERGE")).toBe("destructive");
    // 비교 대상: stamp_visible 은 원본을 남기므로 edit 이다.
    expect(setup().commands.permissionOf("LAYER_STAMP_VISIBLE")).toBe("edit");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.layer.merge", { layerIds: [11, 12] }),
    ).rejects.toThrow();
  });

  /**
   * **하나면 아래로 병합이다.** 결과의 `mergedDown` 이 그것을 말한다 —
   * 호출자가 "몇 개를 줬는지" 를 되짚지 않아도 되게 한다.
   */
  it("**하나를 주면 아래로 병합이다**", async () => {
    const mcp = setup();
    const before = await ids(mcp);
    const result = (await invoke(mcp, "photoshop.layer.merge", {
      layerIds: [before[0]],
    })) as { mergedDown: boolean; removed: number };

    expect(result.mergedDown).toBe(true);
    expect(result.removed).toBeGreaterThan(0);
  });

  it("**둘 이상이면 그것들끼리다**", async () => {
    const mcp = setup();
    const before = await ids(mcp);
    const result = (await invoke(mcp, "photoshop.layer.merge", {
      layerIds: [before[0], before[1]],
    })) as { mergedDown: boolean; merged: number[] };

    expect(result.mergedDown).toBe(false);
    expect(result.merged).toEqual([before[0], before[1]]);
  });

  /**
   * **전후 레이어 수를 센다.** `merge_visible` 이 숨긴 활성 레이어에서
   * 조용히 지나갔다(§40) — 성공으로 보고하면 호출자는 합쳐진 줄 안다.
   */
  it("**전후 개수를 함께 준다**", async () => {
    const mcp = setup();
    const before = await ids(mcp);
    const result = (await invoke(mcp, "photoshop.layer.merge", {
      layerIds: [before[0], before[1]],
    })) as { before: number; after: number; removed: number };

    expect(result.before).toBe(before.length);
    expect(result.after).toBe(result.before - result.removed);
    expect(await ids(mcp)).toHaveLength(result.after);
  });

  it("**맨 아래 하나로는 아래로 병합할 수 없다**", async () => {
    /* Photoshop 은 이유를 말해 주지 않는다. 미리 막는다. */
    const mcp = setup();
    const all = await ids(mcp);

    await expect(
      invoke(mcp, "photoshop.layer.merge", { layerIds: [all[all.length - 1]] }),
    ).rejects.toThrow(/아래에 합칠 레이어가 없습니다/);
  });

  /**
   * **하나라도 없으면 아무것도 합치지 않는다.** 일부만 합쳐진 채로 실패하면
   * 호출자가 무엇이 남았는지 모른다 — `group.create` 의 교훈이다(§17.20).
   */
  it("**없는 id 가 있으면 아무것도 합치지 않는다**", async () => {
    const mcp = setup();
    const before = await ids(mcp);

    await expect(
      invoke(mcp, "photoshop.layer.merge", { layerIds: [before[0], 9999] }),
    ).rejects.toThrow(/찾을 수 없어/);
    expect(await ids(mcp)).toEqual(before);
  });

  it("**모르는 파라미터는 거절한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.merge", { layerIds: [11], down: true }),
    ).rejects.toThrow();
  });
});
