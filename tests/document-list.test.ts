import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.document.list`. (CORE_API §5 P1)
 *
 * `document.get` 은 활성 문서 하나만 준다. 문서를 여러 개 열어 두고 오가는
 * 작업에서는 무엇이 열려 있는지부터 알아야 한다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> & { bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  return {
    ...createPhotoshopMcp({
      bridge,
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit"] as never),
    }),
    bridge,
  };
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

describe("document.list", () => {
  it("**read 다** — 문서를 바꾸지 않는다", () => {
    expect(setup().tools.get("photoshop.document.list")?.permission).toBe("read");
    expect(setup().commands.permissionOf("DOCUMENT_LIST")).toBe("read");
  });

  it("**active 를 함께 준다**", async () => {
    /* 편집 Tool 은 대상을 생략하면 활성 문서를 쓴다. 어느 것이 활성인지
     * 모르면 결과를 예측할 수 없다 — layer.get_active 와 같은 자리다. */
    const { documents } = (await invoke(setup(), "photoshop.document.list")) as {
      documents: { id: number; name: string; active: boolean }[];
    };
    expect(documents).toHaveLength(1);
    expect(documents[0]).toHaveProperty("active", true);
    // document.get 과 같은 필드를 그대로 쓴다. 문서 모양이 둘로 갈리지 않는다.
    expect(documents[0]).toHaveProperty("width");
    expect(documents[0]).toHaveProperty("colorMode");
  });

  it("**문서가 없으면 빈 배열이다. 던지지 않는다**", async () => {
    /* Photoshop 을 켜 두고 아무것도 안 연 상태는 정상이다. 여기서 던지면
     * 호출자가 "무엇이 열려 있나" 를 물을 수 없게 된다 — document.get 이
     * DOCUMENT_NOT_FOUND 를 던지는 것과 갈리는 지점이다. */
    const mcp = setup();
    mcp.bridge.setDocument(null);

    await expect(invoke(mcp, "photoshop.document.list")).resolves.toEqual({ documents: [] });
    // 같은 상태에서 document.get 은 여전히 던진다.
    await expect(invoke(mcp, "photoshop.document.get")).rejects.toThrow();
  });

  it("선언하지 않은 파라미터는 거절한다", async () => {
    await expect(invoke(setup(), "photoshop.document.list", { all: true })).rejects.toThrow();
  });
});
