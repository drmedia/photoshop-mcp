import { describe, expect, it } from "vitest";
import {
  cleanText,
  formatExposureTime,
  parseRational,
  round,
  toInteger,
} from "../photoshop-uxp/src/dom/exif-values.js";

/**
 * EXIF 값의 모양 맞추기. (ROADMAP §76)
 *
 * XMP 의 EXIF 는 대부분 **유리수 문자열**이다. 순수 로직이라 실기 없이
 * 규칙을 여기에 고정한다 — `camera-raw-xmp.ts` 와 같은 자리다.
 */
describe("EXIF 값", () => {
  describe("parseRational", () => {
    it("유리수를 수로 만든다", () => {
      expect(parseRational("1/125")).toBeCloseTo(0.008, 6);
      expect(parseRational("300/10")).toBe(30);
    });

    it("분수가 아니면 그대로 읽는다", () => {
      expect(parseRational("2.8")).toBe(2.8);
      expect(parseRational("30")).toBe(30);
    });

    /** **0 으로 나누지 않는다.** 일부 카메라가 `0/0` 을 남긴다. */
    it("0 분모와 빈 값은 null 이다", () => {
      expect(parseRational("0/0")).toBeNull();
      expect(parseRational("")).toBeNull();
      expect(parseRational(null)).toBeNull();
      expect(parseRational(undefined)).toBeNull();
      expect(parseRational("f/2.8")).toBeNull();
    });
  });

  describe("formatExposureTime", () => {
    /** **1초 미만은 분수로 둔다.** `0.008` 보다 `1/125` 가 알아보기 쉽다. */
    it("짧은 노출은 분수로 남긴다", () => {
      expect(formatExposureTime("1/125")).toBe("1/125s");
    });

    /** **약분하지 않는다.** 우리가 고쳐 쓰면 원본과 다른 값을 말하게 된다. */
    it("약분하지 않는다", () => {
      expect(formatExposureTime("10/1250")).toBe("10/1250s");
    });

    it("1초 이상은 초로 읽는다", () => {
      expect(formatExposureTime("30/1")).toBe("30s");
      expect(formatExposureTime("30")).toBe("30s");
    });

    it("못 읽으면 null 이다", () => {
      expect(formatExposureTime(null)).toBeNull();
      expect(formatExposureTime("이상한 값")).toBeNull();
    });
  });

  describe("round", () => {
    it("자리를 다듬는다", () => {
      expect(round(2.7999999, 2)).toBe(2.8);
      expect(round(0.008, 6)).toBe(0.008);
    });

    /** `-0` 을 내보내지 않는다. JSON 에서 `-0` 은 읽는 쪽을 헷갈리게 한다. */
    it("음의 0 을 0 으로 만든다", () => {
      expect(Object.is(round(-0.0001, 2), 0)).toBe(true);
    });

    it("값이 없으면 null 이다", () => {
      expect(round(null, 2)).toBeNull();
    });
  });

  describe("toInteger", () => {
    it("ISO 처럼 정수여야 하는 자리를 맞춘다", () => {
      expect(toInteger("6400")).toBe(6400);
      expect(toInteger("6400/1")).toBe(6400);
      expect(toInteger(800)).toBe(800);
    });

    it("못 읽으면 null 이다", () => {
      expect(toInteger(null)).toBeNull();
      expect(toInteger("")).toBeNull();
    });
  });

  describe("cleanText", () => {
    it("빈 문자열은 null 이다", () => {
      expect(cleanText("  ")).toBeNull();
      expect(cleanText("")).toBeNull();
    });

    it("앞뒤 공백을 떼고 돌려준다", () => {
      expect(cleanText("  NIKON Z 6  ")).toBe("NIKON Z 6");
    });

    /** 문자열이 아니면 `null` 이다 — 지어내지 않는다. */
    it("문자열이 아니면 null 이다", () => {
      expect(cleanText(123)).toBeNull();
      expect(cleanText(undefined)).toBeNull();
    });
  });
});
