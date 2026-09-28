import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.canvas.resize`. (CORE_API §5 P2)
 *
 * **`image.resize` 와 갈린다.** 그쪽은 픽셀을 다시 표본화하고 이쪽은 종이 크기만
 * 바꾼다. 생략한 쪽의 뜻도 다르다. (ROADMAP §36)
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "destructive"] as never),
  });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

describe("canvas.resize", () => {
  /**
   * **`document.crop` 과 갈린다 — 실기에서 재서 갈랐다.** crop 은 배경을 일반
   * 레이어로 승격시켜 바깥 픽셀을 남기지만(왕복 성공) 이쪽은 배경을 그대로
   * 잘라 픽셀이 사라진다. 그래서 crop 은 `edit` 이고 이쪽은 `destructive` 다.
   */
  it("**destructive 다** — crop 과 갈리는 자리", () => {
    expect(setup().tools.get("photoshop.canvas.resize")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("CANVAS_RESIZE")).toBe("destructive");
    // crop 은 픽셀을 남기므로 edit 이다. 둘이 같은 등급이면 이 차이가 묻힌다.
    expect(setup().commands.permissionOf("DOCUMENT_CROP")).toBe("edit");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    const restricted = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit"] as never),
    });
    await expect(invoke(restricted, "photoshop.canvas.resize", { width: 100 })).rejects.toThrow();
  });

  /**
   * **생략한 쪽의 뜻이 `image.resize` 와 다르다.** 그쪽은 비율을 맞추고
   * 이쪽은 지금 값을 그대로 쓴다 — 캔버스에는 맞출 비율이 없다.
   */
  it("**생략한 쪽은 지금 값 그대로다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.canvas.resize", { width: 7000 })) as {
      before: { width: number; height: number };
      after: { width: number; height: number };
    };

    expect(result.after.width).toBe(7000);
    expect(result.after.height).toBe(result.before.height);
  });

  it("**image.resize 는 같은 입력에 비율을 맞춘다**", async () => {
    /* 두 Tool 을 바꿔 쓰면 다른 결과가 나와야 한다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.image.resize", { width: 3024 })) as {
      before: { height: number };
      after: { height: number };
    };

    expect(result.after.height).not.toBe(result.before.height);
  });

  it("**둘 다 없으면 거절한다**", async () => {
    await expect(invoke(setup(), "photoshop.canvas.resize", {})).rejects.toThrow();
  });

  it("**모르는 기준점은 거절한다**", async () => {
    /* 기준점이 다르면 어느 쪽이 잘리는지가 달라진다 — 조용히 가운데로
     * 떨어뜨리면 호출자가 왼쪽을 남긴 줄 안다. */
    await expect(
      invoke(setup(), "photoshop.canvas.resize", { width: 100, anchor: "center" }),
    ).rejects.toThrow();
  });

  it("**기준점을 생략하면 결과가 null 이다**", async () => {
    /* Photoshop 기본값이 무엇인지 우리가 정하지 않는다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.canvas.resize", { width: 100 })) as {
      anchor: string | null;
    };

    expect(result.anchor).toBeNull();
  });

  it("**0 이나 음수는 거절한다**", async () => {
    await expect(invoke(setup(), "photoshop.canvas.resize", { width: 0 })).rejects.toThrow();
    await expect(invoke(setup(), "photoshop.canvas.resize", { height: -1 })).rejects.toThrow();
  });
});
