import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import {
  SelectionPolygonParamsSchema,
  SelectionRotateBoundaryParamsSchema,
  SelectionScaleBoundaryParamsSchema,
  SelectionTranslateBoundaryParamsSchema,
} from "@photoshop-mcp/photoshop-tools";

/**
 * DOM `Selection` 을 쓰는 선택 조작. (CORE_API §5)
 *
 * 기존 선택 Command 는 전부 batchPlay 다 — DOM 에 없어서가 아니라 **확인하지
 * 않았기 때문**이었다. 레퍼런스에 `Selection` 클래스가 있다(25.0+).
 * (ROADMAP §49)
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

/** 경계 변형은 선택이 있어야 한다. */
const withSelection = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<void> => {
  await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
};

describe("selection — DOM 경계 변형과 다각형", () => {
  /**
   * **넷 다 `edit` 이다.** 레퍼런스가 "Does not affect the active layer" 라고
   * 적는다 — 선택 경계만 움직이고 픽셀을 다시 표본화하지 않으므로
   * `layer.scale` 이 `destructive` 인 것과 갈린다.
   */
  it("**경계 변형은 edit 다** — layer.scale 과 갈리는 자리", () => {
    const mcp = setup();
    for (const type of [
      "SELECTION_TRANSLATE_BOUNDARY",
      "SELECTION_SCALE_BOUNDARY",
      "SELECTION_ROTATE_BOUNDARY",
      "SELECTION_POLYGON",
    ]) {
      expect(mcp.commands.permissionOf(type)).toBe("edit");
    }
    expect(mcp.commands.permissionOf("LAYER_SCALE")).toBe("destructive");
  });

  it("**선택이 없으면 경계를 못 바꾼다**", async () => {
    await expect(
      invoke(setup(), "photoshop.selection.translate_boundary", { deltaX: 10 }),
    ).rejects.toThrow(/선택 영역이 없습니다/);
  });

  it("**변형 전 경계를 함께 준다**", async () => {
    /* 무엇이 얼마나 움직였는지 호출자가 스스로 견준다. */
    const mcp = setup();
    await withSelection(mcp);
    const result = (await invoke(mcp, "photoshop.selection.translate_boundary", {
      deltaX: 10,
      deltaY: -5,
    })) as { before: unknown; bounds: unknown; hasSelection: boolean };

    expect(result.hasSelection).toBe(true);
    expect(result).toHaveProperty("before");
  });

  it("**쓴 기준점을 그대로 돌려준다**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    const result = (await invoke(mcp, "photoshop.selection.rotate_boundary", {
      angle: 90,
      anchor: "topLeft",
    })) as { anchor: string | null };

    expect(result.anchor).toBe("topLeft");
  });

  it("**기준점을 생략하면 null 이다**", async () => {
    /* Photoshop 기본값이 무엇인지 우리가 정하지 않는다. */
    const mcp = setup();
    await withSelection(mcp);
    const result = (await invoke(mcp, "photoshop.selection.scale_boundary", {
      horizontal: 50,
    })) as { anchor: string | null };

    expect(result.anchor).toBeNull();
  });

  it("**아무것도 안 주면 거절한다**", () => {
    /* 통과시키면 아무 일도 안 하고 성공을 돌려주게 된다. */
    expect(SelectionTranslateBoundaryParamsSchema.safeParse({}).success).toBe(false);
    expect(SelectionScaleBoundaryParamsSchema.safeParse({}).success).toBe(false);
    expect(SelectionTranslateBoundaryParamsSchema.safeParse({ deltaX: 5 }).success).toBe(true);
    expect(SelectionScaleBoundaryParamsSchema.safeParse({ horizontal: 50 }).success).toBe(true);
  });

  it("**scale 은 퍼센트라 0 이하를 받지 않는다**", () => {
    expect(SelectionScaleBoundaryParamsSchema.safeParse({ horizontal: 0 }).success).toBe(false);
    expect(SelectionScaleBoundaryParamsSchema.safeParse({ horizontal: -10 }).success).toBe(false);
  });

  it("**rotate 는 각도가 필수다**", () => {
    expect(SelectionRotateBoundaryParamsSchema.safeParse({}).success).toBe(false);
    expect(SelectionRotateBoundaryParamsSchema.safeParse({ angle: 400 }).success).toBe(false);
    expect(SelectionRotateBoundaryParamsSchema.safeParse({ angle: -90 }).success).toBe(true);
  });

  /**
   * **점이 셋 미만이면 면적이 없다.** Photoshop 은 이유를 말해 주지 않아
   * 미리 막는다 — 스키마와 플러그인 양쪽에서 막는다.
   */
  it("**다각형은 점이 셋 이상이어야 한다**", async () => {
    expect(SelectionPolygonParamsSchema.safeParse({ points: [] }).success).toBe(false);
    expect(
      SelectionPolygonParamsSchema.safeParse({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }).success,
    ).toBe(false);
    expect(
      SelectionPolygonParamsSchema.safeParse({
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 10 },
        ],
      }).success,
    ).toBe(true);
  });

  it("**다각형이 선택을 만든다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.selection.polygon", {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 80 },
      ],
    })) as { hasSelection: boolean };

    expect(result.hasSelection).toBe(true);
  });

  it("**모르는 mode · anchor · interpolation 은 거절한다**", () => {
    expect(
      SelectionPolygonParamsSchema.safeParse({
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
        mode: "union",
      }).success,
    ).toBe(false);
    expect(
      SelectionScaleBoundaryParamsSchema.safeParse({ horizontal: 50, anchor: "center" }).success,
    ).toBe(false);
    expect(
      SelectionRotateBoundaryParamsSchema.safeParse({ angle: 10, interpolation: "lanczos" })
        .success,
    ).toBe(false);
  });

  it("**모르는 파라미터는 거절한다**", () => {
    expect(
      SelectionTranslateBoundaryParamsSchema.safeParse({ deltaX: 5, layerId: 11 }).success,
    ).toBe(false);
  });
});
