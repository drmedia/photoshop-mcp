import {
  asDouble,
  buildCameraRawDescriptor,
  flattenCurve,
} from "../photoshop-uxp/src/dom/camera-raw-keys.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { CameraRawParamsSchema } from "@photoshop-mcp/photoshop-tools";
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
    it("**정수를 실수로 민다**", () => {
      // 정수로 나가면 Photoshop 이 조용히 무시한다 — 성공을 돌려주면서 아무것도
      // 하지 않는다. 실기에서 $Ex12=2 는 무동작, 2.000001 은 적용이었다.
      expect(asDouble(2)).not.toBe(2);
      expect(asDouble(2)).toBeCloseTo(2, 3);
      // 이미 실수면 건드리지 않는다.
      expect(asDouble(1.5)).toBe(1.5);
    });

    it("**노출과 샤픈 반경만 실수로 나간다** (ROADMAP 64)", () => {
      // sharpenRadius 는 Camera Raw 가 2.4 로 냈고 범위가 0.5-3.0 이라
      // 정수도 유효한 값이다. 무시되는지 확인하지 않았으므로 안전한 쪽을 쓴다.
      const { descriptor } = buildCameraRawDescriptor({
        exposure: 1,
        sharpenRadius: 2,
        sharpenAmount: 73,
        sharpenDetail: 61,
        sharpenMasking: 38,
      });
      expect(descriptor["$Ex12"]).not.toBe(1);
      expect(descriptor["$ShpR"]).not.toBe(2);
      expect(descriptor["$ShpR"]).toBeCloseTo(2, 3);
      // 나머지는 정수 그대로다.
      expect(descriptor["sharpen"]).toBe(73);
      expect(descriptor["$ShpD"]).toBe(61);
      expect(descriptor["$ShpM"]).toBe(38);
    });

    it("**`sharpen` 에도 `$` 가 없다** — 세 번째 예외", () => {
      // 규칙성을 가정하면 `$Shpn` 을 넣고 조용히 무시당한다.
      const { descriptor } = buildCameraRawDescriptor({ sharpenAmount: 50 });
      expect(descriptor["sharpen"]).toBe(50);
      expect(descriptor["$Shpn"]).toBeUndefined();
      // 실기 캡처(seq 28)의 나머지 셋은 `$` 가 있다.
      const all = buildCameraRawDescriptor({
        sharpenRadius: 2.4,
        sharpenDetail: 61,
        sharpenMasking: 38,
      }).descriptor;
      expect(all["$ShpR"]).toBe(2.4);
      expect(all["$ShpD"]).toBe(61);
      expect(all["$ShpM"]).toBe(38);
    });

    it("샤픈은 화이트밸런스를 건드리지 않는다", () => {
      const { descriptor } = buildCameraRawDescriptor({ sharpenAmount: 73 });
      expect(descriptor["$WBal"]).toBeUndefined();
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

  /**
   * 색상 혼합(HSL). (ROADMAP §17.29)
   *
   * 키 24개는 알림 캡처로 잡은 것이다. 여기서 고정하지 않으면 오타 하나가
   * **오류 없이 조용히 무시되는** 경로가 된다 — `$Ex12` 정수 함정과 같은 종류다.
   */
  describe("색상 혼합", () => {
    const COLORS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];
    const SUFFIX = ["R", "O", "Y", "G", "A", "B", "P", "M"];

    it("**잡아낸 키 그대로 나간다**", () => {
      for (const [index, color] of COLORS.entries()) {
        const suffix = SUFFIX[index] as string;
        expect(buildCameraRawDescriptor({ [`hue${color}`]: 11 }).descriptor[`$HA_${suffix}`]).toBe(
          11,
        );
        expect(
          buildCameraRawDescriptor({ [`saturation${color}`]: 22 }).descriptor[`$SA_${suffix}`],
        ).toBe(22);
        expect(
          buildCameraRawDescriptor({ [`luminance${color}`]: 33 }).descriptor[`$LA_${suffix}`],
        ).toBe(33);
      }
    });

    it("**정수를 실수로 밀지 않는다**", () => {
      // `$Ex12` 만 실수를 요구한다. 여기까지 밀면 실기에서 잡은 값과 달라진다.
      expect(buildCameraRawDescriptor({ saturationOrange: 5 }).descriptor["$SA_O"]).toBe(5);
      expect(buildCameraRawDescriptor({ luminanceBlue: -8 }).descriptor["$LA_B"]).toBe(-8);
    });

    it("전역 saturation 과 섞이지 않는다", () => {
      // 전역은 `$` 가 없는 `saturation` 이고 색상별은 `$SA_*` 다. 이름이 비슷해 위험하다.
      const { descriptor } = buildCameraRawDescriptor({ saturation: 9, saturationOrange: 5 });
      expect(descriptor["saturation"]).toBe(9);
      expect(descriptor["$SA_O"]).toBe(5);
    });

    it("색상 혼합만으로는 화이트밸런스를 건드리지 않는다", () => {
      expect(buildCameraRawDescriptor({ saturationOrange: 5 }).descriptor["$WBal"]).toBeUndefined();
    });

    it("**버전 키를 넣지 않는다**", () => {
      // 잡힌 descriptor 에는 $CrVe·$PrVN·$PrVe 가 있었지만 빼도 동작한다.
      // 박아 넣으면 다른 Camera Raw 버전에서 깨진다.
      const { descriptor } = buildCameraRawDescriptor({ saturationOrange: 5, hueBlue: 3 });
      for (const key of ["$CrVe", "$PrVN", "$PrVe"]) {
        expect(descriptor[key]).toBeUndefined();
      }
    });

    it("24개가 전부 있다", () => {
      const params: Record<string, number> = {};
      for (const color of COLORS) {
        params[`hue${color}`] = 1;
        params[`saturation${color}`] = 2;
        params[`luminance${color}`] = 3;
      }
      const { applied, descriptor } = buildCameraRawDescriptor(params);
      expect(applied).toHaveLength(24);
      // _obj 하나를 더한 수다.
      expect(Object.keys(descriptor)).toHaveLength(25);
    });
  });

  /**
   * 곡선. (ROADMAP §17.30)
   *
   * `curve` 에 `$` 가 없다 — `saturation` 에 이은 두 번째 예외다.
   * 규칙성을 가정하면 이것 하나가 조용히 빠진다.
   */
  describe("곡선", () => {
    it("**파라메트릭 키를 잡아낸 그대로 보낸다**", () => {
      const { descriptor } = buildCameraRawDescriptor({
        curveHighlights: -43,
        curveLights: 0,
        curveDarks: 27,
        curveShadows: -14,
      });
      expect(descriptor["$PC_H"]).toBe(-43);
      expect(descriptor["$PC_L"]).toBe(0);
      expect(descriptor["$PC_D"]).toBe(27);
      expect(descriptor["$PC_S"]).toBe(-14);
    });

    it("구간 경계는 $PC_1·2·3 이다", () => {
      const { descriptor } = buildCameraRawDescriptor({
        curveShadowSplit: 25,
        curveMidtoneSplit: 50,
        curveHighlightSplit: 75,
      });
      expect(descriptor["$PC_1"]).toBe(25);
      expect(descriptor["$PC_2"]).toBe(50);
      expect(descriptor["$PC_3"]).toBe(75);
    });

    it("**RGB 포인트 곡선 키에는 `$` 가 없다**", () => {
      const { descriptor } = buildCameraRawDescriptor({
        curveRgb: [
          { x: 0, y: 0 },
          { x: 128, y: 140 },
          { x: 255, y: 255 },
        ],
      });
      expect(descriptor["curve"]).toEqual([0, 0, 128, 140, 255, 255]);
      expect(descriptor["$curve"]).toBeUndefined();
    });

    it("채널 곡선은 $CrvR·G·B 다", () => {
      const points = [
        { x: 0, y: 0 },
        { x: 255, y: 255 },
      ];
      expect(buildCameraRawDescriptor({ curveRed: points }).descriptor["$CrvR"]).toEqual([
        0, 0, 255, 255,
      ]);
      expect(buildCameraRawDescriptor({ curveGreen: points }).descriptor["$CrvG"]).toEqual([
        0, 0, 255, 255,
      ]);
      expect(buildCameraRawDescriptor({ curveBlue: points }).descriptor["$CrvB"]).toEqual([
        0, 0, 255, 255,
      ]);
    });

    it("점을 평탄 배열로 편다", () => {
      expect(
        flattenCurve([
          { x: 0, y: 0 },
          { x: 67, y: 57 },
          { x: 255, y: 255 },
        ]),
      ).toEqual([0, 0, 67, 57, 255, 255]);
    });

    it("**파라메트릭을 주면 구간 경계를 자동으로 채운다**", () => {
      // 경계 없이 $PC_H 만 보내면 ok 를 돌려주면서 아무 일도 하지 않는다.
      // 실기에서 달이 1레벨도 안 움직였다.
      const { descriptor } = buildCameraRawDescriptor({ curveHighlights: -60 });
      expect(descriptor["$PC_1"]).toBe(25);
      expect(descriptor["$PC_2"]).toBe(50);
      expect(descriptor["$PC_3"]).toBe(75);
    });

    it("호출자가 준 경계를 덮지 않는다", () => {
      const { descriptor } = buildCameraRawDescriptor({
        curveDarks: 10,
        curveMidtoneSplit: 40,
      });
      expect(descriptor["$PC_2"]).toBe(40);
      expect(descriptor["$PC_1"]).toBe(25);
    });

    it("포인트 곡선만 주면 경계를 넣지 않는다", () => {
      // 파라메트릭을 쓰지 않는데 경계가 붙으면 없던 설정을 만들어내는 셈이다.
      const { descriptor } = buildCameraRawDescriptor({
        curveRgb: [
          { x: 0, y: 0 },
          { x: 255, y: 255 },
        ],
      });
      expect(descriptor["$PC_1"]).toBeUndefined();
    });

    it("채도 미세 조정은 $crfs 다", () => {
      // descriptor 에 잡혀 있었지만 뜻을 몰라 한동안 빼 두었던 키다.
      expect(buildCameraRawDescriptor({ curveRefineSaturation: 60 }).descriptor["$crfs"]).toBe(60);
    });

    it("곡선만 주면 화이트밸런스를 건드리지 않는다", () => {
      const { descriptor } = buildCameraRawDescriptor({ curveDarks: 10 });
      expect(descriptor["$WBal"]).toBeUndefined();
    });

    it("기본 패널의 highlights 와 다른 키다", () => {
      // 이름이 비슷해 섞이기 쉽다. $Hi12 와 $PC_H 는 다른 것이다.
      const { descriptor } = buildCameraRawDescriptor({ highlights: -20, curveHighlights: -43 });
      expect(descriptor["$Hi12"]).toBe(-20);
      expect(descriptor["$PC_H"]).toBe(-43);
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

  /** ROADMAP 67 — 국소 보정. */
  describe("국소 보정", () => {
    const mask = {
      type: "linearGradient" as const,
      from: { x: 0.5, y: 0.8 },
      to: { x: 0.5, y: 0.1 },
    };

    it("**국소 보정만으로도 통과한다**", async () => {
      // 전역 설정 없이 마스크만 거는 것이 정상적인 쓰임이다.
      const mcp = setup();
      const layerId = await pixelLayer(mcp);
      const result = await apply(mcp, {
        layerId,
        localCorrections: [{ mask, exposure: 1.5 }],
      });
      expect(result["applied"]).toEqual(["localCorrections"]);
    });

    it("빈 배열은 거절한다", () => {
      // 빈 XMP 를 보내면 기존 보정이 조용히 지워진다.
      expect(CameraRawParamsSchema.safeParse({ localCorrections: [] }).success).toBe(false);
    });

    it("마스크 없는 보정은 거절한다", () => {
      expect(CameraRawParamsSchema.safeParse({ localCorrections: [{ exposure: 1 }] }).success).toBe(
        false,
      );
    });

    it("**모르는 마스크 종류를 조용히 통과시키지 않는다**", () => {
      // 방사형·범위·AI 는 아직 안 쟀다. linearGradient 로 떨어뜨리면 엉뚱한
      // 곳에 걸리고 호출자는 모른다.
      expect(
        CameraRawParamsSchema.safeParse({
          localCorrections: [{ mask: { ...mask, type: "radialGradient" } }],
        }).success,
      ).toBe(false);
    });

    it("**국소 노출은 ±4 다** — 전역(±5)과 다르다", () => {
      const ok = (exposure: number): boolean =>
        CameraRawParamsSchema.safeParse({ localCorrections: [{ mask, exposure }] }).success;
      expect(ok(4)).toBe(true);
      expect(ok(4.5)).toBe(false);
      // 전역은 5 까지 받는다.
      expect(CameraRawParamsSchema.safeParse({ exposure: 4.5 }).success).toBe(true);
    });

    it("**국소 색조는 ±180 이다** — 전역 색상 혼합(±100)과 다르다", () => {
      const ok = (hue: number): boolean =>
        CameraRawParamsSchema.safeParse({ localCorrections: [{ mask, hue }] }).success;
      expect(ok(180)).toBe(true);
      expect(ok(181)).toBe(false);
      expect(CameraRawParamsSchema.safeParse({ hueRed: 180 }).success).toBe(false);
    });

    it("**마스크 좌표의 음수를 막지 않는다**", () => {
      // 실기에서 Zero2Y 가 -0.707 이었다. 캔버스 밖으로 나간다.
      expect(
        CameraRawParamsSchema.safeParse({
          localCorrections: [{ mask: { ...mask, to: { x: 0.5, y: -0.7 } } }],
        }).success,
      ).toBe(true);
    });

    /**
     * **스마트 오브젝트에서는 필터가 쌓인다.** (ROADMAP §67)
     *
     * 실기에서 같은 보정을 두 번 걸었더니 노출 +3 이 두 번 먹어 하이라이트
     * 19.7% 가 날아갔다. 재지 않으면 모르는 종류라 결과에 개수를 담는다.
     */
    it("**두 번 걸면 smartFilterCount 가 2 다**", async () => {
      const mcp = setup();
      const layerId = await pixelLayer(mcp);
      const converted = (await mcp.tools.invoke(
        "photoshop.smart_object.convert",
        { layerId },
        { requestId: "so" },
      )) as { layer: { id: number } };
      const soId = converted.layer.id;

      const first = await apply(mcp, { layerId: soId, localCorrections: [{ mask, exposure: 1 }] });
      expect(first["smartFilterCount"]).toBe(1);
      const second = await apply(mcp, { layerId: soId, localCorrections: [{ mask, exposure: 1 }] });
      expect(second["smartFilterCount"]).toBe(2);
    });

    it("픽셀 레이어는 구워지므로 쌓이지 않는다", async () => {
      const mcp = setup();
      const layerId = await pixelLayer(mcp);
      const result = await apply(mcp, { layerId, localCorrections: [{ mask, exposure: 1 }] });
      expect(result["smartFilterCount"]).toBe(0);
    });
  });
});
