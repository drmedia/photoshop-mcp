import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { toAdjustmentKind } from "../photoshop-uxp/src/dom/adjustment-kind.js";
import { describe, expect, it } from "vitest";

/**
 * 조정 레이어의 종류. (ROADMAP §17.24)
 *
 * `layer.list` 는 "조정 레이어다" 까지만 말하고 **무슨 조정인지는 말하지 않았다.**
 * 저장한 PSD 를 다시 열면 이름으로 짐작하는 수밖에 없었다 — 실기에서 만든
 * `06_색_곡선` 은 이름과 달리 Color Balance 였다.
 */

describe("종류 매핑", () => {
  it("아는 클래스 이름을 옮긴다", () => {
    expect(toAdjustmentKind([{ _obj: "curves" }])).toEqual({ adjustmentType: "curves" });
    expect(toAdjustmentKind([{ _obj: "colorBalance" }])).toEqual({
      adjustmentType: "colorBalance",
    });
  });

  it("**이름이 우리 표기와 다른 것도 옮긴다**", () => {
    // Photoshop 의 클래스 이름은 UI 이름과 다르다. 이 매핑이 있는 이유다.
    expect(toAdjustmentKind([{ _obj: "brightnessEvent" }])).toEqual({
      adjustmentType: "brightnessContrast",
    });
  });

  it("**모르는 것은 null 이고 원본을 남긴다**", () => {
    // 그럴듯한 값으로 덮으면 호출자가 틀린 종류를 사실로 받아들인다.
    // 이 규칙으로 rawBitDepth · rawKind · rawBlendMode 에서 세 번 버그를 잡았다.
    expect(toAdjustmentKind([{ _obj: "someFutureAdjustment" }])).toEqual({
      adjustmentType: null,
      raw: "someFutureAdjustment",
    });
  });

  describe("모양이 예상과 다르면", () => {
    it("배열이 아니면 null", () => {
      expect(toAdjustmentKind({ _obj: "curves" })).toEqual({ adjustmentType: null });
    });

    it("비었으면 null", () => {
      expect(toAdjustmentKind([])).toEqual({ adjustmentType: null });
    });

    it("_obj 가 없으면 null", () => {
      expect(toAdjustmentKind([{ something: 1 }])).toEqual({ adjustmentType: null });
      expect(toAdjustmentKind([null])).toEqual({ adjustmentType: null });
    });

    it("undefined · null 도 견딘다", () => {
      expect(toAdjustmentKind(undefined)).toEqual({ adjustmentType: null });
      expect(toAdjustmentKind(null)).toEqual({ adjustmentType: null });
    });
  });
});

describe("layer.list", () => {
  function setup(): ReturnType<typeof createPhotoshopMcp> {
    return createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit"]),
    });
  }

  it("**조정 레이어의 종류를 알려준다**", async () => {
    const mcp = setup();
    await mcp.tools.invoke(
      "photoshop.adjustment.color_balance",
      { name: "색", midtones: [-10, 0, 10] },
      { requestId: "r" },
    );
    await mcp.tools.invoke(
      "photoshop.adjustment.curves",
      {
        name: "톤",
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 200 },
        ],
      },
      { requestId: "r" },
    );

    const layers = (
      (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
        layers: LayerInfo[];
      }
    ).layers;

    expect(layers.find((layer) => layer.name === "색")?.adjustmentType).toBe("colorBalance");
    expect(layers.find((layer) => layer.name === "톤")?.adjustmentType).toBe("curves");
  });

  it("조정 레이어가 아니면 담지 않는다", async () => {
    // 픽셀 레이어에 "조정 종류" 필드가 있으면 그 자체가 틀린 정보다.
    const mcp = setup();
    const layers = (
      (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
        layers: LayerInfo[];
      }
    ).layers;

    for (const layer of layers.filter((entry) => entry.type !== "adjustment")) {
      expect(layer.adjustmentType).toBeUndefined();
    }
  });

  it("여섯 가지 조정 Tool 이 모두 종류를 남긴다", async () => {
    const mcp = setup();
    const made: [string, Record<string, unknown>, string][] = [
      [
        "photoshop.adjustment.curves",
        {
          points: [
            { input: 0, output: 0 },
            { input: 255, output: 200 },
          ],
        },
        "curves",
      ],
      ["photoshop.adjustment.levels", { gamma: 1.2 }, "levels"],
      ["photoshop.adjustment.brightness_contrast", { brightness: 10 }, "brightnessContrast"],
      ["photoshop.adjustment.color_balance", { midtones: [5, 0, -5] }, "colorBalance"],
      ["photoshop.adjustment.hue_saturation", { saturation: 5 }, "hueSaturation"],
      ["photoshop.adjustment.vibrance", { vibrance: 5 }, "vibrance"],
    ];

    for (const [tool, args, expected] of made) {
      const layer = (await mcp.tools.invoke(tool, args, { requestId: "r" })) as LayerInfo;
      expect(layer.adjustmentType, tool).toBe(expected);
    }
  });
});
