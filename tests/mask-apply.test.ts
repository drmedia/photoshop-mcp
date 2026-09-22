import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 마스크 굽기. (CORE_API §4, §9)
 *
 * GraXpert 하늘 경로가 남기는 것은 **마스크가 달린** 레이어다. 가려진 쪽에는
 * 우리가 만든 합성 평면이 들어 있어서, 마스크를 끄면 그것이 드러난다.
 * 구우면 가려진 곳이 투명해지고 아래의 원본이 그대로 보인다.
 */

function setup(
  allow: string[] = ["read", "edit", "destructive"],
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

describe("mask.apply", () => {
  it("**destructive 다**", () => {
    // CORE_API §9 가 처음부터 이렇게 분류해 두었다. 마스크는 가리기만 하므로
    // 끄면 되살아나지만, 구우면 가려진 픽셀이 실제로 없어진다.
    expect(setup().tools.get("photoshop.mask.apply")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("MASK_APPLY")).toBe("destructive");
  });

  it("기본 허용(read · edit)에서는 막힌다", async () => {
    const mcp = setup(["read", "edit"]);
    await expect(invoke(mcp, "photoshop.mask.apply", { layerId: 11 })).rejects.toThrow(
      /destructive/u,
    );
  });

  it("굽고 나면 마스크가 없어진다", async () => {
    const mcp = setup();
    await expect(invoke(mcp, "photoshop.mask.create", { layerId: 11 })).resolves.toMatchObject({
      id: 11,
      hasMask: true,
    });
    await expect(invoke(mcp, "photoshop.mask.apply", { layerId: 11 })).resolves.toMatchObject({
      id: 11,
      hasMask: false,
    });
  });

  it("마스크가 없으면 무엇을 해야 하는지 알려준다", async () => {
    const mcp = setup();
    await expect(invoke(mcp, "photoshop.mask.apply", { layerId: 11 })).rejects.toThrow(
      /mask\.create/u,
    );
  });

  it("layerId 를 생략하면 활성 레이어를 대상으로 한다", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.mask.create");
    await expect(invoke(mcp, "photoshop.mask.apply")).resolves.toMatchObject({
      id: 10,
      hasMask: false,
    });
  });

  it("없는 레이어는 실패한다", async () => {
    const mcp = setup();
    await expect(invoke(mcp, "photoshop.mask.apply", { layerId: 999 })).rejects.toThrow();
  });
});
