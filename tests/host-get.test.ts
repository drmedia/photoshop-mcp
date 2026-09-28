import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.host.get`. (CORE_API §5 P1, §8)
 *
 * `capabilities.get` 과 `version.get` 이 여기로 흡수됐다. 버전만 돌려주는 Tool 로
 * 두지 않는 이유는 이 프로젝트가 같은 질문을 네 번 실기에서 확인했기 때문이다 —
 * `document.histogram`(없었다) · `document.rotate`(있었다) ·
 * `SaveOptions.DONOTSAVECHANGES` · `imaging.getLayerMask`.
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

describe("host.get", () => {
  it("**read 다** — 문서를 바꾸지 않는다", () => {
    expect(setup().tools.get("photoshop.host.get")?.permission).toBe("read");
    expect(setup().commands.permissionOf("HOST_GET")).toBe("read");
  });

  it("버전과 기능 유무를 함께 준다", async () => {
    const result = await invoke(setup(), "photoshop.host.get");
    expect(result).toHaveProperty("version");
    expect(result).toHaveProperty("features");
    expect(result["features"]).toHaveProperty("imagingGetPixels");
    expect(result["features"]).toHaveProperty("imagingGetLayerMask");
  });

  it("**문서가 없으면 `document.*` 는 false 가 아니라 null 이다**", async () => {
    /* 문서 메서드는 문서에 붙어 있어 문서 없이는 확인할 수 없다. false 로
     * 답하면 "이 Photoshop 에는 없다" 는 틀린 사실을 말하게 된다.
     * openDocuments 가 그 이유를 설명한다. */
    const mcp = setup();
    mcp.bridge.setDocument(null);

    const result = await invoke(mcp, "photoshop.host.get");
    expect(result["openDocuments"]).toBe(0);
    const features = result["features"] as Record<string, unknown>;
    expect(features["documentRotate"]).toBeNull();
    expect(features["documentHistogram"]).toBeNull();
    expect(features["selectionDom"]).toBeNull();
    expect(features["layerComps"]).toBeNull();

    // 문서와 무관한 것은 문서가 없어도 답할 수 있다.
    expect(typeof features["imagingGetPixels"]).toBe("boolean");
  });

  it("문서가 있으면 `document.*` 가 boolean 이다", async () => {
    const result = await invoke(setup(), "photoshop.host.get");
    expect(result["openDocuments"]).toBe(1);
    const features = result["features"] as Record<string, unknown>;
    expect(typeof features["documentRotate"]).toBe("boolean");
  });

  it("**Mock 은 다 된다고 답하지 않는다**", async () => {
    /* 가짜가 전부 true 를 주면 그것을 보고 짠 워크플로가 실기에서 다르게 돈다.
     * Mock 은 픽셀을 모르므로 픽셀 계열은 false 다. */
    const features = (await invoke(setup(), "photoshop.host.get"))["features"] as Record<
      string,
      unknown
    >;
    expect(features["imagingGetPixels"]).toBe(false);
    expect(features["imagingGetLayerMask"]).toBe(false);
  });

  it("**안 쓰는 것도 보고한다** — 호스트가 가졌는지와 우리가 쓰는지는 다르다", async () => {
    /* layerComps · pathItems 는 이 서버에 Tool 이 없다. 그래도 담는 이유는
     * "만들 수 있는가" 를 미리 판단할 근거이기 때문이다 — 어제
     * imaging.getLayerMask 를 필요해진 뒤에야 확인한 일이 있었다.
     *
     * 처음에는 안 쓰는 것을 빼려 했는데, 그러면 host.get 이 "호스트가
     * 무엇을 가졌나" 가 아니라 "우리가 무엇을 쓰나" 가 된다. 이름과 다르다. */
    const features = (await invoke(setup(), "photoshop.host.get"))["features"] as Record<
      string,
      unknown
    >;
    for (const key of ["notifications", "selectionDom", "layerComps", "pathItems"]) {
      expect(features, `${key} 이 없습니다`).toHaveProperty(key);
    }
  });

  it("**platform 은 서버가 붙인다**", async () => {
    /* UXP 가 플랫폼을 알려주는지 확인되지 않아 짐작하지 않고 서버의
     * process.platform 을 쓴다. Bridge 가 localhost 라 같은 기계다.
     * Plugin 과 서버가 각자 보내면 어긋날 수 있으므로 한 곳에서만 만든다. */
    const result = await invoke(setup(), "photoshop.host.get");
    expect(result["platform"]).toBe(process.platform);
  });

  it("선언하지 않은 파라미터는 거절한다", async () => {
    await expect(invoke(setup(), "photoshop.host.get", { verbose: true })).rejects.toThrow();
  });
});
