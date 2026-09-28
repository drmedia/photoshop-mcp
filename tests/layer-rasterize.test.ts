import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { LayerRasterizeParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.layer.rasterize`. (CORE_API §5 P2)
 *
 * **`smart_object.rasterize` 가 아니라 `layer.rasterize` 다.** 실제 API 가
 * `Layer.rasterize(target)` 이고 스마트 오브젝트만의 일이 아니다 — 텍스트 ·
 * 모양 · 레이어 스타일도 같은 메서드로 굽는다. (ROADMAP §45)
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

describe("layer.rasterize", () => {
  it("**destructive 다** — 스마트 오브젝트의 원본이 사라진다", () => {
    expect(setup().tools.get("photoshop.layer.rasterize")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("LAYER_RASTERIZE")).toBe("destructive");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.layer.rasterize", { layerId: 11 }),
    ).rejects.toThrow();
  });

  it("**target 을 생략하면 entireLayer 다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.rasterize", { layerId: 11 })) as {
      target: string;
    };

    expect(result.target).toBe("entireLayer");
  });

  /**
   * **열 가지 중 여섯만 연다.** `linkedLayers` · `placed` · `video` ·
   * `layerClippingPath` 는 이 서버의 쓰임과 멀다 — 안 쓰는 값이 스키마에
   * 있으면 호출자가 무엇이 중요한지 모른다.
   */
  it("**여섯만 받는다**", () => {
    for (const target of [
      "entireLayer",
      "layerStyle",
      "textContents",
      "shape",
      "vectorMask",
      "fillContent",
    ]) {
      expect(LayerRasterizeParamsSchema.safeParse({ target }).success).toBe(true);
    }
    for (const target of ["linkedLayers", "placed", "video", "layerClippingPath"]) {
      expect(LayerRasterizeParamsSchema.safeParse({ target }).success).toBe(false);
    }
  });

  /**
   * **종류가 픽셀로 바뀌는 것**이 요점이다. Mock 이 이것을 지키지 않으면
   * "구웠는데 아직 스마트 오브젝트" 라는 있을 수 없는 상태가 정상으로 보인다.
   */
  it("**굽고 나면 픽셀 레이어다**", async () => {
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer.get", { layerId: 11 })) as {
      layer: { type: string };
    };
    expect(before.layer.type).not.toBe("pixel");

    const result = (await invoke(mcp, "photoshop.layer.rasterize", { layerId: 11 })) as {
      layer: { type: string };
      previousType: string;
    };

    expect(result.layer.type).toBe("pixel");
    expect(result.previousType).toBe(before.layer.type);
  });

  /**
   * **id 가 바뀔 수 있다.** `smart_object.convert` 가 그랬다. 호출자가 들고
   * 있던 id 를 갈아 끼울 수 있도록 `previousId` 를 함께 준다.
   */
  it("**previousId 를 함께 준다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.rasterize", { layerId: 11 })) as {
      layer: { id: number };
      previousId: number;
    };

    expect(result.previousId).toBe(11);
    expect(typeof result.layer.id).toBe("number");
  });

  /**
   * **할 일이 없어도 오류가 아니다.** 이미 픽셀인 레이어에 걸어도 Photoshop 이
   * 조용히 성공한다 — 실기에서 확인했다(ROADMAP §45). 처음에는 Tool 설명에
   * "실패한다" 고 적었다가 재 보고 고쳤다.
   */
  it("**이미 픽셀이어도 성공한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.rasterize", { layerId: 11 });
    const again = (await invoke(mcp, "photoshop.layer.rasterize", { layerId: 11 })) as {
      previousType: string;
      layer: { type: string };
    };

    // previousType 이 pixel 이면 아무 일도 없었다는 뜻이다.
    expect(again.previousType).toBe("pixel");
    expect(again.layer.type).toBe("pixel");
  });

  it("**모르는 파라미터는 거절한다**", () => {
    expect(LayerRasterizeParamsSchema.safeParse({ flatten: true }).success).toBe(false);
  });

  it("**없는 레이어는 실패한다**", async () => {
    await expect(invoke(setup(), "photoshop.layer.rasterize", { layerId: 9999 })).rejects.toThrow();
  });
});
