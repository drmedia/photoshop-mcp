import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { DocumentTrimParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.document.trim`. (CORE_API §5)
 *
 * **무엇을 남길지 Photoshop 이 픽셀을 보고 정한다.** `crop` 은 좌표로,
 * `canvas.resize` 는 크기와 기준점으로 정한다. (ROADMAP §37)
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

describe("document.trim", () => {
  it("**destructive 다** — canvas.resize 와 같은 자리", () => {
    expect(setup().tools.get("photoshop.document.trim")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("DOCUMENT_TRIM")).toBe("destructive");
    // crop 은 픽셀을 남기므로 edit 이다.
    expect(setup().commands.permissionOf("DOCUMENT_CROP")).toBe("edit");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.document.trim", { mode: "transparent" }),
    ).rejects.toThrow();
  });

  /**
   * **Mock 은 할 수 없는 것을 한 척하지 않는다.** 무엇을 여백으로 볼지는
   * 픽셀을 봐야 정해지는데 Mock 에는 픽셀이 없다 — `measure.tilt` 가 각도를
   * 지어내지 않는 것과 같은 규칙이다.
   */
  it("**Mock 은 재단하지 않고 실패한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.document.trim", { mode: "transparent" }),
    ).rejects.toThrow(/실제 Photoshop 연결이 필요합니다/);
  });

  it("**mode 는 필수다**", () => {
    /* 무엇을 여백으로 볼지는 짐작할 수 없다. 기본값을 두면 투명이 아닌
     * 문서에서 엉뚱한 색을 여백으로 잡는다. */
    expect(DocumentTrimParamsSchema.safeParse({}).success).toBe(false);
    expect(DocumentTrimParamsSchema.safeParse({ mode: "transparent" }).success).toBe(true);
  });

  it("**모르는 mode 는 거절한다**", () => {
    expect(DocumentTrimParamsSchema.safeParse({ mode: "white" }).success).toBe(false);
  });

  it("**면을 고를 수 있다**", () => {
    expect(
      DocumentTrimParamsSchema.safeParse({ mode: "topLeft", top: false, bottom: false }).success,
    ).toBe(true);
  });

  it("**모르는 파라미터는 거절한다**", () => {
    expect(DocumentTrimParamsSchema.safeParse({ mode: "topLeft", tolerance: 10 }).success).toBe(
      false,
    );
  });
});
