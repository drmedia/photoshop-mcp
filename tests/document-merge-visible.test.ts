import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.document.merge_visible`. (CORE_API §5)
 *
 * **비슷한 Tool 이 셋이고 셋 다 다르다.** (ROADMAP §40)
 *
 * ```text
 * layer.stamp_visible      복제본을 만든다. 원본은 남는다     edit
 * document.merge_visible   원본이 사라지되 숨긴 것은 남는다   destructive
 * document.flatten         숨긴 것을 버린다                   destructive
 * ```
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

describe("document.merge_visible", () => {
  it("**destructive 다** — 원본이 사라진다", () => {
    expect(setup().tools.get("photoshop.document.merge_visible")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("DOCUMENT_MERGE_VISIBLE")).toBe("destructive");
    // stamp_visible 은 복제본을 만들 뿐이라 edit 이다.
    expect(setup().commands.permissionOf("LAYER_STAMP_VISIBLE")).toBe("edit");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.document.merge_visible"),
    ).rejects.toThrow();
  });

  /**
   * **`flatten` 과 갈리는 자리다.** 숨긴 레이어가 살아남는다 — Mock 이 둘을
   * 같게 만들면 이 차이가 테스트에 영영 나오지 않는다.
   */
  it("**숨긴 레이어는 남는다**", async () => {
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; visible: boolean }[];
    };
    const firstVisible = before.layers.find((layer) => layer.visible);
    await invoke(mcp, "photoshop.layer.select", { layerId: firstVisible?.id });
    const hidden = before.layers.filter((layer) => !layer.visible).map((layer) => layer.id);
    expect(hidden.length).toBeGreaterThan(0);

    const result = (await invoke(mcp, "photoshop.document.merge_visible")) as {
      before: { visible: number; hidden: number };
      after: { visible: number; hidden: number };
    };

    expect(result.after.hidden).toBe(result.before.hidden);
    expect(result.after.visible).toBe(1);

    const list = (await invoke(mcp, "photoshop.layer.list")) as { layers: { id: number }[] };
    for (const id of hidden) {
      expect(list.layers.some((layer) => layer.id === id)).toBe(true);
    }
  });

  it("**보이는 레이어가 하나뿐이면 거절한다**", async () => {
    /* Photoshop 은 "명령을 사용할 수 없습니다" 라고만 답해 이유를 알 수 없다. */
    const mcp = setup();
    const list = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; visible: boolean }[];
    };
    await invoke(mcp, "photoshop.layer.select", {
      layerId: list.layers.find((layer) => layer.visible)?.id,
    });
    await invoke(mcp, "photoshop.document.merge_visible");

    await expect(invoke(mcp, "photoshop.document.merge_visible")).rejects.toThrow(
      /합칠 것이 없습니다/,
    );
  });

  /**
   * **활성 레이어가 숨겨져 있으면 Photoshop 이 조용히 아무 일도 안 한다.**
   * 실기에서 잡았다(ROADMAP §40) — 오류도 없고 레이어 수도 그대로였다.
   * 미리 막지 않으면 호출자가 합쳐진 줄 안다.
   */
  it("**활성 레이어가 숨겨져 있으면 거절한다**", async () => {
    const mcp = setup();
    const list = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; visible: boolean }[];
    };
    const hidden = list.layers.find((layer) => !layer.visible);
    expect(hidden).toBeDefined();

    await invoke(mcp, "photoshop.layer.select", { layerId: hidden?.id });

    await expect(invoke(mcp, "photoshop.document.merge_visible")).rejects.toThrow(/숨겨져 있어/);
  });

  /**
   * **남는 것은 배경이 있으면 배경, 없으면 선택한 레이어다.** 실기에서
   * 확인했고 Adobe 레퍼런스의 "will not convert the remaining layer to
   * Background if no Background already exists" 와도 맞는다.
   *
   * 처음 Mock 은 "가장 아래 보이는 레이어" 로 짐작했는데 틀렸다 — 배경이
   * 있는 문서에서 우연히 맞아떨어져 드러나지 않았다.
   */
  it("**배경이 있으면 배경이 남는다**", async () => {
    const mcp = setup();
    const list = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; visible: boolean; isBackground?: boolean }[];
    };
    const background = list.layers.find((layer) => layer.isBackground === true);
    const other = list.layers.find((layer) => layer.visible && layer.isBackground !== true);
    expect(background).toBeDefined();

    // 배경이 아닌 레이어를 고르고 병합해도 배경이 남아야 한다.
    await invoke(mcp, "photoshop.layer.select", { layerId: other?.id });
    const result = (await invoke(mcp, "photoshop.document.merge_visible")) as {
      activeLayer: { id: number; isBackground?: boolean };
    };

    expect(result.activeLayer.id).toBe(background?.id);
    expect(result.activeLayer.isBackground).toBe(true);
  });

  it("**인자를 받지 않는다**", async () => {
    await expect(
      invoke(setup(), "photoshop.document.merge_visible", { hidden: true }),
    ).rejects.toThrow();
  });

  it("**stamp_visible 은 원본을 남긴다** — 갈리는 자리", async () => {
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] };
    await invoke(mcp, "photoshop.layer.stamp_visible");
    const after = (await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] };

    expect(after.layers.length).toBe(before.layers.length + 1);
  });
});
