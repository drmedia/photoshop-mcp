import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CameraRawParamsSchema } from "@photoshop-mcp/photoshop-tools";
import {
  buildLocalCorrectionsXmp,
  escapeXml,
  formatColorGrade,
  formatXmpNumber,
  randomSyncId,
} from "../photoshop-uxp/src/dom/camera-raw-xmp.js";

/**
 * Camera Raw 국소 보정 XMP 조립. (ROADMAP §67)
 *
 * **실기 샘플과 바이트로 대조한다.** 구조는 ROADMAP §66 에 글로 적었지만
 * 들여쓰기·속성 순서·`+` 부호 같은 직렬화 관습은 글로는 남지 않는다.
 * `docs/samples/camera-raw-local-corrections.xmp` 가 그 기준이다.
 *
 * **샘플이 규격은 아니다.** 우리가 안 쓰는 것(색 보정·곡선·포인트 색상·
 * 양방향)이 샘플에는 들어 있다. 그래서 통째로 비교하지 않고 **우리가 내는
 * 부분이 샘플과 같은 모양인지**를 본다.
 */

const SAMPLE = readFileSync("docs/samples/camera-raw-local-corrections.xmp", "utf8");

/** 테스트에서 산출물을 고정하려면 id 가 결정적이어야 한다. */
function fixedIds(): () => string {
  let next = 0;
  return (): string => {
    next += 1;
    return `ID${String(next).padStart(30, "0")}`;
  };
}

describe("Camera Raw 국소 보정 XMP", () => {
  describe("숫자 다듬기", () => {
    it("**나눗셈 찌꺼기를 남기지 않는다**", () => {
      // 0.1 + 0.2 류의 부동소수 찌꺼기가 XMP 에 그대로 나가면 안 된다.
      expect(formatXmpNumber(3 / 4)).toBe("0.75");
      expect(formatXmpNumber(9 / 100)).toBe("0.09");
      expect(formatXmpNumber(90 / 180)).toBe("0.5");
      expect(formatXmpNumber(112 / 100)).toBe("1.12");
    });

    it("음수 0 을 만들지 않는다", () => {
      // "-0" 이 나가면 샘플과 모양이 달라진다.
      expect(formatXmpNumber(-0)).toBe("0");
      expect(formatXmpNumber(-0.0000001)).toBe("0");
    });

    it("**음수 좌표를 막지 않는다**", () => {
      // 실기에서 Zero2Y 가 -0.707237 이었다. 0–1 로 가두면 멀쩡한 값이 막힌다.
      expect(formatXmpNumber(-0.707237)).toBe("-0.707237");
    });

    it("NaN·Infinity 는 거절한다", () => {
      expect(() => formatXmpNumber(Number.NaN)).toThrow();
      expect(() => formatXmpNumber(Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  describe("이스케이프", () => {
    /**
     * **이름은 호출자가 준다.** 그대로 넣으면 XML 이 깨지거나 속성이
     * 주입된다 — descriptor 보다 위험한 자리다 (ARCHITECTURE §23).
     */
    it("**XML 을 깨뜨리는 문자를 막는다**", () => {
      expect(escapeXml('a"b')).toBe("a&quot;b");
      expect(escapeXml("a<b>c")).toBe("a&lt;b&gt;c");
      expect(escapeXml("a&b")).toBe("a&amp;b");
    });

    it("이름에 넣은 따옴표가 속성을 닫지 않는다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          {
            mask: { type: "linearGradient", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
            name: '" crs:LocalExposure2012="99',
          },
        ],
        fixedIds(),
      );
      expect(xmp).not.toContain('crs:LocalExposure2012="99"');
      expect(xmp).toContain("&quot;");
    });
  });

  describe("눈금", () => {
    const base = {
      mask: { type: "linearGradient" as const, from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
    };

    /** 실기에서 잰 것 그대로다 (ROADMAP §66). */
    it("**노출만 ÷4 다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ ...base, exposure: 3 }], fixedIds());
      expect(xmp).toContain('crs:LocalExposure2012="0.75"');
    });

    it("**색조는 ÷180 이다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ ...base, hue: 90 }], fixedIds());
      expect(xmp).toContain('crs:LocalHue="0.5"');
    });

    it("나머지는 ÷100 이다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ ...base, contrast: 9, shadows: 11, texture: 6, luminanceNoise: 15 }],
        fixedIds(),
      );
      expect(xmp).toContain('crs:LocalContrast2012="0.09"');
      expect(xmp).toContain('crs:LocalShadows2012="0.11"');
      expect(xmp).toContain('crs:LocalTexture="0.06"');
      expect(xmp).toContain('crs:LocalLuminanceNoise="0.15"');
    });

    it("**`amount` 는 ÷100 이고 1 을 넘는다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ ...base, amount: 112 }], fixedIds());
      expect(xmp).toContain('crs:CorrectionAmount="1.12"');
    });

    it("생략하면 amount 는 1 이다", () => {
      const xmp = buildLocalCorrectionsXmp([base], fixedIds());
      expect(xmp).toContain('crs:CorrectionAmount="1"');
    });
  });

  describe("샘플과의 대조", () => {
    const xmp = buildLocalCorrectionsXmp(
      [
        {
          mask: {
            type: "linearGradient",
            from: { x: 0.480487, y: 0.711423 },
            to: { x: 0.478693, y: 0.002093 },
          },
          amount: 112,
          exposure: 3,
          hue: 90,
          saturation: 50,
          sharpness: 9,
          contrast: 9,
          highlights: 9,
          shadows: 11,
          whites: 9,
          blacks: 9,
          clarity: 7,
          dehaze: 12,
          luminanceNoise: 15,
          moire: 13,
          defringe: 12,
          temperature: 8,
          tint: 9,
          texture: 6,
          grain: 12,
          glow: 13,
        },
      ],
      fixedIds(),
    );

    it("**머리와 꼬리가 샘플과 같다**", () => {
      expect(xmp.startsWith('<x:xmpmeta xmlns:x="adobe:ns:meta/"')).toBe(true);
      expect(xmp).toContain('xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"');
      expect(xmp.endsWith("</x:xmpmeta>\n")).toBe(true);
      // 샘플에도 있는 줄이다. 들여쓰기까지 같아야 한다.
      expect(SAMPLE).toContain("   <crs:MaskGroupBasedCorrections>\n");
      expect(xmp).toContain("   <crs:MaskGroupBasedCorrections>\n");
    });

    /**
     * **이것이 이 테스트의 핵심이다.** 기본 27개가 샘플과 같은 순서로
     * 나가는지 본다. 순서가 중요한지는 모르지만, 중요하다면 이것이 맞다.
     */
    it("**기본 27개가 샘플과 같은 순서로 나간다**", () => {
      const ours = [...xmp.matchAll(/crs:(Local[A-Za-z0-9]*)=/gu)].map((m) => m[1]);
      const sample = [...SAMPLE.matchAll(/crs:(Local[A-Za-z0-9]*)=/gu)]
        .map((m) => m[1] as string)
        // 샘플에는 우리가 아직 안 내는 것들이 섞여 있다.
        .filter((name) => !name.startsWith("LocalColorGrade"));
      expect(ours).toEqual(sample);
      expect(ours).toHaveLength(27);
    });

    it("**쓰지 않은 슬라이더는 0 으로 나간다**", () => {
      // Camera Raw 가 그렇게 낸다. 빼도 되는지는 모르므로 샘플을 따른다.
      const only = buildLocalCorrectionsXmp(
        [
          {
            mask: { type: "linearGradient", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } },
            exposure: 3,
          },
        ],
        fixedIds(),
      );
      expect(only).toContain('crs:LocalTexture="0"');
      expect(only).toContain('crs:LocalGrain="0"');
    });

    it("**죽은 키와 미확인 키는 고정값이다**", () => {
      expect(xmp).toContain('crs:LocalExposure="0"');
      expect(xmp).toContain('crs:LocalToningHue="0"');
      expect(xmp).toContain('crs:LocalBrightness="0"');
      // 이것만 0 이 아니다.
      expect(xmp).toContain('crs:LocalCurveRefineSaturation="100"');
    });

    it("**안 쓰는 블록은 내보내지 않는다**", () => {
      // 캡처 둘을 견주어 확인했다 — 쓸 때만 나타난다.
      expect(xmp).not.toContain("LocalColorGrade");
      expect(xmp).not.toContain("MainCurve");
      expect(xmp).not.toContain("LocalPointColors");
      expect(xmp).not.toContain("LocalColorVariance");
      // 반대로 샘플에는 있다 — 사람이 그것들을 건드렸기 때문이다.
      expect(SAMPLE).toContain("LocalColorGrade");
    });

    it("마스크 속성이 샘플과 같은 순서다", () => {
      const ours = [...xmp.matchAll(/crs:(What|Mask[A-Za-z]*|Zero[XY]|Full[XY])=/gu)].map(
        (m) => m[1],
      );
      expect(ours).toEqual([
        "What", // Correction
        "What", // Mask/Gradient
        "MaskActive",
        "MaskName",
        "MaskBlendMode",
        "MaskInverted",
        "MaskSyncID",
        "MaskValue",
        "ZeroX",
        "ZeroY",
        "FullX",
        "FullY",
      ]);
    });
  });

  /** ROADMAP 68 — 방사형. */
  describe("방사형", () => {
    const radial = {
      type: "radialGradient" as const,
      bounds: { top: 0.3, left: 0.3, bottom: 0.7, right: 0.7 },
    };

    it("**`Mask/CircularGradient` 다** — Radial 이 아니다", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: radial }], fixedIds());
      expect(xmp).toContain('crs:What="Mask/CircularGradient"');
      expect(xmp).not.toContain("Mask/Radial");
    });

    it("**중심·반지름이 아니라 경계 상자다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: radial }], fixedIds());
      expect(xmp).toContain('crs:Top="0.3"');
      expect(xmp).toContain('crs:Left="0.3"');
      expect(xmp).toContain('crs:Bottom="0.7"');
      expect(xmp).toContain('crs:Right="0.7"');
      // 선형의 좌표가 섞이면 안 된다.
      expect(xmp).not.toContain("crs:ZeroX");
      expect(xmp).not.toContain("crs:FullX");
    });

    it("페더·각도·둥글기는 원시값이다", () => {
      // 실기에서 UI 83 → Feather="83" 이었다.
      const xmp = buildLocalCorrectionsXmp(
        [{ mask: { ...radial, feather: 83, angle: 44.436428, roundness: 20 } }],
        fixedIds(),
      );
      expect(xmp).toContain('crs:Feather="83"');
      expect(xmp).toContain('crs:Angle="44.436428"');
      expect(xmp).toContain('crs:Roundness="20"');
    });

    /**
     * **`Flipped` 는 렌더링에 영향이 없다.** (ROADMAP §68)
     *
     * 처음에 `inverted` 를 `Flipped` 로 보냈더니 `true` 와 `false` 가 **같은
     * 그림**을 냈다 — 조용히 아무 일도 안 하는 그 경로다. 픽셀로 재서
     * `MaskInverted` 가 진짜임을 확인했다.
     */
    it("**inverted 는 `MaskInverted` 로 간다** — `Flipped` 가 아니다", () => {
      const on = buildLocalCorrectionsXmp([{ mask: { ...radial, inverted: true } }], fixedIds());
      expect(on).toContain('crs:MaskInverted="true"');
      // Flipped 는 고정이다. 여기에 실으면 조용히 무시된다.
      expect(on).toContain('crs:Flipped="false"');

      const off = buildLocalCorrectionsXmp([{ mask: radial }], fixedIds());
      expect(off).toContain('crs:MaskInverted="false"');
      expect(off).toContain('crs:Flipped="false"');
    });

    it("선형과 방사형을 한 번에 담는다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          { mask: { type: "linearGradient", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } } },
          { mask: radial },
        ],
        fixedIds(),
      );
      expect(xmp).toContain('crs:What="Mask/Gradient"');
      expect(xmp).toContain('crs:What="Mask/CircularGradient"');
    });

    it('방사형에도 `Version="2"` 를 붙인다', () => {
      // 실기 캡처에 있던 것이다. 필수인지는 모르지만 빼서 얻는 것이 없다.
      const xmp = buildLocalCorrectionsXmp([{ mask: radial }], fixedIds());
      expect(xmp).toContain('crs:Version="2"');
    });
  });

  /** ROADMAP 69 — 색 보정 열넷. */
  describe("색 보정", () => {
    const mask = {
      type: "linearGradient" as const,
      from: { x: 0, y: 0 },
      to: { x: 0, y: 1 },
    };

    it("**안 주면 키가 아예 없다**", () => {
      // 캡처 둘을 견주어 확인했다 — 쓸 때만 나타난다.
      const xmp = buildLocalCorrectionsXmp([{ mask }], fixedIds());
      expect(xmp).not.toContain("LocalColorGrade");
    });

    it("**하나만 줘도 열넷이 전부 나간다**", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask, colorGrade: { global: { luminance: 8 } } }],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:LocalColorGrade[A-Za-z]+=/gu)]).toHaveLength(14);
    });

    /**
     * **정규화하지 않는다.** 다른 국소 슬라이더가 ±1 로 들어가는 것과 다르다.
     * `Local` 로 시작한다고 다 같은 규칙이 아니다 (ROADMAP §66).
     */
    it("**UI 값이 그대로, 부호를 붙여 나간다**", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          {
            mask,
            colorGrade: {
              shadows: { hue: 27, saturation: 16, luminance: 10 },
              midtones: { hue: 2, saturation: 21, luminance: 35 },
              highlights: { hue: 355, saturation: 32, luminance: 14 },
              global: { hue: 15, saturation: 100, luminance: 8 },
              blending: 53,
              balance: 24,
            },
          },
        ],
        fixedIds(),
      );
      // 실기 샘플과 같은 값이다.
      expect(xmp).toContain('crs:LocalColorGradeShadowHue="+27"');
      expect(xmp).toContain('crs:LocalColorGradeShadowSat="+16"');
      expect(xmp).toContain('crs:LocalColorGradeShadowLum="+10"');
      expect(xmp).toContain('crs:LocalColorGradeMidtoneLum="+35"');
      // 색조는 0-359 이고 음수로 접히지 않는다.
      expect(xmp).toContain('crs:LocalColorGradeHighlightHue="+355"');
      expect(xmp).toContain('crs:LocalColorGradeGlobalSat="+100"');
      expect(xmp).toContain('crs:LocalColorGradeBlending="+53"');
      expect(xmp).toContain('crs:LocalColorGradeBalance="+24"');
    });

    it("**순서가 샘플과 같다** — UI 순서가 아니다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask, colorGrade: { global: { luminance: 8 } } }],
        fixedIds(),
      );
      const ours = [...xmp.matchAll(/crs:LocalColorGrade([A-Za-z]+)=/gu)].map((m) => m[1]);
      const sample = [...SAMPLE.matchAll(/crs:LocalColorGrade([A-Za-z]+)=/gu)].map((m) => m[1]);
      expect(ours).toEqual(sample);
      // Balance 가 다섯 번째에 끼어 있다. 지어낸 순서가 아니라는 증거다.
      expect(ours[4]).toBe("Balance");
    });

    it("**혼합은 생략하면 50 이다** — 0 이 아니다", () => {
      // 0 이면 구간이 섞이지 않아 호출자가 의도하지 않은 결과가 된다.
      const xmp = buildLocalCorrectionsXmp(
        [{ mask, colorGrade: { shadows: { hue: 200, saturation: 30 } } }],
        fixedIds(),
      );
      expect(xmp).toContain('crs:LocalColorGradeBlending="+50"');
      expect(xmp).toContain('crs:LocalColorGradeBalance="+0"');
    });

    it("음수는 부호 그대로 간다", () => {
      // 실기에서 음수는 못 봤다. "-24" 가 자연스럽지만 확인은 아니다.
      expect(formatColorGrade(-24)).toBe("-24");
      expect(formatColorGrade(0)).toBe("+0");
      expect(formatColorGrade(24)).toBe("+24");
    });

    it("**국소 hue 와 색 보정 hue 는 다른 규칙이다**", () => {
      // 같은 "색조" 인데 하나는 ÷180, 하나는 원시 0-359 다.
      const xmp = buildLocalCorrectionsXmp(
        [{ mask, hue: 90, colorGrade: { global: { hue: 90 } } }],
        fixedIds(),
      );
      expect(xmp).toContain('crs:LocalHue="0.5"');
      expect(xmp).toContain('crs:LocalColorGradeGlobalHue="+90"');
    });
  });

  /** ROADMAP 73 — 마스크 빼기. */
  describe("마스크 빼기", () => {
    const linear = {
      type: "linearGradient" as const,
      from: { x: 0.5, y: 0.6 },
      to: { x: 0.5, y: 0 },
    };
    const radial = {
      type: "radialGradient" as const,
      bounds: { top: 0.03, left: 0.21, bottom: 0.49, right: 0.69 },
      feather: 83,
    };

    it("**한 보정에 마스크 둘이 들어간다**", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "subtract", mask: radial }] }],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:What="Mask\//gu)]).toHaveLength(2);
      // 보정은 하나다 — 마스크만 둘이다.
      expect([...xmp.matchAll(/crs:What="Correction"/gu)]).toHaveLength(1);
    });

    /**
     * **실기에서 둘이 함께 바뀌었다.** `빼기` 를 걸었더니 `MaskBlendMode` 가
     * `0 → 1`, `MaskValue` 가 `1 → 0` 으로 갔다. 어느 쪽이 일을 하는지 모르니
     * Photoshop 이 낸 짝을 그대로 쓴다.
     */
    it("**바탕은 (0,1) 빼기는 (1,0) 이다**", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "subtract", mask: radial }] }],
        fixedIds(),
      );
      const blends = [...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1]);
      const values = [...xmp.matchAll(/crs:MaskValue="(\d)"/gu)].map((m) => m[1]);
      expect(blends).toEqual(["0", "1"]);
      expect(values).toEqual(["1", "0"]);
    });

    it("빼는 마스크가 없으면 바탕만 나간다", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: linear }], fixedIds());
      expect([...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1])).toEqual(["0"]);
    });

    it("여러 개를 뺀다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          {
            mask: linear,
            combine: [
              { mode: "subtract", mask: radial },
              { mode: "subtract", mask: linear },
            ],
          },
        ],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1])).toEqual([
        "0",
        "1",
        "1",
      ]);
    });

    /**
     * **합집합은 바탕과 같은 짝이다.** (ROADMAP §74)
     *
     * §74 에서 이것을 "교차" 로 고쳤다가 **다시 틀린 것이 드러났다.** 캡처
     * 한 장을 눈으로 읽고 정했는데, 재서 보니 바탕 밖의 타원 안쪽이 그대로
     * 밝아졌다 — 합집합이다.
     */
    it("**합집합은 (0,1) 이다** — 바탕과 같다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "add", mask: radial }] }],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1])).toEqual(["0", "0"]);
      expect([...xmp.matchAll(/crs:MaskValue="(\d)"/gu)].map((m) => m[1])).toEqual(["1", "1"]);
    });

    it("빼기와 합집합을 섞는다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          {
            mask: linear,
            combine: [
              { mode: "add", mask: radial },
              { mode: "subtract", mask: linear },
            ],
          },
        ],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1])).toEqual([
        "0",
        "0",
        "1",
      ]);
    });

    /**
     * **교차는 따로 있는 모드가 아니다.** (ROADMAP §78)
     *
     * 실기 캡처에서 교차 마스크가 빼기와 **같은 `(1,0)`** 을 쓰면서
     * `MaskInverted` 만 `true` 였다 — `A ∩ B = A − ¬B`.
     */
    it("**교차는 빼기 + 반전이다**", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "intersect", mask: radial }] }],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1])).toEqual(["0", "1"]);
      expect([...xmp.matchAll(/crs:MaskValue="(\d)"/gu)].map((m) => m[1])).toEqual(["1", "0"]);
      expect([...xmp.matchAll(/crs:MaskInverted="(\w+)"/gu)].map((m) => m[1])).toEqual([
        "false",
        "true",
      ]);
    });

    /**
     * **교차에 반전을 걸면 빼기와 같아진다.** `A − ¬¬B = A − B`.
     * 수학이 그렇게 접히는 것이라 막지 않고 그대로 낸다.
     */
    it("교차 + inverted 는 빼기로 접힌다", () => {
      const folded = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "intersect", mask: { ...radial, inverted: true } }] }],
        fixedIds(),
      );
      const plain = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "subtract", mask: radial }] }],
        fixedIds(),
      );
      expect(folded).toBe(plain);
    });

    /** **실기는 이 동치로 쟀다** — 서버가 `intersect` 를 모르던 때였다. */
    it("교차와 '빼기 + 반전' 이 같은 XML 이다", () => {
      const asIntersect = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "intersect", mask: radial }] }],
        fixedIds(),
      );
      const asSubtract = buildLocalCorrectionsXmp(
        [{ mask: linear, combine: [{ mode: "subtract", mask: { ...radial, inverted: true } }] }],
        fixedIds(),
      );
      expect(asIntersect).toBe(asSubtract);
    });

    /** 바탕 마스크의 반전은 그대로 간다 — 뒤집는 것은 교차뿐이다. */
    it("바탕의 inverted 는 건드리지 않는다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          {
            mask: { ...linear, inverted: true },
            combine: [{ mode: "add", mask: radial }],
          },
        ],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:MaskInverted="(\w+)"/gu)].map((m) => m[1])).toEqual([
        "true",
        "false",
      ]);
    });
  });

  describe("계약", () => {
    it("보정이 없으면 거절한다", () => {
      // 빈 XMP 를 보내면 기존 보정이 조용히 지워진다.
      expect(() => buildLocalCorrectionsXmp([])).toThrow();
    });

    it("보정 여럿을 담는다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          { mask: { type: "linearGradient", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } } },
          { mask: { type: "linearGradient", from: { x: 1, y: 0 }, to: { x: 1, y: 1 } } },
        ],
        fixedIds(),
      );
      expect([...xmp.matchAll(/crs:What="Correction"/gu)]).toHaveLength(2);
      expect(xmp).toContain('crs:CorrectionName="마스크 1"');
      expect(xmp).toContain('crs:CorrectionName="마스크 2"');
    });

    it("**보정마다 다른 SyncID 를 쓴다**", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          { mask: { type: "linearGradient", from: { x: 0, y: 0 }, to: { x: 0, y: 1 } } },
          { mask: { type: "linearGradient", from: { x: 1, y: 0 }, to: { x: 1, y: 1 } } },
        ],
        fixedIds(),
      );
      const ids = [...xmp.matchAll(/SyncID="([^"]+)"/gu)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("SyncID 는 32자리 대문자 16진수다", () => {
      expect(randomSyncId(() => 0.5)).toMatch(/^[0-9A-F]{32}$/u);
      expect(randomSyncId()).toMatch(/^[0-9A-F]{32}$/u);
    });

    it("inverted 를 반영한다", () => {
      const on = buildLocalCorrectionsXmp(
        [
          {
            mask: {
              type: "linearGradient",
              from: { x: 0, y: 0 },
              to: { x: 0, y: 1 },
              inverted: true,
            },
          },
        ],
        fixedIds(),
      );
      expect(on).toContain('crs:MaskInverted="true"');
    });
  });
  /** ROADMAP 75 — 광도 범위 마스크. */
  describe("광도 범위 마스크", () => {
    const range = {
      type: "luminanceRange" as const,
      range: { min: 20, max: 80 },
    };

    /**
     * **모양이 그레이디언트와 다르다.** 저쪽은 속성만 있는 빈 `<rdf:li …/>`
     * 인데 이쪽은 자식을 가진 `<rdf:Description>` 이다.
     */
    it("**자식을 가진 `<rdf:Description>` 으로 나간다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: range }], fixedIds());
      expect(xmp).toContain('crs:What="Mask/RangeMask"');
      expect(xmp).toContain("<crs:CorrectionRangeMask");
      // 그레이디언트의 빈 요소 형태가 아니다 — `<rdf:li>` 가 혼자 열린다.
      expect(xmp).toContain("        <rdf:li>");
    });

    /** **÷100 이고 칸 넷은 `(min, min, max, max)` 다.** 실기 캡처와 같다. */
    it("**LumRange 는 UI 값의 ÷100 을 네 칸에 넣는다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: range }], fixedIds());
      expect(xmp).toContain('crs:LumRange="0.200000 0.200000 0.800000 0.800000"');
    });

    /** **자릿수를 고정한다** — 다른 값과 달리 뒤 0 을 떼지 않는다. */
    it("여섯 자리로 채운다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [{ mask: { type: "luminanceRange", range: { min: 0, max: 100 } } }],
        fixedIds(),
      );
      expect(xmp).toContain('crs:LumRange="0.000000 0.000000 1.000000 1.000000"');
    });

    /** 2 가 광도다. 캡처의 이름이 `광도 범위 1` 이었다. */
    it("Type 은 2 다", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: range }], fixedIds());
      expect(xmp).toContain('crs:Type="2"');
      expect(xmp).toContain('crs:Version="4"');
    });

    /**
     * **`SampleType` 이 없으면 조용히 아무 일도 안 한다.** (ROADMAP §75)
     *
     * 실기에서 빼고 걸었더니 노출 +3 이 세 영역 모두 소수점까지 그대로였다.
     * `0` 도 같았고 `2` 여야 들었다. 그래서 반드시 나가야 한다.
     */
    it("**SampleType 2 가 반드시 나간다**", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: range }], fixedIds());
      expect(xmp).toContain('crs:SampleType="2"');
    });

    /** **`LuminanceDepthSampleInfo` 는 필수가 아니다** — 빼고 걸어 확인했다. */
    it("LuminanceDepthSampleInfo 는 안 낸다", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: range }], fixedIds());
      expect(xmp).not.toContain("crs:LuminanceDepthSampleInfo");
    });

    /**
     * **반전은 위쪽 `MaskInverted` 가 한다.** 실기에서 재서 확인했다 —
     * 구간 안이 아니라 밖의 픽셀이 올라갔다. 아래 `Invert` 는 고정이다.
     */
    it("반전은 MaskInverted 로 간다", () => {
      const xmp = buildLocalCorrectionsXmp([{ mask: { ...range, inverted: true } }], fixedIds());
      expect(xmp).toContain('crs:MaskInverted="true"');
      expect(xmp).toContain('crs:Invert="false"');
    });

    /** 그레이디언트와 섞어 `combine` 에 넣을 수 있다. */
    it("combine 에도 들어간다", () => {
      const xmp = buildLocalCorrectionsXmp(
        [
          {
            mask: { type: "linearGradient", from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } },
            combine: [{ mode: "subtract", mask: range }],
          },
        ],
        fixedIds(),
      );
      expect(xmp).toContain('crs:What="Mask/Gradient"');
      expect(xmp).toContain('crs:What="Mask/RangeMask"');
      expect([...xmp.matchAll(/crs:MaskBlendMode="(\d)"/gu)].map((m) => m[1])).toEqual(["0", "1"]);
    });

    /** **뒤집힌 범위는 거절한다.** 조용히 맞바꾸면 준 값이 들어간 줄 안다. */
    it("**min >= max 를 거절한다**", () => {
      expect(
        CameraRawParamsSchema.safeParse({
          localCorrections: [{ mask: { type: "luminanceRange", range: { min: 80, max: 20 } } }],
        }).success,
      ).toBe(false);
    });

    /** 색상·심도 범위는 `Type` 값을 안 봤다. */
    it("**colorRange 는 받지 않는다** — Type 을 모른다", () => {
      expect(
        CameraRawParamsSchema.safeParse({
          localCorrections: [{ mask: { type: "colorRange", range: { min: 20, max: 80 } } }],
        }).success,
      ).toBe(false);
    });
  });
});
