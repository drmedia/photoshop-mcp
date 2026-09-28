import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.mask.invert`. (CORE_API §5 P1)
 *
 * `{_obj:"invert"}` 에 **타깃이 없다** — 지금 선택된 대상에 걸린다.
 * descriptor 는 `["all"]` 알림으로 사람이 `이미지 > 조정 > 반전` 을 실행하는
 * 것을 잡아 확인했다. (ROADMAP §32)
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

async function withMask(mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> {
  const created = (await invoke(mcp, "photoshop.layer.create", { name: "M" })) as { id: number };
  await invoke(mcp, "photoshop.mask.create", { layerId: created.id });
  return created.id;
}

describe("mask.invert", () => {
  it("**edit 다**", () => {
    expect(setup().tools.get("photoshop.mask.invert")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("MASK_INVERT")).toBe("edit");
  });

  it("**마스크가 없으면 거절한다**", async () => {
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.layer.create", { name: "N" })) as { id: number };

    await expect(invoke(mcp, "photoshop.mask.invert", { layerId: created.id })).rejects.toThrow(
      /마스크가 없습니다/,
    );
  });

  /**
   * **편집 대상을 부르기 전 상태로 되돌린다.** 이 Command 는 대상을 잠깐
   * 마스크로 옮기는데, 남겨 두면 뒤따르는 필터·조정이 조용히 마스크에 걸린다.
   */
  it("**픽셀이 대상이었으면 픽셀로 돌아온다**", async () => {
    const mcp = setup();
    const id = await withMask(mcp);
    const result = (await invoke(mcp, "photoshop.mask.invert", { layerId: id })) as {
      editTarget: string;
    };

    expect(result.editTarget).toBe("pixels");
  });

  it("**마스크가 대상이었으면 마스크에 남긴다**", async () => {
    /* 호출자가 일부러 옮겨 둔 것을 되돌리지 않는다. */
    const mcp = setup();
    const id = await withMask(mcp);
    await invoke(mcp, "photoshop.mask.select", { layerId: id, target: "mask" });
    const result = (await invoke(mcp, "photoshop.mask.invert", { layerId: id })) as {
      editTarget: string;
    };

    expect(result.editTarget).toBe("mask");
  });

  it("**선택 영역을 뒤집는 selection.invert 와 다른 Tool 이다**", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.mask.invert")).toBeDefined();
    expect(mcp.tools.get("photoshop.selection.invert")).toBeDefined();
  });

  it("**layerId 를 생략하면 활성 레이어다**", async () => {
    const mcp = setup();
    const id = await withMask(mcp);
    const result = (await invoke(mcp, "photoshop.mask.invert")) as { layer: { id: number } };

    expect(result.layer.id).toBe(id);
  });
});
