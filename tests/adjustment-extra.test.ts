import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import {
  AdjustmentBlackWhiteParamsSchema,
  AdjustmentChannelMixerParamsSchema,
  AdjustmentExposureParamsSchema,
  AdjustmentPhotoFilterParamsSchema,
} from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 조정 레이어 넷 — 노출 · 흑백 · 포토 필터 · 채널 혼합. (ROADMAP §52)
 *
 * descriptor 는 전부 `["all"]` 알림으로 잡았다. **체크박스와 드롭다운은
 * 슬라이더와 따로 잡아야 했고**, 하필 그것들이 이름을 틀리기 쉬운 것들이었다.
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

describe("조정 레이어 넷", () => {
  it("**전부 edit 다** — 픽셀을 굽지 않는다", () => {
    const mcp = setup();
    for (const type of [
      "ADJUSTMENT_EXPOSURE",
      "ADJUSTMENT_BLACK_WHITE",
      "ADJUSTMENT_PHOTO_FILTER",
      "ADJUSTMENT_CHANNEL_MIXER",
    ]) {
      expect(mcp.commands.permissionOf(type)).toBe("edit");
    }
  });

  it("**조정 레이어로 만들고 종류를 밝힌다**", async () => {
    const mcp = setup();
    const cases: [string, Record<string, unknown>, string][] = [
      ["photoshop.adjustment.exposure", { exposure: -0.5 }, "exposure"],
      ["photoshop.adjustment.black_white", { blue: 17 }, "blackAndWhite"],
      ["photoshop.adjustment.photo_filter", { density: 51 }, "photoFilter"],
      ["photoshop.adjustment.channel_mixer", { red: { red: 42 } }, "channelMixer"],
    ];
    for (const [tool, args, kind] of cases) {
      const layer = (await invoke(mcp, tool, args)) as {
        type: string;
        adjustmentType?: string;
      };
      expect(layer.type).toBe("adjustment");
      /* **Mock 이 실제 descriptor 의 `_obj` 를 그대로 쓴다.** 지어낸 이름을
       * 넣으면 `layer.list` 가 거짓을 말한다. */
      expect(layer.adjustmentType).toBe(kind);
    }
  });

  /**
   * **패널 슬라이더 범위 밖은 거절한다.** 통과시키면 Photoshop 이 조용히
   * 자르거나 무시한다.
   */
  it("**범위 밖 값은 거절한다**", () => {
    expect(AdjustmentExposureParamsSchema.safeParse({ exposure: 21 }).success).toBe(false);
    expect(AdjustmentExposureParamsSchema.safeParse({ offset: 0.6 }).success).toBe(false);
    expect(AdjustmentExposureParamsSchema.safeParse({ gammaCorrection: 0 }).success).toBe(false);
    expect(AdjustmentBlackWhiteParamsSchema.safeParse({ red: 301 }).success).toBe(false);
    expect(AdjustmentPhotoFilterParamsSchema.safeParse({ density: 0 }).success).toBe(false);
  });

  /**
   * **`gamma` 가 아니라 `gammaCorrection` 이다.** 잡은 descriptor 가 그렇다.
   * 짧은 이름을 받으면 Photoshop 이 조용히 무시한다.
   */
  it("**gamma 라는 이름은 받지 않는다**", () => {
    expect(AdjustmentExposureParamsSchema.safeParse({ gamma: 1.2 }).success).toBe(false);
    expect(AdjustmentExposureParamsSchema.safeParse({ gammaCorrection: 1.2 }).success).toBe(true);
  });

  /**
   * **색이 Lab 이다.** 패널의 필터 드롭다운은 이름으로 나가지 않는다 —
   * 이름을 받는 스키마를 만들었으면 조용히 무시됐을 것이다.
   */
  it("**포토 필터 색은 Lab 이고 이름은 안 받는다**", () => {
    expect(
      AdjustmentPhotoFilterParamsSchema.safeParse({ filter: "Warming Filter (85)" }).success,
    ).toBe(false);
    expect(
      AdjustmentPhotoFilterParamsSchema.safeParse({
        color: { luminance: 48.24, a: 48, b: -122 },
      }).success,
    ).toBe(true);
  });

  /**
   * **두 모드를 섞으면 Photoshop 이 오류 없이 한쪽만 쓴다.** 호출자는 준 값이
   * 다 들어간 줄 안다 — 이 저장소가 반복해서 겪은 "조용한 실패" 라 미리 가른다.
   */
  it("**채널 혼합의 두 모드를 섞으면 거절한다**", () => {
    expect(
      AdjustmentChannelMixerParamsSchema.safeParse({
        monochrome: true,
        red: { red: 50 },
      }).success,
    ).toBe(false);
    expect(AdjustmentChannelMixerParamsSchema.safeParse({ gray: { red: 40 } }).success).toBe(false);
    expect(
      AdjustmentChannelMixerParamsSchema.safeParse({ monochrome: true, gray: { red: 40 } }).success,
    ).toBe(true);
    expect(AdjustmentChannelMixerParamsSchema.safeParse({ red: { red: 100 } }).success).toBe(true);
  });

  it("**모르는 파라미터는 거절한다**", () => {
    /* `monochrome` 은 우리 이름이고 descriptor 키는 `monochromatic` 이다.
     * 경계에서 바꾸므로 descriptor 이름을 그대로 받지 않는다. */
    expect(AdjustmentChannelMixerParamsSchema.safeParse({ monochromatic: true }).success).toBe(
      false,
    );
    /* 흑백도 마찬가지 — descriptor 는 `grain` 이지만 우리는 `green` 이다. */
    expect(AdjustmentBlackWhiteParamsSchema.safeParse({ grain: 40 }).success).toBe(false);
    expect(AdjustmentBlackWhiteParamsSchema.safeParse({ green: 40 }).success).toBe(true);
    /* `tint` 가 아니라 `useTint` 다. */
    expect(AdjustmentBlackWhiteParamsSchema.safeParse({ tint: true }).success).toBe(false);
    expect(AdjustmentBlackWhiteParamsSchema.safeParse({ useTint: true }).success).toBe(true);
  });
});
