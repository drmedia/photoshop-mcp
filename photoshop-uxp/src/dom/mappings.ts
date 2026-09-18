import type { LayerType } from "@photoshop-mcp/photoshop-bridge";

/**
 * Photoshop 열거형 값을 프로토콜 표기로 바꾸는 순수 함수 모음.
 *
 * `photoshop` 모듈에 의존하지 않으므로 Photoshop 없이 테스트할 수 있다.
 *
 * 주의: Photoshop 의 열거형 값은 버전에 따라 늘어난다.
 * 모르는 값에 예외를 던지지 않고 안전한 기본값으로 떨어뜨린다.
 * 조회 한 건의 알 수 없는 값 때문에 목록 전체를 실패시키지 않기 위함이다.
 */

/** {@link toBitDepth} 결과. 해석 실패 시 `bitDepth` 는 `null` 이고 `raw` 가 채워진다. */
export interface BitDepthResult {
  bitDepth: number | null;
  raw?: string;
}

/**
 * `Constants.BitsPerChannelType` 를 숫자로 바꾼다.
 *
 * UXP 버전에 따라 문자열 열거형 또는 숫자가 올 수 있어 양쪽을 처리한다.
 *
 * 해석하지 못하면 `null` 과 원본을 돌려준다. 예전에는 8 로 떨어뜨렸는데,
 * 실기에서 16비트 문서가 8비트로 보고되는 문제가 있었다. 모르는 값을
 * 그럴듯한 기본값으로 덮으면 호출자가 틀린 값을 사실로 받아들인다.
 */
export function toBitDepth(value: unknown): BitDepthResult {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { bitDepth: value };
  }

  const raw = String(value);

  // 실기 확인: Photoshop 27.8 은 "bitDepth8" / "bitDepth16" / "bitDepth32" 를 반환한다.
  // 숫자를 뽑아내므로 새 값이 생겨도 대응된다.
  const matched = /^bitDepth(\d+)$/i.exec(raw);
  if (matched !== null) {
    const parsed = Number.parseInt(matched[1] ?? "", 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return { bitDepth: parsed };
    }
  }

  // Adobe 문서에 나오는 표기. 실기에서는 관측되지 않았지만 버전에 따라 올 수 있다.
  switch (raw) {
    case "one":
      return { bitDepth: 1 };
    case "eight":
      return { bitDepth: 8 };
    case "sixteen":
      return { bitDepth: 16 };
    case "thirtyTwo":
      return { bitDepth: 32 };
    default:
      return { bitDepth: null, raw };
  }
}

/**
 * `Constants.DocumentMode` 를 PROTOCOL.md §4 의 표기로 정규화한다.
 *
 * 매핑에 없는 값은 원본 문자열을 그대로 돌려준다. 정보를 버리지 않기 위함이다.
 */
export function toColorMode(value: unknown): string {
  const raw = String(value);
  switch (raw.toLowerCase()) {
    // 실기 확인: Photoshop 27.8 은 "RGBColorMode" 형태를 반환한다.
    case "rgb":
    case "rgbcolor":
    case "rgbcolormode":
      return "RGB";
    case "cmyk":
    case "cmykcolor":
    case "cmykcolormode":
      return "CMYK";
    case "grayscale":
    case "gray":
    case "grayscalemode":
      return "Grayscale";
    case "lab":
    case "labcolor":
    case "labcolormode":
      return "Lab";
    case "bitmap":
    case "bitmapmode":
      return "Bitmap";
    case "indexed":
    case "indexedcolor":
    case "indexedcolormode":
      return "Indexed";
    case "multichannel":
    case "multichannelmode":
      return "Multichannel";
    case "duotone":
    case "duotonemode":
      return "Duotone";
    default:
      return raw;
  }
}

/** `Constants.LayerKind` 중 adjustment 계열. */
const ADJUSTMENT_KINDS = new Set([
  "adjustment",
  "blackandwhite",
  "brightnesscontrast",
  "channelmixer",
  "colorbalance",
  "colorlookup",
  "curves",
  "exposure",
  "gradientmap",
  "huesaturation",
  "invert",
  "levels",
  "photofilter",
  "posterize",
  "selectivecolor",
  "threshold",
  "vibrance",
]);

/** shape / fill 계열. PROTOCOL.md §4 에서는 `shape` 로 묶는다. */
const SHAPE_KINDS = new Set([
  "solidcolor",
  "solidfill",
  "gradient",
  "gradientfill",
  "pattern",
  "patternfill",
  "vector",
]);

/**
 * Photoshop 의 `LayerKind` 를 PROTOCOL.md §4 의 `type` 으로 매핑한다.
 *
 * 분류를 알 수 없는 값은 `pixel` 로 본다.
 */
export function toLayerType(kind: unknown): LayerType {
  const raw = String(kind).toLowerCase();

  if (raw === "group" || raw === "layersection" || raw === "layergroup") {
    return "group";
  }
  if (raw === "text" || raw === "textlayer") {
    return "text";
  }
  if (raw === "smartobject") {
    return "smartObject";
  }
  if (ADJUSTMENT_KINDS.has(raw)) {
    return "adjustment";
  }
  if (SHAPE_KINDS.has(raw)) {
    return "shape";
  }
  return "pixel";
}
