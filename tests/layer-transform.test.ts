import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import {
  LayerRotateParamsSchema,
  LayerScaleParamsSchema,
  LayerTranslateParamsSchema,
} from "@photoshop-mcp/photoshop-tools";

/**
 * 레이어 변환 셋. (CORE_API §5)
 *
 * **단위는 Adobe 레퍼런스의 예제 코드가 답을 준다.** 타입 서명만 보면
 * `number | PercentValue | PixelValue` 라 알 수 없다. (ROADMAP §47)
 *
 * ```text
 * translate(-200, 0)   맨 숫자는 픽셀
 * scale(80, 80)        맨 숫자는 퍼센트
 * rotate(-90)          맨 숫자는 도
 * ```
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

describe("layer.translate / scale / rotate", () => {
  /**
   * **셋의 등급이 다르다.** 옮기는 것은 다시 표본화하지 않아 잃는 것이 없고,
   * 줄이는 것은 `image.resize` 와 같은 종류라 되돌릴 수 없다. 돌리는 것은
   * `document.rotate` 가 `edit` 인 것과 같다.
   */
  it("**translate 는 edit, scale 은 destructive, rotate 는 edit 이다**", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("LAYER_TRANSLATE")).toBe("edit");
    expect(mcp.commands.permissionOf("LAYER_SCALE")).toBe("destructive");
    expect(mcp.commands.permissionOf("LAYER_ROTATE")).toBe("edit");
    // 비교 대상: 문서 전체는 각각 이렇게 나뉘어 있다.
    expect(mcp.commands.permissionOf("IMAGE_RESIZE")).toBe("destructive");
    expect(mcp.commands.permissionOf("DOCUMENT_ROTATE")).toBe("edit");
  });

  it("**scale 은 기본 허용에서 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.layer.scale", {
        layerId: 12,
        width: 50,
        height: 50,
      }),
    ).rejects.toThrow();
  });

  it("**translate 는 둘 다 없으면 거절한다**", () => {
    /* 통과시키면 아무 일도 안 하고 성공을 돌려주게 된다. */
    expect(LayerTranslateParamsSchema.safeParse({}).success).toBe(false);
    expect(LayerTranslateParamsSchema.safeParse({ horizontal: -200 }).success).toBe(true);
    expect(LayerTranslateParamsSchema.safeParse({ vertical: 100 }).success).toBe(true);
  });

  it("**scale 은 퍼센트라 0 이하를 받지 않는다**", () => {
    expect(LayerScaleParamsSchema.safeParse({ width: 80, height: 80 }).success).toBe(true);
    expect(LayerScaleParamsSchema.safeParse({ width: 0, height: 80 }).success).toBe(false);
    expect(LayerScaleParamsSchema.safeParse({ width: -50, height: 80 }).success).toBe(false);
    /* 둘 다 필수다 — 하나만 주면 비율이 유지되는지 확인된 적이 없다. */
    expect(LayerScaleParamsSchema.safeParse({ width: 80 }).success).toBe(false);
  });

  it("**rotate 는 -360 ~ 360 이다**", () => {
    expect(LayerRotateParamsSchema.safeParse({ angle: -90 }).success).toBe(true);
    expect(LayerRotateParamsSchema.safeParse({ angle: 360 }).success).toBe(true);
    expect(LayerRotateParamsSchema.safeParse({ angle: 400 }).success).toBe(false);
  });

  it("**모르는 기준점과 보간은 거절한다**", () => {
    expect(
      LayerScaleParamsSchema.safeParse({ width: 50, height: 50, anchor: "center" }).success,
    ).toBe(false);
    expect(
      LayerScaleParamsSchema.safeParse({ width: 50, height: 50, interpolation: "lanczos" }).success,
    ).toBe(false);
    expect(
      LayerScaleParamsSchema.safeParse({
        width: 50,
        height: 50,
        anchor: "bottomLeft",
        interpolation: "bicubicSharper",
      }).success,
    ).toBe(true);
  });

  it("**쓴 기준점을 그대로 돌려준다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.rotate", {
      layerId: 12,
      angle: 90,
      anchor: "topLeft",
    })) as { anchor: string | null };

    expect(result.anchor).toBe("topLeft");
  });

  it("**기준점을 생략하면 null 이다**", async () => {
    /* Photoshop 기본값이 무엇인지 우리가 정하지 않는다. */
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.translate", {
      layerId: 12,
      horizontal: 10,
    })) as { anchor: string | null };

    expect(result.anchor).toBeNull();
  });

  /**
   * **Mock 은 경계를 지어내지 않는다.** 픽셀을 모르므로 `null` 이다 —
   * 그럴듯한 사각형을 주면 "얼마나 움직였다" 고 판단한 워크플로가 실기에서
   * 다르게 돈다.
   */
  it("**Mock 은 경계를 지어내지 않는다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.layer.scale", {
      layerId: 12,
      width: 50,
      height: 50,
    })) as { before: unknown; after: unknown };

    expect(result.before).toBeNull();
    expect(result.after).toBeNull();
  });

  it("**없는 레이어는 실패한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.layer.translate", { layerId: 9999, horizontal: 10 }),
    ).rejects.toThrow();
  });
});
