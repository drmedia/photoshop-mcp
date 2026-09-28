import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 문서 자르기. (ROADMAP §17.12)
 *
 * 실기 보정에서 아웃포커스 전경이 피사체를 덮는 것이 가장 큰 문제였는데 조정
 * 레이어로는 손댈 수 없었다. 구도는 톤·색과 다른 종류의 일이다.
 */

function setup(allow = ["read", "edit"]): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const crop = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  bounds: Record<string, number>,
): Promise<Record<string, number>> =>
  (await mcp.tools.invoke("photoshop.document.crop", { bounds }, { requestId: "r" })) as never;

describe("문서 자르기", () => {
  it("픽셀을 버리지 않으므로 edit 이다", () => {
    // 파라미터 하나로 permission 이 올라가는 설계를 하지 않았다. 정적 선언이
    // 거짓이 되면 tools/list 를 믿을 수 없다.
    expect(setup().tools.get("photoshop.document.crop")?.permission).toBe("edit");
  });

  it("기본 권한으로 동작한다", async () => {
    // destructive 로 뒀으면 기본 설정에서 막혔을 것이다. 되돌릴 수 있는 일이다.
    const result = await crop(setup(), { left: 0, top: 0, right: 800, bottom: 600 });
    expect(result["width"]).toBe(800);
    expect(result["height"]).toBe(600);
  });

  it("전후 크기를 함께 돌려준다", async () => {
    // 무엇이 얼마나 줄었는지 호출자가 알아야 한다.
    const mcp = setup();
    const before = (await mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" })) as {
      width: number;
      height: number;
    };
    const result = await crop(mcp, { left: 10, top: 20, right: 500, bottom: 400 });
    expect(result["previousWidth"]).toBe(before.width);
    expect(result["previousHeight"]).toBe(before.height);
    expect(result["width"]).toBe(490);
    expect(result["height"]).toBe(380);
  });

  it("픽셀이 남아 있다고 알린다", async () => {
    // 되돌릴 수 있다는 사실과 파일이 작아지지 않는다는 사실을 둘 다 여기서 읽는다.
    const result = await crop(setup(), { left: 0, top: 0, right: 400, bottom: 300 });
    expect(result["pixelsRetained"]).toBe(true);
  });

  it("문서를 벗어나면 거부한다", async () => {
    // 캔버스를 넓히는 것은 자르기가 아니다. 조용히 넓혀 주면 잘린 줄 안다.
    await expect(crop(setup(), { left: 0, top: 0, right: 999_999, bottom: 300 })).rejects.toThrow(
      /벗어납니다/u,
    );
  });

  it("빈 사각형을 거부한다", async () => {
    // Photoshop 은 알 수 없는 오류로 거부한다. 여기서 이유를 말한다.
    await expect(crop(setup(), { left: 100, top: 0, right: 100, bottom: 300 })).rejects.toThrow(
      /right 는 left 보다/u,
    );
    await expect(crop(setup(), { left: 0, top: 300, right: 100, bottom: 300 })).rejects.toThrow(
      /bottom 은 top 보다/u,
    );
  });

  /**
   * **배경은 캔버스 밖에 픽셀을 가질 수 없어 승격된다.** 실기에서 id 1 이
   * id 3(`레이어 0`)이 되었다(ROADMAP §36). 한동안 이 사실을 결과에 담지
   * 않아 호출자가 들고 있던 id 가 조용히 사라졌다.
   */
  it("**배경이 승격되면 사라진 id 와 새 레이어를 함께 준다**", async () => {
    const mcp = setup();
    const before = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: { id: number; isBackground?: boolean }[];
    };
    const background = before.layers.find((layer) => layer.isBackground === true);
    expect(background).toBeDefined();

    const result = (await crop(mcp, { left: 0, top: 0, right: 300, bottom: 200 })) as unknown as {
      promoted: { previousId: number; layer: { id: number; isBackground?: boolean } } | null;
    };

    expect(result.promoted).not.toBeNull();
    expect(result.promoted?.previousId).toBe(background?.id);
    expect(result.promoted?.layer.id).not.toBe(background?.id);
    // 승격된 것은 더 이상 배경이 아니다.
    expect(result.promoted?.layer.isBackground).toBeUndefined();

    // 옛 id 는 실제로 사라져 있어야 한다.
    const after = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: { id: number }[];
    };
    expect(after.layers.some((layer) => layer.id === background?.id)).toBe(false);
    expect(after.layers.some((layer) => layer.id === result.promoted?.layer.id)).toBe(true);
  });

  it("**배경이 없으면 promoted 는 null 이다**", async () => {
    /* 짝지을 수 없으면 짐작하지 않는다 — 짐작한 id 를 주면 호출자가 엉뚱한
     * 레이어를 편집한다. */
    const mcp = setup();
    await crop(mcp, { left: 0, top: 0, right: 300, bottom: 200 });
    const second = (await crop(mcp, { left: 0, top: 0, right: 200, bottom: 100 })) as unknown as {
      promoted: unknown;
    };

    expect(second.promoted).toBeNull();
  });

  it("되돌릴 수 있다", async () => {
    // 픽셀을 버리지 않는다는 주장이 실제로 성립하는지 본다.
    const mcp = setup();
    const before = (await mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" })) as {
      width: number;
    };
    await crop(mcp, { left: 0, top: 0, right: 300, bottom: 200 });
    await mcp.tools.invoke("photoshop.history.undo", {}, { requestId: "r" });
    const after = (await mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" })) as {
      width: number;
    };
    expect(after.width).toBe(before.width);
  });
});
