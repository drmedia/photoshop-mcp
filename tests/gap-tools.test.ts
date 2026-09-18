import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import { ErrorCode, MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * ROADMAP §8.6 — 실기에서 드러난 공백.
 *
 * 기능 추가가 아니라 이미 있던 기능이 쓸 수 없던 상태를 고치는 것이므로,
 * "죽어 있던 경로가 살아났는지" 를 함께 검증한다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> & { bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  return { ...createPhotoshopMcp({ bridge }), bridge };
}

const call = async <T = unknown>(
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  input: unknown = {},
): Promise<T> => mcp.tools.invoke<T>(name, input, { requestId: "req-test" });

interface Layer {
  id: number;
  name: string;
  type: string;
  opacity: number;
  blendMode: string | null;
}

describe("selection.set", () => {
  it("사각형 선택을 만든다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.selection.set", {
        shape: "rectangle",
        bounds: { left: 10, top: 20, right: 110, bottom: 120 },
      }),
    ).resolves.toEqual({ hasSelection: true });
  });

  it("전체 선택과 레이어 투명도 선택을 지원한다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.selection.set", { shape: "canvas" })).resolves.toEqual({
      hasSelection: true,
    });
    await expect(
      call(mcp, "photoshop.selection.set", { shape: "layerTransparency", layerId: 10 }),
    ).resolves.toEqual({ hasSelection: true });
  });

  it("rectangle 과 ellipse 는 bounds 가 필요하다", async () => {
    const mcp = setup();
    for (const shape of ["rectangle", "ellipse"]) {
      await expect(call(mcp, "photoshop.selection.set", { shape })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    }
  });

  it("canvas 에는 bounds 를 쓸 수 없다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.selection.set", {
        shape: "canvas",
        bounds: { left: 0, top: 0, right: 10, bottom: 10 },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("뒤집힌 bounds 를 거부한다", async () => {
    const mcp = setup();
    for (const bounds of [
      { left: 100, top: 0, right: 10, bottom: 50 },
      { left: 0, top: 100, right: 50, bottom: 10 },
    ]) {
      await expect(
        call(mcp, "photoshop.selection.set", { shape: "rectangle", bounds }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });

  it("feather 범위를 검증한다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.selection.set", { shape: "canvas", feather: 1001 }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    await expect(
      call(mcp, "photoshop.selection.set", { shape: "canvas", feather: 10 }),
    ).resolves.toEqual({ hasSelection: true });
  });

  it("선택을 만들면 invert 와 fromSelection 이 살아난다", async () => {
    // 이 둘이 쓸 수 없던 것이 §8.6 의 출발점이다.
    const mcp = setup();

    await expect(call(mcp, "photoshop.selection.invert")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );

    await call(mcp, "photoshop.selection.set", { shape: "canvas" });

    await expect(call(mcp, "photoshop.selection.invert")).resolves.toEqual({ hasSelection: true });
    await expect(
      call(mcp, "photoshop.mask.create", { layerId: 10, from: "fromSelection" }),
    ).resolves.toMatchObject({ id: 10 });
  });
});

describe("layer.set_blend_mode", () => {
  it("혼합 모드를 바꾼다", async () => {
    const mcp = setup();
    await expect(
      call<Layer>(mcp, "photoshop.layer.set_blend_mode", { layerId: 10, blendMode: "screen" }),
    ).resolves.toMatchObject({ id: 10, blendMode: "screen" });
  });

  it("layerId 를 생략하면 활성 레이어를 대상으로 한다", async () => {
    const mcp = setup();
    await expect(
      call<Layer>(mcp, "photoshop.layer.set_blend_mode", { blendMode: "multiply" }),
    ).resolves.toMatchObject({ id: 10, blendMode: "multiply" });
  });

  it("목록에 반영된다", async () => {
    const mcp = setup();
    await call(mcp, "photoshop.layer.set_blend_mode", { layerId: 11, blendMode: "luminosity" });

    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers.find((layer) => layer.id === 11)?.blendMode).toBe("luminosity");
  });

  it("알 수 없는 혼합 모드를 거부한다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.layer.set_blend_mode", { blendMode: "밝게" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("blendMode 는 필수다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.layer.set_blend_mode", { layerId: 10 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("없는 레이어는 LAYER_NOT_FOUND 를 던진다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.layer.set_blend_mode", { layerId: 999, blendMode: "screen" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND }));
  });
});

describe("색보정 조정", () => {
  it("hue_saturation 조정 레이어를 만든다", async () => {
    const mcp = setup();
    await expect(
      call<Layer>(mcp, "photoshop.adjustment.hue_saturation", {
        hue: 10,
        saturation: -20,
        lightness: 5,
        name: "색조/채도",
      }),
    ).resolves.toMatchObject({ name: "색조/채도", type: "adjustment" });
  });

  it("vibrance 조정 레이어를 만든다", async () => {
    const mcp = setup();
    await expect(
      call<Layer>(mcp, "photoshop.adjustment.vibrance", { vibrance: 30, saturation: 5 }),
    ).resolves.toMatchObject({ name: "Vibrance", type: "adjustment" });
  });

  it("전부 생략할 수 있다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.adjustment.hue_saturation")).resolves.toMatchObject({
      type: "adjustment",
    });
    await expect(call(mcp, "photoshop.adjustment.vibrance")).resolves.toMatchObject({
      type: "adjustment",
    });
  });

  it("범위를 검증한다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.adjustment.hue_saturation", { hue: 181 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
    await expect(
      call(mcp, "photoshop.adjustment.hue_saturation", { saturation: -101 }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    await expect(call(mcp, "photoshop.adjustment.vibrance", { vibrance: 101 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});

describe("§8.6 이후 가능해진 워크플로", () => {
  it("선택 → 마스크 → 혼합 모드 → 조정", async () => {
    // Phase 6 의 milky.create_sky_mask / restore_stars 가 필요로 하는 조합이다.
    const mcp = setup();

    const copy = await call<Layer>(mcp, "photoshop.layer.duplicate");

    await call(mcp, "photoshop.selection.set", {
      shape: "rectangle",
      bounds: { left: 0, top: 0, right: 100, bottom: 50 },
      feather: 2,
    });
    await call(mcp, "photoshop.mask.create", { layerId: copy.id, from: "fromSelection" });
    await call(mcp, "photoshop.layer.set_blend_mode", { layerId: copy.id, blendMode: "screen" });
    const adjusted = await call<Layer>(mcp, "photoshop.adjustment.vibrance", { vibrance: 20 });

    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers.find((layer) => layer.id === copy.id)?.blendMode).toBe("screen");
    expect(layers[0]?.id).toBe(adjusted.id);
  });
});
