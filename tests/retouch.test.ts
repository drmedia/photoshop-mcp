import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 결함 제거. (ROADMAP §17.14, RETOUCH_PROCESS 3단계)
 *
 * 프로세스의 한 단계가 통째로 비어 있었다. 갯벌 사진에서 하늘의 센서 먼지를
 * 찾아 놓고 지우지 못했다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({ bridge: new MockPhotoshopBridge(), logger: createSilentLogger() });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

const remove = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => invoke(mcp, "photoshop.retouch.remove_spots", args);

/** 배경이 아닌 픽셀 레이어를 하나 만들어 그 id 를 준다. */
async function pixelLayer(mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> {
  const created = await invoke(mcp, "photoshop.layer.create", { name: "Retouch" });
  return (created as { id: number }).id;
}

describe("결함 제거", () => {
  it("edit 이다", () => {
    // 픽셀을 직접 바꾸지만 배경을 막아 두었으므로 사라지는 것은 이미 사본이다.
    // 필터와 같은 급이다.
    expect(setup().tools.get("photoshop.retouch.remove_spots")?.permission).toBe("edit");
  });

  it("**배경 레이어를 거절한다**", async () => {
    // 이 Command 의 가장 중요한 성질이다. 먼지 제거는 원본 촬영 픽셀을 지우는 것이
    // 목적인 유일한 작업이라, 배경에 걸면 카메라가 본 것의 기록이 사라진다.
    const mcp = setup();
    const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; isBackground?: boolean }[];
    };
    const background = layers.find((entry) => entry.isBackground === true);
    expect(background).toBeDefined();
    await expect(
      remove(mcp, { spots: [{ x: 100, y: 100, radius: 10 }], layerId: background?.id }),
    ).rejects.toThrow(/배경 레이어/u);
  });

  it("거절하면서 무엇을 하라고 말한다", async () => {
    // "안 된다" 만으로는 호출자가 할 수 있는 일이 없다.
    const mcp = setup();
    const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; isBackground?: boolean }[];
    };
    const background = layers.find((entry) => entry.isBackground === true);
    await expect(
      remove(mcp, { spots: [{ x: 10, y: 10, radius: 5 }], layerId: background?.id }),
    ).rejects.toThrow(/layer\.duplicate/u);
  });

  it("보통 픽셀 레이어에는 걸린다", async () => {
    const mcp = setup();
    const id = await pixelLayer(mcp);
    const result = await remove(mcp, {
      spots: [
        { x: 100, y: 100, radius: 8 },
        { x: 400, y: 250, radius: 12 },
      ],
      layerId: id,
    });
    expect(result["removed"]).toBe(2);
  });

  it("요청한 수만큼 지웠는지 돌려준다", async () => {
    // 요청 수와 다르면 무언가 잘못된 것이고, 호출자가 그것을 알 수 있어야 한다.
    const mcp = setup();
    const id = await pixelLayer(mcp);
    const spots = [1, 2, 3, 4].map((n) => ({ x: n * 100, y: n * 50, radius: 6 }));
    expect((await remove(mcp, { spots, layerId: id }))["removed"]).toBe(spots.length);
  });

  it("문서 밖 지점을 거절한다", async () => {
    // 빈 선택에 채우기를 걸면 Photoshop 이 원인을 알 수 없는 메시지로 거절한다.
    const mcp = setup();
    const id = await pixelLayer(mcp);
    await expect(
      remove(mcp, { spots: [{ x: 999_999, y: 10, radius: 5 }], layerId: id }),
    ).rejects.toThrow(/밖입니다/u);
  });

  it("조정 레이어를 거절한다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.adjustment.curves", {
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 255 },
      ],
    });
    const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; type: string }[];
    };
    const adjustment = layers.find((entry) => entry.type === "adjustment");
    await expect(
      remove(mcp, { spots: [{ x: 10, y: 10, radius: 5 }], layerId: adjustment?.id }),
    ).rejects.toThrow(/지울 픽셀이 없습니다/u);
  });

  it("빈 목록을 거절한다", async () => {
    // 아무것도 안 하고 성공을 돌려주면 호출자는 지워졌다고 믿는다.
    const mcp = setup();
    const id = await pixelLayer(mcp);
    await expect(remove(mcp, { spots: [], layerId: id })).rejects.toThrow(/spots/u);
  });

  it("반지름 상한이 있다", async () => {
    // 먼지·잡티용이지 피사체를 지우는 도구가 아니다.
    const mcp = setup();
    const id = await pixelLayer(mcp);
    await expect(
      remove(mcp, { spots: [{ x: 100, y: 100, radius: 5000 }], layerId: id }),
    ).rejects.toThrow(/radius/u);
  });

  it("선택을 남기지 않는다", async () => {
    // 남기면 다음 Command 가 조용히 그 범위에만 걸린다.
    const mcp = setup();
    const id = await pixelLayer(mcp);
    await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
    await remove(mcp, { spots: [{ x: 100, y: 100, radius: 8 }], layerId: id });
    await expect(
      invoke(mcp, "photoshop.document.statistics", { region: "selection" }),
    ).rejects.toThrow(/선택 영역/u);
  });

  it("되돌릴 수 있다", async () => {
    const mcp = setup();
    const id = await pixelLayer(mcp);
    await remove(mcp, { spots: [{ x: 100, y: 100, radius: 8 }], layerId: id });
    await expect(invoke(mcp, "photoshop.history.undo")).resolves.toBeDefined();
  });
});
