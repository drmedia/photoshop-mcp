import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.layer.get`. (CORE_API §5 P1)
 *
 * `layer.list` 는 레이어마다 한 줄이라 경계를 담지 않는다. 실기에서 외부
 * 처리기가 돌려준 레이어가 135px 위로 밀렸는데 확인할 방법이 없어 가로 띠를
 * 여러 번 재서 알아냈다(ROADMAP §28). `bounds` 하나면 끝나는 일이었다.
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

describe("layer.get", () => {
  it("**read 다** — 문서를 바꾸지 않는다", () => {
    expect(setup().tools.get("photoshop.layer.get")?.permission).toBe("read");
    expect(setup().commands.permissionOf("LAYER_GET")).toBe("read");
  });

  it("layer.list 와 같은 레이어 모양을 담는다", async () => {
    // 두 Tool 이 다른 말을 하면 안 된다. 같은 조립부를 쓴다.
    const result = await invoke(setup(), "photoshop.layer.get", { layerId: 10 });
    expect(result["layer"]).toMatchObject({ id: 10 });
  });

  it("layerId 를 생략하면 활성 레이어", async () => {
    const result = await invoke(setup(), "photoshop.layer.get");
    expect(result["layer"]).toMatchObject({ id: 10 });
  });

  it("**Mock 은 경계를 지어내지 않는다**", async () => {
    /* 픽셀을 모르므로 bounds 는 null 이다. 그럴듯한 사각형을 주면 그것을 보고
     * "제자리에 놓였다" 고 판단한 워크플로가 실기에서 다르게 돈다. */
    const result = await invoke(setup(), "photoshop.layer.get", { layerId: 10 });
    expect(result["bounds"]).toBeNull();
    expect(result["fillOpacity"]).toBeNull();
  });

  it("없는 레이어는 LAYER_NOT_FOUND 다", async () => {
    await expect(invoke(setup(), "photoshop.layer.get", { layerId: 999 })).rejects.toThrow();
  });

  it("선언하지 않은 파라미터는 거절한다", async () => {
    await expect(invoke(setup(), "photoshop.layer.get", { deep: true })).rejects.toThrow();
  });
});
