import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import {
  FilterDustAndScratchesParamsSchema,
  FilterMotionBlurParamsSchema,
  FilterSharpenParamsSchema,
  FilterUnsharpMaskParamsSchema,
} from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * DOM `layer.apply*` 필터. (ROADMAP §53)
 *
 * **레퍼런스가 있는 것과 없는 것을 분명히 갈랐다.** `applySmartSharpen` · 표면
 * 흐림 · 노이즈 감소는 목록에 없어 만들지 않았다 — 이름이 비슷한
 * `applySmartBlur`(고급 흐림)로 채우지 않는다.
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

describe("filter — DOM apply* 넷", () => {
  it("**전부 edit 다** — 기존 필터와 같다", () => {
    const mcp = setup();
    for (const type of [
      "FILTER_SHARPEN",
      "FILTER_UNSHARP_MASK",
      "FILTER_MOTION_BLUR",
      "FILTER_DUST_AND_SCRATCHES",
    ]) {
      expect(mcp.commands.permissionOf(type)).toBe("edit");
    }
  });

  it("**픽셀 레이어에 걸린다**", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "P" })) as { id: number };
    for (const [tool, args] of [
      ["photoshop.filter.sharpen", {}],
      ["photoshop.filter.unsharp_mask", { amount: 80, radius: 1.5, threshold: 4 }],
      ["photoshop.filter.motion_blur", { angle: 0, distance: 20 }],
      ["photoshop.filter.dust_scratches", { radius: 3, threshold: 20 }],
    ] as [string, Record<string, unknown>][]) {
      const result = (await invoke(mcp, tool, { ...args, layerId: layer.id })) as { id: number };
      expect(result.id).toBe(layer.id);
    }
  });

  /**
   * **조정 레이어에는 걸 수 없다.** 그대로 두면 스마트 오브젝트 변환이 먼저
   * 성공한 뒤 필터가 실패해, 실패로 보고되는데 조정 레이어는 이미 망가진다.
   * 기존 필터가 쓰던 경로를 그대로 타는지 확인한다.
   */
  it("**조정 레이어에는 못 건다** — 기존 필터와 같은 경로다", async () => {
    const mcp = setup();
    const adj = (await invoke(mcp, "photoshop.adjustment.curves", {
      points: [
        { input: 0, output: 0 },
        { input: 255, output: 255 },
      ],
    })) as { id: number };
    await expect(invoke(mcp, "photoshop.filter.sharpen", { layerId: adj.id })).rejects.toThrow();
  });

  /**
   * **`sharpen` 은 인자를 받지 않는다.** Photoshop 의 이 세 필터가 원래
   * 그렇다 — 강도를 받는 척하면 호출자가 조절했다고 믿는다.
   */
  it("**sharpen 은 강도를 받지 않는다**", () => {
    expect(FilterSharpenParamsSchema.safeParse({}).success).toBe(true);
    expect(FilterSharpenParamsSchema.safeParse({ mode: "edges" }).success).toBe(true);
    expect(FilterSharpenParamsSchema.safeParse({ amount: 50 }).success).toBe(false);
    expect(FilterSharpenParamsSchema.safeParse({ mode: "smart" }).success).toBe(false);
  });

  it("**언샵 마스크는 강도와 반경이 필수다**", () => {
    expect(FilterUnsharpMaskParamsSchema.safeParse({ amount: 80 }).success).toBe(false);
    expect(FilterUnsharpMaskParamsSchema.safeParse({ radius: 1.5 }).success).toBe(false);
    expect(FilterUnsharpMaskParamsSchema.safeParse({ amount: 80, radius: 1.5 }).success).toBe(true);
    /* 대화상자 범위 밖. */
    expect(FilterUnsharpMaskParamsSchema.safeParse({ amount: 501, radius: 1 }).success).toBe(false);
    expect(FilterUnsharpMaskParamsSchema.safeParse({ amount: 0, radius: 1 }).success).toBe(false);
    expect(
      FilterUnsharpMaskParamsSchema.safeParse({ amount: 80, radius: 1, threshold: 256 }).success,
    ).toBe(false);
  });

  it("**모션 블러는 각도와 거리가 필수다**", () => {
    expect(FilterMotionBlurParamsSchema.safeParse({ angle: 45 }).success).toBe(false);
    expect(FilterMotionBlurParamsSchema.safeParse({ angle: 45, distance: 30 }).success).toBe(true);
    expect(FilterMotionBlurParamsSchema.safeParse({ angle: 45, distance: 0 }).success).toBe(false);
    expect(FilterMotionBlurParamsSchema.safeParse({ angle: 400, distance: 30 }).success).toBe(
      false,
    );
  });

  it("**먼지·스크래치의 반경은 정수다**", () => {
    expect(FilterDustAndScratchesParamsSchema.safeParse({ radius: 3 }).success).toBe(true);
    expect(FilterDustAndScratchesParamsSchema.safeParse({ radius: 3.5 }).success).toBe(false);
    expect(FilterDustAndScratchesParamsSchema.safeParse({ radius: 101 }).success).toBe(false);
  });

  /**
   * **DOM 에 없는 셋을 Tool 로 내놓지 않았다.** 이름만 만들어 두고 비슷한
   * 필터로 채우면 호출자는 요청한 것이 걸렸다고 믿는다.
   */
  it("**smart_sharpen · surface_blur · noise_reduce 는 없다**", () => {
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    expect(names).not.toContain("photoshop.filter.smart_sharpen");
    expect(names).not.toContain("photoshop.filter.surface_blur");
    expect(names).not.toContain("photoshop.filter.noise_reduce");
    /* 조절 가능한 선명화의 자리는 이것이다. */
    expect(names).toContain("photoshop.filter.unsharp_mask");
  });
});
