import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 합성 휘도 선택. (ROADMAP §20)
 *
 * `selection.color_range` 가 광도 마스크라고 적혀 있었는데 **아니었다.** 실기에서
 * highlights 마스크가 거의 새까맣고 shadows 마스크가 거의 새하얗게 나왔다 —
 * 임계 기반 구간 선택이라 계조가 이어지는 구조를 못 따라간다.
 *
 * descriptor 는 짐작하지 않고 잡았다. 서버를 띄워 둔 채로 사람이 채널 패널에서
 * RGB 를 Ctrl+클릭하게 하고 `photoshop.event.recent` 로 받아 적었다.
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

describe("selection.luminosity", () => {
  it("**edit 이다** — 선택을 바꿀 뿐 파일을 만들지 않는다", () => {
    expect(setup().tools.get("photoshop.selection.luminosity")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("SELECTION_LUMINOSITY")).toBe("edit");
  });

  it("선택을 만든다", async () => {
    await expect(invoke(setup(), "photoshop.selection.luminosity")).resolves.toMatchObject({
      hasSelection: true,
    });
  });

  it("invert 를 받는다 — 광도 마스크의 Darks 다", async () => {
    await expect(
      invoke(setup(), "photoshop.selection.luminosity", { invert: true }),
    ).resolves.toMatchObject({ hasSelection: true });
  });

  it("선언하지 않은 파라미터는 거절한다", async () => {
    // `name` 을 받는 load_channel 과 헷갈려 넘기는 것을 조용히 무시하지 않는다.
    await expect(
      invoke(setup(), "photoshop.selection.luminosity", { name: "RGB" }),
    ).rejects.toThrow();
  });

  it("**mode intersect 는 기존 선택을 요구한다**", async () => {
    /* 좁은 광도 마스크(Lights 2)를 만드는 길이다. 교집합할 것이 없으면
     * 조용히 덮어쓰지 않고 거절한다 — 덮어쓰면 넓은 마스크가 나오는데
     * 호출자는 좁은 것을 받았다고 믿는다. */
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.selection.luminosity", { mode: "intersect" }),
    ).rejects.toThrow(/선택 영역이 없습니다/u);

    await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
    await expect(
      invoke(mcp, "photoshop.selection.luminosity", { mode: "intersect" }),
    ).resolves.toMatchObject({ hasSelection: true });
  });

  it("mode 는 new 와 intersect 뿐이다", async () => {
    await expect(
      invoke(setup(), "photoshop.selection.luminosity", { mode: "subtract" }),
    ).rejects.toThrow();
  });

  it("**load_channel 도 intersect 를 받는다** — Darks 2 를 만드는 길이다", async () => {
    /* 어두운 쪽 좁은 마스크는 (1−L)² 이라 반전한 것끼리 교차해야 한다.
     * luminosity 의 intersect 는 언제나 RGB(=L)와 교차하므로 그쪽으로는
     * (1−L)×L 이 나온다 — 대상이 다르다. */
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.selection.load_channel", { name: "D", mode: "intersect" }),
    ).rejects.toThrow(/선택 영역이 없습니다/u);

    await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
    await invoke(mcp, "photoshop.selection.save_channel", { name: "D" });
    await expect(
      invoke(mcp, "photoshop.selection.load_channel", { name: "D", mode: "intersect" }),
    ).resolves.toMatchObject({ hasSelection: true });
  });

  it("**마스크를 잴 때는 조정 레이어도 받는다**", async () => {
    /* 조정 레이어는 픽셀이 없어 layerId 를 거절하지만 마스크는 있다.
     * 광도 마스크가 의도한 구조를 담았는지 확인하는 유일한 길이다 —
     * 실기에서 마스크 넷이 눈으로 구분되지 않아 숫자가 필요했다. */
    const mcp = setup();
    await invoke(mcp, "photoshop.adjustment.curves", {
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 255 },
      ],
    });
    const layers = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; type: string; hasMask?: boolean }[];
    };
    const adjustment = layers.layers.find((entry) => entry.type === "adjustment");
    expect(adjustment).toBeDefined();

    // 픽셀로는 거절한다.
    await expect(
      invoke(mcp, "photoshop.document.statistics", { layerId: (adjustment as { id: number }).id }),
    ).rejects.toThrow(/잴 픽셀이 없습니다/u);

    // 마스크가 없으면 마스크로도 거절한다 — 없는 것을 잰 척하지 않는다.
    await expect(
      invoke(mcp, "photoshop.document.statistics", {
        layerId: (adjustment as { id: number }).id,
        target: "mask",
      }),
    ).rejects.toThrow(/마스크가 없습니다/u);
  });

  it("color_range 와 다른 Command 다", () => {
    // 둘이 같은 것이라고 적어 두었던 적이 있다. 이름이 갈려 있는지 고정한다.
    const mcp = setup();
    expect(mcp.commands.list()).toContain("SELECTION_LUMINOSITY");
    expect(mcp.commands.list()).toContain("SELECTION_COLOR_RANGE");
  });
});

/**
 * 선택 조합. (ROADMAP §70)
 *
 * **`load_channel` 이 선택을 조합하는 통로다.** 한동안 `new` · `intersect` 둘뿐
 * 이라 "하늘에서 은하수를 뺀다" 를 `invert` + `intersect` 두 번으로 우회했다.
 */
describe("selection.load_channel 의 mode", () => {
  const rect = { shape: "rectangle", bounds: { left: 10, top: 10, right: 100, bottom: 100 } };

  async function withChannel(
    mcp: ReturnType<typeof createPhotoshopMcp>,
    name: string,
  ): Promise<void> {
    await invoke(mcp, "photoshop.selection.set", rect);
    await invoke(mcp, "photoshop.selection.save_channel", { name });
  }

  it("**네 가지를 다 받는다**", () => {
    const tool = setup()
      .tools.list()
      .find((entry) => entry.name === "photoshop.selection.load_channel");
    const mode = (
      tool?.inputSchema as unknown as { shape: { mode: { unwrap: () => { options: string[] } } } }
    ).shape.mode.unwrap().options;
    expect(mode).toEqual(["replace", "add", "subtract", "intersect"]);
  });

  it("**`new` 는 더 이상 받지 않는다** — `replace` 로 통일했다", async () => {
    // selection.polygon · path.to_selection 이 이미 replace 였다.
    // 둘만 new 였던 것이 틀린 쪽이다.
    const mcp = setup();
    await withChannel(mcp, "sky");
    await expect(
      invoke(mcp, "photoshop.selection.load_channel", { name: "sky", mode: "new" }),
    ).rejects.toThrow();
  });

  it("subtract 가 돈다", async () => {
    const mcp = setup();
    await withChannel(mcp, "sky");
    const result = await invoke(mcp, "photoshop.selection.load_channel", {
      name: "sky",
      mode: "subtract",
    });
    expect(result["hasSelection"]).toBe(true);
  });

  /**
   * **`replace` 가 아니면 바탕이 있어야 한다.** Mock 이 안 막으면 그 거절
   * 경로가 테스트에 영원히 안 나온다 — 배경 승격 때와 같다.
   */
  it("**바탕 선택이 없으면 replace 말고는 거절한다**", async () => {
    for (const mode of ["add", "subtract", "intersect"]) {
      const mcp = setup();
      await invoke(mcp, "photoshop.selection.set", rect);
      await invoke(mcp, "photoshop.selection.save_channel", { name: "sky" });
      await invoke(mcp, "photoshop.selection.clear");
      await expect(
        invoke(mcp, "photoshop.selection.load_channel", { name: "sky", mode }),
      ).rejects.toThrow(/선택 영역이 없습니다/u);
    }
  });

  it("replace 는 바탕이 없어도 된다", async () => {
    const mcp = setup();
    await withChannel(mcp, "sky");
    await invoke(mcp, "photoshop.selection.clear");
    const result = await invoke(mcp, "photoshop.selection.load_channel", {
      name: "sky",
      mode: "replace",
    });
    expect(result["hasSelection"]).toBe(true);
  });

  /** 합성 휘도는 `document.channels` 에 없어 DOM 으로 못 부른다. */
  it("**luminosity 는 둘뿐이다** — 더하려면 채널을 거친다", () => {
    const tool = setup()
      .tools.list()
      .find((entry) => entry.name === "photoshop.selection.luminosity");
    const mode = (
      tool?.inputSchema as unknown as { shape: { mode: { unwrap: () => { options: string[] } } } }
    ).shape.mode.unwrap().options;
    expect(mode).toEqual(["replace", "intersect"]);
  });
});
