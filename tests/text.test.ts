import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 텍스트 레이어. (ROADMAP §17.33)
 *
 * Mock 에는 폰트도 글꼴 렌더링도 없다. 고정하는 것은 **스키마와 거절 경로** 다.
 * 범위가 워터마크·서명이라는 것도 여기서 드러난다 — 자간·단락 파라미터는 없다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const create = async (mcp: Mcp, args: Record<string, unknown>): Promise<unknown> =>
  mcp.tools.invoke("photoshop.text.create", args, { requestId: "r" });

const set = async (mcp: Mcp, args: Record<string, unknown>): Promise<unknown> =>
  mcp.tools.invoke("photoshop.text.set", args, { requestId: "r" });

const fonts = async (mcp: Mcp, args: Record<string, unknown> = {}): Promise<unknown> =>
  mcp.tools.invoke("photoshop.font.list", args, { requestId: "r" });

const WATERMARK = { contents: "© 2026", x: 100, y: 200 };

describe("permission", () => {
  it("만들기·고치기는 edit, 폰트 조회는 read 다", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.text.create")?.permission).toBe("edit");
    expect(mcp.tools.get("photoshop.text.set")?.permission).toBe("edit");
    expect(mcp.tools.get("photoshop.font.list")?.permission).toBe("read");
  });

  it("읽기 전용 서버에서도 폰트는 볼 수 있다", async () => {
    const mcp = setup(["read"]);
    await expect(create(mcp, WATERMARK)).rejects.toThrow(/권한|permission/iu);
    await expect(fonts(mcp)).resolves.toBeDefined();
  });
});

describe("text.create", () => {
  it("텍스트 레이어를 만든다", async () => {
    const result = (await create(setup(), WATERMARK)) as { layer: { type: string } };
    expect(result.layer.type).toBe("text");
  });

  it("**적용한 것만 applied 에 담는다**", async () => {
    // 준 것과 다를 수 있다. 짐작해서 다 담으면 호출자가 안 걸린 것을 걸렸다고 믿는다.
    const bare = (await create(setup(), WATERMARK)) as { applied: string[] };
    expect(bare.applied).toEqual([]);

    const styled = (await create(setup(), { ...WATERMARK, size: 40, opacity: 30 })) as {
      applied: string[];
    };
    expect(styled.applied).toContain("size");
    expect(styled.applied).toContain("opacity");
    expect(styled.applied).not.toContain("font");
  });

  it("내용과 위치를 요구한다", async () => {
    await expect(create(setup(), { contents: "x" })).rejects.toThrow();
    await expect(create(setup(), { x: 1, y: 1 })).rejects.toThrow();
  });

  it("빈 내용을 거절한다", async () => {
    await expect(create(setup(), { ...WATERMARK, contents: "" })).rejects.toThrow();
  });

  it("**워터마크 범위 밖 파라미터를 거절한다**", async () => {
    // strict 스키마다. 자간·행간은 범위에 없으며, 오타가 조용히 무시되면
    // 호출자는 걸린 줄 안다.
    await expect(create(setup(), { ...WATERMARK, tracking: 50 })).rejects.toThrow();
    await expect(create(setup(), { ...WATERMARK, leading: 10 })).rejects.toThrow();
  });

  it("색 범위를 지킨다", async () => {
    await expect(
      create(setup(), { ...WATERMARK, color: { red: 256, green: 0, blue: 0 } }),
    ).rejects.toThrow();
  });

  it("불투명도 범위를 지킨다", async () => {
    await expect(create(setup(), { ...WATERMARK, opacity: 101 })).rejects.toThrow();
    await expect(create(setup(), { ...WATERMARK, opacity: -1 })).rejects.toThrow();
  });

  it("정렬은 세 가지만 받는다", async () => {
    await expect(create(setup(), { ...WATERMARK, alignment: "justify" })).rejects.toThrow();
    await expect(create(setup(), { ...WATERMARK, alignment: "center" })).resolves.toBeDefined();
  });
});

describe("text.set", () => {
  it("**텍스트가 아닌 레이어를 거절한다**", async () => {
    // 픽셀 레이어에는 textItem 이 없어 그대로 진행하면 원인을 알 수 없는 오류가 난다.
    const mcp = setup();
    const layers = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: { id: number; type: string }[];
    };
    const pixel = layers.layers.find((layer) => layer.type === "pixel");
    await expect(
      set(mcp, { layerId: (pixel as { id: number }).id, contents: "x" }),
    ).rejects.toThrow(/텍스트가 아닙니다/u);
  });

  it("어떻게 확인하는지 말한다", async () => {
    const mcp = setup();
    const layers = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: { id: number; type: string }[];
    };
    const pixel = layers.layers.find((layer) => layer.type === "pixel");
    await expect(
      set(mcp, { layerId: (pixel as { id: number }).id, contents: "x" }),
    ).rejects.toThrow(/layer\.list/u);
  });

  it("텍스트 레이어를 고친다", async () => {
    const mcp = setup();
    const made = (await create(mcp, WATERMARK)) as { layer: { id: number } };
    const result = (await set(mcp, {
      layerId: made.layer.id,
      contents: "고침",
      opacity: 20,
    })) as { applied: string[] };
    expect(result.applied).toContain("contents");
    expect(result.applied).toContain("opacity");
  });

  it("**바꿀 것이 없으면 거절한다**", async () => {
    // 아무것도 안 주면 성공을 돌려주면서 아무 일도 안 한다.
    const mcp = setup();
    const made = (await create(mcp, WATERMARK)) as { layer: { id: number } };
    await expect(set(mcp, { layerId: made.layer.id })).rejects.toThrow();
  });
});

describe("font.list", () => {
  it("**Mock 은 폰트를 지어내지 않는다**", async () => {
    // 지어내면 Mock 으로 돌린 워크플로가 없는 폰트를 지정하고 성공으로 보인다.
    const result = (await fonts(setup())) as { fonts: unknown[]; total: number };
    expect(result.fonts).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("상한 범위를 지킨다", async () => {
    await expect(fonts(setup(), { limit: 0 })).rejects.toThrow();
    await expect(fonts(setup(), { limit: 501 })).rejects.toThrow();
  });

  it("빈 검색어를 거절한다", async () => {
    await expect(fonts(setup(), { query: "" })).rejects.toThrow();
  });

  it("모르는 필드를 거절한다", async () => {
    await expect(fonts(setup(), { family: "Arial" })).rejects.toThrow();
  });
});
