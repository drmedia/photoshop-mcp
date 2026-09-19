/**
 * 조정 레이어 종류 매핑. (ROADMAP §17.24)
 *
 * `photoshop` 을 import 하지 않는다. 순수 함수라 단위 테스트로 고정할 수 있다 —
 * `mappings.ts` · `tilt.ts` 와 같은 이유다.
 *
 * ## 짐작한 값을 사실처럼 말하지 않는다
 *
 * Photoshop 은 조정 레이어의 내용을 descriptor 클래스 이름으로 준다. 그 이름이
 * 우리 표기와 늘 같지는 않고 버전에 따라 늘어난다.
 *
 * 그래서 **아는 것만 옮기고 모르는 것은 `null` 로 두며 원본을 함께 돌려준다.**
 * 이 프로젝트에서 `rawBitDepth` · `rawKind` · `rawBlendMode` 로 세 번 실제 버그를
 * 잡은 규칙이다.
 */

import type { AdjustmentType } from "@photoshop-mcp/photoshop-bridge";

export interface AdjustmentKindResult {
  adjustmentType: AdjustmentType | null;
  raw?: string;
}

/**
 * descriptor 클래스 이름 → 프로토콜 표기.
 *
 * `✓` 는 Photoshop 27.8 에서 실제로 확인한 것이다. 나머지는 확인하지 못했고,
 * 틀리면 그 종류가 `null` 로 나오면서 `raw` 에 진짜 이름이 담긴다 — 한 번
 * 만들어 보면 드러난다.
 *
 * `brightnessEvent` 처럼 **UI 이름과 클래스 이름이 다른 것**이 있어서 이 표가
 * 필요하다.
 */
const KINDS: Record<string, AdjustmentType> = {
  brightnessEvent: "brightnessContrast", // ✓
  levels: "levels", // ✓
  curves: "curves", // ✓
  exposure: "exposure",
  vibrance: "vibrance", // ✓
  hueSaturation: "hueSaturation", // ✓
  colorBalance: "colorBalance", // ✓
  blackAndWhite: "blackAndWhite",
  photoFilter: "photoFilter",
  channelMixer: "channelMixer",
  colorLookup: "colorLookup",
  invert: "invert",
  posterization: "posterize",
  thresholdClassEvent: "threshold",
  gradientMapClass: "gradientMap",
  selectiveColor: "selectiveColor",
};

/**
 * Photoshop 이 준 `adjustment` 항목에서 종류를 읽는다.
 *
 * 값은 배열이고 그 첫 항목의 `_obj` 가 클래스 이름이다. 모양이 예상과 다르면
 * `null` 을 돌려주되 **무엇을 받았는지 문자열로 남긴다** — 다음에 이 자리를
 * 고칠 사람이 짐작하지 않아도 되도록.
 */
export function toAdjustmentKind(value: unknown): AdjustmentKindResult {
  if (!Array.isArray(value) || value.length === 0) {
    return { adjustmentType: null };
  }

  const first = value[0] as { _obj?: unknown } | null;
  const className = first?._obj;
  if (typeof className !== "string" || className.length === 0) {
    return { adjustmentType: null };
  }

  const mapped = KINDS[className];
  return mapped === undefined
    ? { adjustmentType: null, raw: className }
    : { adjustmentType: mapped };
}
