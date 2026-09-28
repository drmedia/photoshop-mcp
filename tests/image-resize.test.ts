import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.image.resize`. (CORE_API §5 P1)
 *
 * **`document.crop` 과 갈린다.** `crop` 이 `edit` 인 근거는 "픽셀은 버리지
 * 않는다" 이고, 축소는 버린다. 그래서 `destructive` 다. (ROADMAP §33)
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

describe("image.resize", () => {
  it("**destructive 다** — crop 과 갈리는 자리", () => {
    expect(setup().tools.get("photoshop.image.resize")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("IMAGE_RESIZE")).toBe("destructive");
    // 비교 대상: crop 은 픽셀을 버리지 않으므로 edit 이다.
    expect(setup().commands.permissionOf("DOCUMENT_CROP")).toBe("edit");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.image.resize", { width: 100 }),
    ).rejects.toThrow();
  });

  /**
   * **아무것도 주지 않은 호출을 스키마에서 끊는다.** 통과시키면 Photoshop 이
   * 아무 일도 안 하고 성공을 돌려주고 호출자는 크기가 바뀐 줄 안다.
   */
  it("**셋 다 없으면 거절한다**", async () => {
    await expect(invoke(setup(), "photoshop.image.resize", {})).rejects.toThrow();
  });

  it("**before 와 after 를 함께 준다**", async () => {
    /* 한쪽만 주었을 때 비율이 유지되는지 Adobe 레퍼런스가 말하지 않는다.
     * 짐작해 적는 대신 바꾼 뒤 읽어서 실제 값을 돌려준다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.image.resize", { width: 3024 })) as {
      before: { width: number; height: number };
      after: { width: number; height: number };
    };

    expect(result.before.width).toBe(6048);
    expect(result.after.width).toBe(3024);
  });

  it("**한쪽만 주면 비율을 지킨다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.image.resize", { width: 3024 })) as {
      before: { width: number; height: number };
      after: { width: number; height: number };
    };

    const beforeRatio = result.before.width / result.before.height;
    const afterRatio = result.after.width / result.after.height;
    expect(Math.abs(beforeRatio - afterRatio)).toBeLessThan(0.01);
  });

  it("**applied 는 요청한 것만 담는다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.image.resize", { width: 3024 })) as {
      applied: Record<string, boolean>;
    };

    expect(result.applied["width"]).toBe(true);
    expect(result.applied).not.toHaveProperty("height");
    expect(result.applied).not.toHaveProperty("resolution");
  });

  it("**둘 다 주면 비율을 무시한다**", async () => {
    /* 실기에서 1920x1200 에 800x800 을 주니 그대로 800x800 이 됐다.
     * 왜곡을 막지 않는다 — 호출자가 의도한 경우가 있다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.image.resize", {
      width: 800,
      height: 800,
    })) as { after: { width: number; height: number } };

    expect(result.after.width).toBe(800);
    expect(result.after.height).toBe(800);
  });

  it("**모르는 리샘플 방식은 거절한다**", async () => {
    /* 조용히 기본 보간으로 떨어뜨리면 호출자가 preserveDetails 로 키운 줄
     * 알고 결과를 받는다 — mask.gradient 가 모르는 type 을 거절하는 것과 같다. */
    await expect(
      invoke(setup(), "photoshop.image.resize", { width: 100, resample: "lanczos" }),
    ).rejects.toThrow();
  });

  it("**0 이나 음수는 거절한다**", async () => {
    await expect(invoke(setup(), "photoshop.image.resize", { width: 0 })).rejects.toThrow();
    await expect(invoke(setup(), "photoshop.image.resize", { height: -1 })).rejects.toThrow();
  });
});
