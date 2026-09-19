import { asDouble, buildCameraRawDescriptor } from "../photoshop-uxp/src/dom/camera-raw-keys.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * Camera Raw 필터. (ROADMAP §17.17)
 *
 * 키는 실기에서 `addNotificationListener(["all"])` 로 잡아낸 것이다. 짐작한 이름이
 * 하나도 없다. 여기서는 **빌더의 규칙**과 **거절 규칙**을 고정한다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({ bridge: new MockPhotoshopBridge(), logger: createSilentLogger() });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

const apply = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => invoke(mcp, "photoshop.camera_raw.apply", args);

async function pixelLayer(mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> {
  return ((await invoke(mcp, "photoshop.layer.create", { name: "Work" })) as { id: number }).id;
}

describe("Camera Raw", () => {
  describe("descriptor 빌더", () => {
    it("**노출만 실수로 민다**", () => {
      // 정수로 나가면 Photoshop 이 조용히 무시한다 — 성공을 돌려주면서 아무것도
      // 하지 않는다. 실기에서 $Ex12=2 는 무동작, 2.000001 은 적용이었다.
      expect(asDouble(2)).not.toBe(2);
      expect(asDouble(2)).toBeCloseTo(2, 3);
      // 이미 실수면 건드리지 않는다.
      expect(asDouble(1.5)).toBe(1.5);
    });

    it("잡아낸 키로 옮긴다", () => {
      const { descriptor } = buildCameraRawDescriptor({
        exposure: 0.4,
        contrast: 9,
        shadows: -17,
        noiseReduction: 25,
        colorNoiseReduction: 32,
      });
      expect(descriptor["$Ex12"]).toBe(0.4);
      expect(descriptor["$Cr12"]).toBe(9);
      expect(descriptor["$Sh12"]).toBe(-17);
      expect(descriptor["$LNR"]).toBe(25);
      expect(descriptor["$CNR"]).toBe(32);
    });

    it("**`saturation` 만 `$` 가 없다**", () => {
      // 규칙성을 가정하면 이 하나가 조용히 빠진다.
      const { descriptor } = buildCameraRawDescriptor({ saturation: 9 });
      expect(descriptor["saturation"]).toBe(9);
      expect(descriptor["$Satu"]).toBeUndefined();
    });

    it("버전 키를 넣지 않는다", () => {
      // 빼도 동작하는 것을 실기에서 확인했다. 박아 넣으면 다른 Camera Raw
      // 버전에서 깨진다.
      const { descriptor } = buildCameraRawDescriptor({ exposure: 1.5 });
      expect(descriptor["$CrVe"]).toBeUndefined();
      expect(descriptor["$PrVe"]).toBeUndefined();
    });

    it("색온도를 주면 화이트밸런스를 사용자 정의로 둔다", () => {
      // Camera Raw 자신이 낸 descriptor 에 이 항목이 함께 있었다.
      expect(buildCameraRawDescriptor({ temperature: -12 }).descriptor["$WBal"]).toBeDefined();
      expect(buildCameraRawDescriptor({ exposure: 1.5 }).descriptor["$WBal"]).toBeUndefined();
    });

    it("준 것만 담는다", () => {
      const { descriptor, applied } = buildCameraRawDescriptor({ exposure: 1.5 });
      expect(applied).toEqual(["exposure"]);
      expect(Object.keys(descriptor)).toEqual(["_obj", "$Ex12"]);
    });
  });

  describe("Tool", () => {
    it("edit 이다", () => {
      expect(setup().tools.get("photoshop.camera_raw.apply")?.permission).toBe("edit");
    });

    it("**Tool 은 하나뿐이다**", () => {
      // 슬라이더마다 Tool 을 두면 LLM 이 나눠 부르고, 그러면 픽셀이 반복해서
      // 구워져 결과가 달라진다. 실기에서 중간값이 19% 어긋났다.
      const names = setup()
        .tools.list()
        .map((tool) => tool.name)
        .filter((name) => name.startsWith("photoshop.camera_raw."));
      expect(names).toEqual(["photoshop.camera_raw.apply"]);
    });

    it("설정이 하나도 없으면 거절한다", async () => {
      // 아무것도 안 하고 성공을 돌려주면 호출자는 적용됐다고 믿는다.
      const mcp = setup();
      await expect(apply(mcp, { layerId: await pixelLayer(mcp) })).rejects.toThrow(
        /설정이 하나도 없습니다/u,
      );
    });

    it("범위를 강제한다", async () => {
      const mcp = setup();
      const layerId = await pixelLayer(mcp);
      await expect(apply(mcp, { layerId, exposure: 9 })).rejects.toThrow(/exposure/u);
      await expect(apply(mcp, { layerId, contrast: 300 })).rejects.toThrow(/contrast/u);
      await expect(apply(mcp, { layerId, noiseReduction: -5 })).rejects.toThrow(/noiseReduction/u);
    });

    it("**숨긴 레이어를 거절한다**", async () => {
      // Photoshop 은 "명령을 사용할 수 없습니다" 라고만 답한다. 이유를 여기서 말한다.
      const mcp = setup();
      const layerId = await pixelLayer(mcp);
      await invoke(mcp, "photoshop.layer.set_visibility", { layerId, visible: false });
      await expect(apply(mcp, { layerId, exposure: 1.5 })).rejects.toThrow(/숨긴 레이어/u);
    });

    it("조정 레이어를 거절한다", async () => {
      const mcp = setup();
      await invoke(mcp, "photoshop.adjustment.curves", {
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 255 },
        ],
      });
      const { layers } = (await invoke(mcp, "photoshop.layer.list")) as {
        layers: { id: number; type: string }[];
      };
      const adjustment = layers.find((entry) => entry.type === "adjustment");
      await expect(apply(mcp, { layerId: adjustment?.id, exposure: 1.5 })).rejects.toThrow(
        /조정 레이어/u,
      );
    });

    it("무엇을 보냈는지 돌려준다", async () => {
      // 조용히 무시되는 값이 있는 필터라, 요청과 대조할 수 있어야 한다.
      const mcp = setup();
      const layerId = await pixelLayer(mcp);
      const result = await apply(mcp, { layerId, exposure: 1.5, noiseReduction: 25 });
      expect(result["applied"]).toEqual(expect.arrayContaining(["exposure", "noiseReduction"]));
    });
  });
});
