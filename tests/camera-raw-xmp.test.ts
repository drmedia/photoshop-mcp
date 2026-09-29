import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildLocalCorrectionsXmp,
  escapeXml,
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
});
