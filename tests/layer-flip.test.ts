import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { LayerFlipParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.layer.flip`. (CORE_API §5 P2)
 *
 * **Tool 을 둘로 나누지 않았다.** DOM 이 `flip(axis)` 하나이고 축이 셋이라,
 * `flip_horizontal` / `flip_vertical` 로 나누면 `both` 를 쓸 수 없다.
 * (ROADMAP §44)
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

describe("layer.flip", () => {
  it("**edit 다** — 두 번 부르면 제자리다", () => {
    expect(setup().tools.get("photoshop.layer.flip")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("LAYER_FLIP")).toBe("edit");
  });

  it("**축 셋을 모두 받는다**", () => {
    for (const axis of ["horizontal", "vertical", "both"]) {
      expect(LayerFlipParamsSchema.safeParse({ axis }).success).toBe(true);
    }
  });

  it("**axis 는 필수다**", () => {
    /* 기본값을 두면 호출자가 어느 축으로 뒤집혔는지 모른다. */
    expect(LayerFlipParamsSchema.safeParse({}).success).toBe(false);
    expect(LayerFlipParamsSchema.safeParse({ layerId: 12 }).success).toBe(false);
  });

  it("**모르는 축은 거절한다**", () => {
    expect(LayerFlipParamsSchema.safeParse({ axis: "diagonal" }).success).toBe(false);
    expect(LayerFlipParamsSchema.safeParse({ axis: "x" }).success).toBe(false);
  });

  it("**쓴 축을 그대로 돌려준다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.flip", {
      layerId: 12,
      axis: "both",
    })) as { axis: string };

    expect(result.axis).toBe("both");
  });

  /**
   * **Mock 은 경계를 지어내지 않는다.** 픽셀을 모르므로 `null` 이다 —
   * 그럴듯한 사각형을 주면 그것을 보고 판단한 워크플로가 실기에서 다르게
   * 돈다. `LAYER_GET` 의 `bounds` 와 같은 규칙이다.
   */
  it("**Mock 은 경계를 지어내지 않는다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.flip", {
      layerId: 12,
      axis: "horizontal",
    })) as { before: unknown; after: unknown };

    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
  });

  it("**없는 레이어는 실패한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.flip", { layerId: 9999, axis: "horizontal" }),
    ).rejects.toThrow();
  });

  it("**되돌리기는 한 번 더 부르는 것이다**", async () => {
    /* 별도의 되돌리기 파라미터를 두지 않는다 — 같은 축으로 두 번이면 제자리다. */
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.flip", { layerId: 12, axis: "vertical" });
    const again = (await invoke(mcp, "photoshop.layer.flip", {
      layerId: 12,
      axis: "vertical",
    })) as { layer: { id: number } };

    expect(again.layer.id).toBe(12);
  });
});
