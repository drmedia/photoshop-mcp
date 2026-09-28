import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.mask.select`. (CORE_API §5 P1)
 *
 * 필터·조정은 **지금 선택된 채널**에 걸린다. 마스크를 편집 대상으로 두면
 * `filter.gaussian_blur` 가 마스크 경계를 다듬는다. descriptor 는 짐작하지 않고
 * `["all"]` 알림으로 사람이 썸네일을 클릭하는 것을 잡아 확인했다. (ROADMAP §31)
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

/** 마스크가 붙은 레이어 하나를 만들어 id 를 돌려준다. */
async function withMask(mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> {
  const created = (await invoke(mcp, "photoshop.layer.create", { name: "M" })) as { id: number };
  await invoke(mcp, "photoshop.mask.create", { layerId: created.id });
  return created.id;
}

describe("mask.select", () => {
  it("**edit 다** — 픽셀을 바꾸지 않고 대상만 옮긴다", () => {
    expect(setup().tools.get("photoshop.mask.select")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("MASK_SELECT")).toBe("edit");
  });

  it("**기본은 마스크다**", async () => {
    const mcp = setup();
    const id = await withMask(mcp);
    const result = (await invoke(mcp, "photoshop.mask.select", { layerId: id })) as {
      target: string;
    };

    expect(result.target).toBe("mask");
  });

  /**
   * **양방향이 한 Tool 에 있다.** 마스크로 보내는 길만 있으면 호출자가 돌아올 수
   * 없고, 그 뒤의 모든 편집이 조용히 마스크에 걸린다.
   */
  it("**target: pixels 로 되돌린다**", async () => {
    const mcp = setup();
    const id = await withMask(mcp);
    await invoke(mcp, "photoshop.mask.select", { layerId: id });
    const back = (await invoke(mcp, "photoshop.mask.select", {
      layerId: id,
      target: "pixels",
    })) as { target: string };

    expect(back.target).toBe("pixels");
  });

  it("**마스크가 없으면 거절한다**", async () => {
    /* Photoshop 은 "명령을 사용할 수 없습니다" 라고만 답해 이유를 알 수 없다 —
     * Camera Raw 가 숨긴 레이어를 미리 막는 것과 같은 자리다. */
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.layer.create", { name: "N" })) as { id: number };

    await expect(invoke(mcp, "photoshop.mask.select", { layerId: created.id })).rejects.toThrow(
      /마스크가 없습니다/,
    );
  });

  it("**마스크가 없어도 pixels 는 된다**", async () => {
    /* 되돌리는 길까지 막으면 마스크를 잃은 뒤 빠져나올 수 없다. */
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.layer.create", { name: "N" })) as { id: number };
    const back = (await invoke(mcp, "photoshop.mask.select", {
      layerId: created.id,
      target: "pixels",
    })) as { target: string };

    expect(back.target).toBe("pixels");
  });

  it("**Mock 은 activeChannels 를 지어내지 않는다**", async () => {
    /* 그럴듯한 이름을 주면 그것을 보고 판단한 워크플로가 실기에서 다르게 돈다 —
     * LAYER_GET 의 bounds 와 같은 규칙이다. */
    const mcp = setup();
    const id = await withMask(mcp);
    const result = (await invoke(mcp, "photoshop.mask.select", { layerId: id })) as {
      activeChannels: string[] | null;
    };

    expect(result.activeChannels).toBeNull();
  });

  it("**Mock 은 verified 를 참이라고 하지 않는다**", async () => {
    /* 물어볼 Photoshop 이 없으므로 확인한 것이 없다. true 로 두면
     * "확인했다" 는 거짓이 테스트에 사실로 굳는다. */
    const mcp = setup();
    const id = await withMask(mcp);
    const result = (await invoke(mcp, "photoshop.mask.select", { layerId: id })) as {
      verified: boolean;
    };

    expect(result.verified).toBe(false);
  });

  it("**알 수 없는 target 은 거절한다**", async () => {
    const mcp = setup();
    const id = await withMask(mcp);
    await expect(
      invoke(mcp, "photoshop.mask.select", { layerId: id, target: "channel" }),
    ).rejects.toThrow();
  });
});
