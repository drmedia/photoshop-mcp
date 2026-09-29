/**
 * EXIF 값의 모양 맞추기. (ROADMAP §76)
 *
 * **`photoshop` 을 import 하지 않는다.** `camera-raw-xmp.ts` 와 같은 이유다 —
 * 순수 로직이어야 실기 없이 규칙을 테스트로 고정할 수 있다.
 *
 * XMP 의 EXIF 값은 대부분 **유리수 문자열**이다(`"1/125"` · `"300/10"`).
 * 사람이 읽는 형태와 계산에 쓰는 수는 서로 다른 물건이라 **둘 다 낸다** —
 * 노출 시간은 `"1/125"` 로 보여야 알아보고, 길이 비교는 `0.008` 로 해야 한다.
 */

/** 유리수 문자열을 수로. `"300/10"` → 30. 모양이 다르면 `null`. */
export function parseRational(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  if (text === "") {
    return null;
  }
  const slash = text.indexOf("/");
  if (slash < 0) {
    const plain = Number(text);
    return Number.isFinite(plain) ? plain : null;
  }
  const numerator = Number(text.slice(0, slash));
  const denominator = Number(text.slice(slash + 1));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

/**
 * 노출 시간을 사람이 읽는 형태로.
 *
 * **1초 미만은 분수로 둔다.** `0.008` 보다 `1/125` 가 알아보기 쉽고,
 * 천체사진 쪽의 긴 노출은 `30초` 처럼 초로 읽는 것이 낫다.
 *
 * XMP 가 이미 `"1/125"` 로 주면 그대로 쓴다 — 우리가 다시 근사하지 않는다.
 */
export function formatExposureTime(raw: string | null | undefined): string | null {
  const seconds = parseRational(raw);
  if (seconds === null) {
    return null;
  }
  if (seconds >= 1) {
    /* `30/1` 같은 것을 `30` 으로 줄인다. 소수점이 필요한 값은 남긴다. */
    return `${String(Math.round(seconds * 1000) / 1000)}s`;
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text.includes("/")) {
    const [numerator, denominator] = text.split("/");
    /* `1/125` 는 그대로, `10/1250` 처럼 약분되지 않은 것도 그대로 둔다 —
     * 우리가 고쳐 쓰면 원본과 다른 값을 말하게 된다. */
    return `${String(numerator)}/${String(denominator)}s`;
  }
  return `${String(seconds)}s`;
}

/** 소수 자리를 다듬는다. 값이 없으면 `null`. */
export function round(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 정수만 받는다. ISO 처럼 정수여야 하는 자리에서 쓴다. */
export function toInteger(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? value : Math.round(value);
  }
  const parsed = parseRational(value);
  return parsed === null ? null : Math.round(parsed);
}

/**
 * EXIF 의 날짜를 그대로 둘지 정한다.
 *
 * **바꾸지 않는다.** XMP 의 `exif:DateTimeOriginal` 은 이미 ISO 8601 이고,
 * 시간대가 없는 것도 있다. `Date` 로 파싱해 다시 쓰면 **없던 시간대가
 * 생긴다** — 서버의 시간대가 붙어 찍은 시각이 몇 시간 어긋난다.
 */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim();
  return text === "" ? null : text;
}
