import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.layer.set_fill_opacity`. (CORE_API §5 P1)
 *
 * `opacity` 와 **다른 값**이다 — 픽셀만 투명해지고 레이어 스타일은 남는다.
 * Adobe UXP 레퍼런스가 둘을 따로 두며 `opacity` 를 "master opacity" 라고 부른다.
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

describe("layer.set_fill_opacity", () => {
  it("**edit 다**", () => {
    expect(setup().tools.get("photoshop.layer.set_fill_opacity")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("LAYER_FILL_OPACITY")).toBe("edit");
  });

  it("**결과가 { layer, fillOpacity } 다**", async () => {
    /* 다른 레이어 편집은 LayerInfo 하나를 주는데 여기만 감싼다 — LayerInfo 에
     * fillOpacity 가 없어 평탄하면 값을 확인할 수 없다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.set_fill_opacity", {
      layerId: 12,
      fillOpacity: 40,
    })) as { layer: { id: number }; fillOpacity: number };

    expect(result.layer.id).toBe(12);
    expect(result.fillOpacity).toBe(40);
  });

  it("**opacity 를 건드리지 않는다**", async () => {
    /* 둘은 곱해지는 별개 값이다. 한쪽을 쓰면서 다른 쪽을 같이 바꾸면
     * 호출자가 그것을 모른 채 두 번 어두워진다. */
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer.get", { layerId: 12 })) as {
      layer: { opacity: number };
    };
    const result = (await invoke(mcp, "photoshop.layer.set_fill_opacity", {
      layerId: 12,
      fillOpacity: 30,
    })) as { layer: { opacity: number } };

    expect(result.layer.opacity).toBe(before.layer.opacity);
  });

  it("**layer.get 이 쓴 값을 그대로 보고한다**", async () => {
    /* 쓰고 나서 읽었을 때 다른 말이 나오면 두 Tool 중 하나가 거짓말이다. */
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.set_fill_opacity", { layerId: 12, fillOpacity: 55 });
    const got = (await invoke(mcp, "photoshop.layer.get", { layerId: 12 })) as {
      fillOpacity: number | null;
    };

    expect(got.fillOpacity).toBe(55);
  });

  it("**건드린 적 없으면 null 이다**", async () => {
    /* Mock 이 100 으로 채우면 실기에 없는 사실을 말하게 된다 —
     * 못 읽은 것과 100 인 것은 다르다. */
    const got = (await invoke(setup(), "photoshop.layer.get", { layerId: 12 })) as {
      fillOpacity: number | null;
    };

    expect(got.fillOpacity).toBeNull();
  });

  it("**layerId 를 생략하면 활성 레이어다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.select", { layerId: 12 });
    const active = (await invoke(mcp, "photoshop.layer.get_active")) as { layer: { id: number } };
    const result = (await invoke(mcp, "photoshop.layer.set_fill_opacity", {
      fillOpacity: 20,
    })) as { layer: { id: number } };

    expect(result.layer.id).toBe(active.layer.id);
  });

  it("**범위 밖은 거절한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer.select", { layerId: 12 });
    await expect(
      invoke(mcp, "photoshop.layer.set_fill_opacity", { fillOpacity: 101 }),
    ).rejects.toThrow();
    await expect(
      invoke(mcp, "photoshop.layer.set_fill_opacity", { fillOpacity: -1 }),
    ).rejects.toThrow();
  });

  /**
   * **배경 레이어는 `opacity` 와 다르게 실패한다.** 실기에서 확인했다.
   * `set_opacity` 는 승격되면 값도 들어갔는데 이쪽은 승격만 하고 만다.
   */
  it("**배경이 유일하면 승격만 되고 실패한다 — 새 id 를 알려준다**", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({
        document: {
          id: 1,
          name: "bg.psd",
          width: 10,
          height: 10,
          bitDepth: 8,
          colorMode: "rgb",
        },
        layers: [
          {
            id: 1,
            name: "배경",
            type: "pixel",
            visible: true,
            opacity: 100,
            parentId: null,
            blendMode: "normal",
            isBackground: true,
          },
        ],
      }),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit"] as never),
    });

    /* 실패하지만 **문서는 이미 바뀌었다.** 그 사실을 말하지 않으면 호출자가
     * 아무 일도 없었다고 믿는다 — 이 프로젝트에서 가장 나쁜 실패 유형이다. */
    await expect(
      invoke(mcp, "photoshop.layer.set_fill_opacity", { layerId: 1, fillOpacity: 50 }),
    ).rejects.toThrow(/승격/);

    const after = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; isBackground?: boolean }[];
    };
    expect(after.layers[0]?.id).not.toBe(1);
    expect(after.layers[0]?.isBackground).toBeUndefined();

    // 알려준 새 id 로 다시 부르면 적용된다.
    const retry = (await invoke(mcp, "photoshop.layer.set_fill_opacity", {
      layerId: after.layers[0]?.id,
      fillOpacity: 50,
    })) as { fillOpacity: number };
    expect(retry.fillOpacity).toBe(50);
  });

  it("**레이어가 둘 이상이면 배경은 조용히 무시된다 — 실패로 보고한다**", async () => {
    /* Photoshop 이 예외도 안 내고 값도 그대로 둔다. 성공으로 보고하면
     * 호출자는 적용되었다고 믿는다. */
    const mcp = setup();
    const layers = (await invoke(mcp, "photoshop.layer.list")) as {
      layers: { id: number; isBackground?: boolean }[];
    };
    const background = layers.layers.find((layer) => layer.isBackground === true);
    expect(background).toBeDefined();

    await expect(
      invoke(mcp, "photoshop.layer.set_fill_opacity", {
        layerId: background?.id,
        fillOpacity: 50,
      }),
    ).rejects.toThrow(/배경 레이어/);
  });

  it("**없는 레이어는 실패한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.set_fill_opacity", { layerId: 9999, fillOpacity: 50 }),
    ).rejects.toThrow();
  });
});
