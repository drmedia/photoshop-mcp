import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import { ErrorCode, MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * Phase 4 조정 레이어. (ROADMAP §8.3)
 *
 * Mock Bridge 위에서 Tool → Command Engine → Bridge 경로와 파라미터 검증을 확인한다.
 * batchPlay descriptor 조립은 실기 확인 대상이다.
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
  parentId: number | null;
}

/** 중간톤 대비를 올리는 S 자 곡선. Phase 4 완료 기준 시나리오에서 쓰는 형태. */
const S_CURVE = [
  { input: 0, output: 0 },
  { input: 64, output: 54 },
  { input: 192, output: 202 },
  { input: 255, output: 255 },
];

describe("Phase 4 조정 Tool", () => {
  it("조정 Tool 3개를 등록한다", () => {
    const { tools, commands } = setup();
    for (const name of [
      "photoshop.adjustment.curves",
      "photoshop.adjustment.levels",
      "photoshop.adjustment.brightness_contrast",
    ]) {
      expect(tools.list().map((tool) => tool.name)).toContain(name);
    }
    for (const type of [
      "ADJUSTMENT_CURVES",
      "ADJUSTMENT_LEVELS",
      "ADJUSTMENT_BRIGHTNESS_CONTRAST",
    ]) {
      expect(commands.list()).toContain(type);
    }
  });

  it("조정 레이어를 만들고 맨 위에 넣는다", async () => {
    const mcp = setup();

    const layer = await call<Layer>(mcp, "photoshop.adjustment.curves", {
      points: S_CURVE,
      name: "Curves 1",
    });

    expect(layer).toMatchObject({ name: "Curves 1", type: "adjustment", parentId: null });
    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers[0]?.id).toBe(layer.id);
  });

  it("이름을 생략하면 기본 이름을 쓴다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.adjustment.curves", { points: S_CURVE }),
    ).resolves.toMatchObject({ name: "Curves", type: "adjustment" });
  });

  describe("curves 파라미터 검증", () => {
    it("제어점이 2개 미만이면 거부한다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.adjustment.curves", { points: [{ input: 0, output: 0 }] }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    });

    it("input 이 오름차순이 아니면 거부한다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.adjustment.curves", {
          points: [
            { input: 0, output: 0 },
            { input: 200, output: 200 },
            { input: 100, output: 100 },
          ],
        }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    });

    it("input 이 중복되면 거부한다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.adjustment.curves", {
          points: [
            { input: 0, output: 0 },
            { input: 128, output: 100 },
            { input: 128, output: 200 },
          ],
        }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    });

    it("0-255 범위를 벗어나면 거부한다", async () => {
      const mcp = setup();
      for (const points of [
        [
          { input: -1, output: 0 },
          { input: 255, output: 255 },
        ],
        [
          { input: 0, output: 0 },
          { input: 255, output: 256 },
        ],
      ]) {
        await expect(call(mcp, "photoshop.adjustment.curves", { points })).rejects.toThrow(
          expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
        );
      }
    });

    it("채널을 지정할 수 있다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.adjustment.curves", { channel: "red", points: S_CURVE }),
      ).resolves.toMatchObject({ type: "adjustment" });
      await expect(
        call(mcp, "photoshop.adjustment.curves", { channel: "cyan", points: S_CURVE }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    });
  });

  describe("levels 파라미터 검증", () => {
    it("입력 흰점이 검은점보다 작으면 거부한다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.adjustment.levels", { inputShadow: 200, inputHighlight: 100 }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    });

    it("감마 범위를 검증한다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.adjustment.levels", { gamma: 0 })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
      await expect(call(mcp, "photoshop.adjustment.levels", { gamma: 1.2 })).resolves.toMatchObject(
        {
          type: "adjustment",
        },
      );
    });

    it("전부 생략할 수 있다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.adjustment.levels")).resolves.toMatchObject({
        name: "Levels",
      });
    });
  });

  describe("brightness_contrast 파라미터 검증", () => {
    it("범위를 검증한다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.adjustment.brightness_contrast", { brightness: 200 }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
      await expect(
        call(mcp, "photoshop.adjustment.brightness_contrast", { contrast: -80 }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
      await expect(
        call(mcp, "photoshop.adjustment.brightness_contrast", { brightness: 20, contrast: 15 }),
      ).resolves.toMatchObject({ type: "adjustment" });
    });
  });

  it("문서가 없으면 DOCUMENT_NOT_FOUND 를 던진다", async () => {
    const mcp = setup();
    mcp.bridge.setDocument(null);
    await expect(call(mcp, "photoshop.adjustment.curves", { points: S_CURVE })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND }),
    );
  });

  it("Phase 4 완료 기준 시나리오: 복제 → Curves 조정 레이어 → 중간톤 대비", async () => {
    const mcp = setup();

    const copy = await call<Layer>(mcp, "photoshop.layer.duplicate");
    const curves = await call<Layer>(mcp, "photoshop.adjustment.curves", {
      points: S_CURVE,
      name: "중간톤 대비",
    });

    expect(curves).toMatchObject({ name: "중간톤 대비", type: "adjustment" });

    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    // 조정 레이어가 맨 위, 복제본이 그 아래에 있다.
    expect(layers[0]?.id).toBe(curves.id);
    expect(layers.some((layer) => layer.id === copy.id)).toBe(true);
  });

  it("조정도 undo 로 되돌릴 수 있다", async () => {
    const mcp = setup();
    const before = (await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).layers.length;

    await call(mcp, "photoshop.adjustment.curves", { points: S_CURVE });
    expect((await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).layers).toHaveLength(
      before + 1,
    );

    await call(mcp, "photoshop.history.undo");
    expect((await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).layers).toHaveLength(
      before,
    );
  });
});

describe("Phase 4 마스크 · 선택 Tool", () => {
  it("마스크·선택 Tool 5개를 등록한다", () => {
    const { tools, commands } = setup();
    for (const name of [
      "photoshop.mask.create",
      "photoshop.mask.enable",
      "photoshop.mask.disable",
      "photoshop.selection.clear",
      "photoshop.selection.invert",
    ]) {
      expect(tools.list().map((tool) => tool.name)).toContain(name);
    }
    for (const type of [
      "MASK_CREATE",
      "MASK_ENABLE",
      "MASK_DISABLE",
      "SELECTION_CLEAR",
      "SELECTION_INVERT",
    ]) {
      expect(commands.list()).toContain(type);
    }
  });

  it("마스크 삭제 Tool 은 등록하지 않는다", () => {
    // 가려둔 작업을 잃으므로 Permission System 과 함께 검토한다.
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    expect(names).not.toContain("photoshop.mask.delete");
  });

  describe("mask.create", () => {
    it("대상 레이어를 돌려준다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.mask.create", { layerId: 10 })).resolves.toMatchObject({
        id: 10,
      });
    });

    it("layerId 를 생략하면 활성 레이어를 대상으로 한다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.mask.create")).resolves.toMatchObject({ id: 10 });
    });

    it("from 값을 검증한다", async () => {
      const mcp = setup();
      for (const from of ["revealAll", "hideAll", "fromSelection"]) {
        await expect(call(mcp, "photoshop.mask.create", { from })).resolves.toMatchObject({
          id: 10,
        });
      }
      await expect(call(mcp, "photoshop.mask.create", { from: "partial" })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    });

    it("없는 레이어는 LAYER_NOT_FOUND 를 던진다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.mask.create", { layerId: 999 })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND }),
      );
    });
  });

  describe("mask.enable / disable", () => {
    it("대상 레이어를 돌려준다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.mask.disable", { layerId: 11 })).resolves.toMatchObject({
        id: 11,
      });
      await expect(call(mcp, "photoshop.mask.enable", { layerId: 11 })).resolves.toMatchObject({
        id: 11,
      });
    });
  });

  describe("selection", () => {
    it("선택을 해제한다", async () => {
      const mcp = setup();
      mcp.bridge.setSelection(true);
      await expect(call(mcp, "photoshop.selection.clear")).resolves.toEqual({
        hasSelection: false,
      });
    });

    it("선택이 없으면 반전할 수 없다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.selection.invert")).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    });

    it("선택이 있으면 반전한다", async () => {
      const mcp = setup();
      mcp.bridge.setSelection(true);
      await expect(call(mcp, "photoshop.selection.invert")).resolves.toEqual({
        hasSelection: true,
      });
    });

    it("인자를 받지 않는다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.selection.clear", { all: true })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    });
  });
});

describe("Phase 4 필터 Tool", () => {
  it("필터 Tool 을 등록한다", () => {
    const { tools, commands } = setup();
    expect(tools.list().map((tool) => tool.name)).toContain("photoshop.filter.gaussian_blur");
    expect(commands.list()).toContain("FILTER_GAUSSIAN_BLUR");
  });

  it("기본은 스마트 필터라 대상이 스마트 오브젝트가 된다", async () => {
    const mcp = setup();

    // 기본값은 비파괴다. 픽셀 레이어가 스마트 오브젝트로 바뀐다.
    await expect(
      call(mcp, "photoshop.filter.gaussian_blur", { layerId: 10, radius: 5 }),
    ).resolves.toMatchObject({ id: 10, type: "smartObject" });
  });

  it("asSmartFilter: false 는 레이어 종류를 바꾸지 않는다", async () => {
    const mcp = setup();

    await expect(
      call(mcp, "photoshop.filter.gaussian_blur", {
        layerId: 10,
        radius: 5,
        asSmartFilter: false,
      }),
    ).resolves.toMatchObject({ id: 10, type: "pixel" });
  });

  it("이미 스마트 오브젝트면 변환하지 않는다", async () => {
    const mcp = setup();
    await call(mcp, "photoshop.filter.gaussian_blur", { layerId: 11, radius: 3 });
    await expect(
      call(mcp, "photoshop.filter.gaussian_blur", { layerId: 11, radius: 3 }),
    ).resolves.toMatchObject({ id: 11, type: "smartObject" });
  });

  it("radius 범위를 검증한다", async () => {
    const mcp = setup();
    for (const radius of [0, 0.05, 1001]) {
      await expect(call(mcp, "photoshop.filter.gaussian_blur", { radius })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    }
    await expect(
      call(mcp, "photoshop.filter.gaussian_blur", { radius: 0.1 }),
    ).resolves.toBeTruthy();
    await expect(
      call(mcp, "photoshop.filter.gaussian_blur", { radius: 1000 }),
    ).resolves.toBeTruthy();
  });

  it("radius 는 필수다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.filter.gaussian_blur", {})).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("없는 레이어는 LAYER_NOT_FOUND 를 던진다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.filter.gaussian_blur", { layerId: 999, radius: 5 }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND }));
  });
});
