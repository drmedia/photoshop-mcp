/**
 * Camera Raw 국소 보정 XMP 조립. (ROADMAP §67)
 *
 * **`photoshop` 을 import 하지 않는다.** `camera-raw-keys.ts` 와 같은 이유다 —
 * 순수 로직이어야 실기 없이 규칙을 테스트로 고정할 수 있다.
 *
 * ## 왜 XML 인가
 *
 * 마스크는 descriptor 객체가 아니라 `$LCs` 키에 든 **XMP XML 문자열**이다
 * (ROADMAP §66). 짐작이 아니라 실기 샘플에서 확인했다 —
 * `docs/samples/camera-raw-local-corrections.xmp`.
 *
 * ## **호출자는 문자열을 넘길 수 없다**
 *
 * descriptor 보다 위험하다. XML 이 통째로 Camera Raw 에 들어가므로 **검증된
 * 파라미터로만 조립한다.** (ARCHITECTURE §23) 이름은 XML 이스케이프한다.
 *
 * ## 눈금이 제각각이다
 *
 * UI 값을 그대로 받아 여기서 나눈다. **나누는 수가 슬라이더마다 다르고**
 * 전부 실기에서 쟀다 — 노출 ÷4 · 색조 ÷180 · 나머지 ÷100.
 *
 * ## 안 쓰는 키도 내보낸다
 *
 * 기본 27개는 Camera Raw 가 언제나 내보낸다. 안 쓰면 0 이고
 * `LocalCurveRefineSaturation` 만 100 이다. **빠뜨려도 되는지는 모른다** —
 * 샘플을 따르는 것이 안전한 쪽이다.
 *
 * 반대로 `ColorGrade*` · `MainCurve` · `LocalPointColors` 는 **쓸 때만**
 * 나타난다. 캡처 둘을 견주어 확인했다.
 */

/** 선형 그레이디언트 마스크. 좌표는 0–1 정규화이며 **음수일 수 있다**. */
export interface LinearGradientMask {
  type: "linearGradient";
  /** 효과가 0 인 쪽. */
  from: { x: number; y: number };
  /** 효과가 100% 인 쪽. */
  to: { x: number; y: number };
  /** 마스크를 뒤집는다. */
  inverted?: boolean;
  /** 마스크 이름. 생략하면 Camera Raw 의 기본 이름을 흉내낸다. */
  name?: string;
}

export type LocalMask = LinearGradientMask;

/** 보정 하나. 슬라이더는 **UI 단위 그대로** 받는다. */
export interface LocalCorrection {
  mask: LocalMask;
  name?: string;
  /** 보정 전체의 배율. UI 0–200. **100 이 기본이고 100 을 넘을 수 있다.** */
  amount?: number;

  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  clarity?: number;
  texture?: number;
  dehaze?: number;
  grain?: number;
  glow?: number;
  sharpness?: number;
  luminanceNoise?: number;
  moire?: number;
  defringe?: number;
  temperature?: number;
  tint?: number;
  saturation?: number;
  hue?: number;
}

/**
 * 슬라이더 → `crs:` 키와 나누는 수.
 *
 * **전부 실기에서 쟀다** (ROADMAP §66). 규칙은 "나누는 수 = UI 범위" 이지만
 * 그 규칙으로 채우지 않고 **잰 것만** 넣는다.
 */
const SLIDERS: Record<string, [string, number]> = {
  exposure: ["LocalExposure2012", 4],
  hue: ["LocalHue", 180],
  saturation: ["LocalSaturation", 100],
  sharpness: ["LocalSharpness", 100],
  contrast: ["LocalContrast2012", 100],
  highlights: ["LocalHighlights2012", 100],
  shadows: ["LocalShadows2012", 100],
  whites: ["LocalWhites2012", 100],
  blacks: ["LocalBlacks2012", 100],
  clarity: ["LocalClarity2012", 100],
  dehaze: ["LocalDehaze", 100],
  luminanceNoise: ["LocalLuminanceNoise", 100],
  moire: ["LocalMoire", 100],
  defringe: ["LocalDefringe", 100],
  temperature: ["LocalTemperature", 100],
  tint: ["LocalTint", 100],
  texture: ["LocalTexture", 100],
  grain: ["LocalGrain", 100],
  glow: ["LocalGlow", 100],
};

/** 값을 안 받고 고정으로 나가는 자리. 대응 UI 를 모르거나 죽은 키다. */
const FIXED: Record<string, string> = {
  LocalExposure: "0",
  LocalContrast: "0",
  LocalClarity: "0",
  LocalBrightness: "0",
  LocalToningHue: "0",
  LocalToningSaturation: "0",
  LocalCorrectedDepth: "0",
  LocalCurveRefineSaturation: "100",
};

/**
 * 내보내는 순서. **샘플의 순서 그대로다.**
 *
 * 순서가 중요한지는 모른다. 중요하지 않다면 손해가 없고, 중요하다면 이것이
 * 맞다 — 그래서 샘플을 따른다.
 */
const BASE_ORDER: readonly string[] = [
  "LocalExposure",
  "hue",
  "saturation",
  "LocalContrast",
  "LocalClarity",
  "sharpness",
  "LocalBrightness",
  "LocalToningHue",
  "LocalToningSaturation",
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "clarity",
  "dehaze",
  "luminanceNoise",
  "moire",
  "defringe",
  "temperature",
  "tint",
  "texture",
  "grain",
  "LocalCorrectedDepth",
  "glow",
  "LocalCurveRefineSaturation",
];

/**
 * 숫자를 XMP 속성 문자열로 만든다.
 *
 * 나눗셈이 `0.30000000000000004` 같은 것을 만들지 않게 6자리에서 반올림하고
 * 뒤 0 을 떼어낸다. 샘플이 `0.09` · `0.5` · `0.480487` 처럼 다듬어진 모양이다.
 */
export function formatXmpNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`XMP 에 넣을 수 없는 값입니다: ${String(value)}`);
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** XML 속성값 이스케이프. **이름은 호출자가 주므로 반드시 거친다.** */
export function escapeXml(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

/** 32자리 대문자 16진수. 샘플의 `CorrectionSyncID` 모양이다. */
export function randomSyncId(random: () => number = Math.random): string {
  let out = "";
  for (let index = 0; index < 32; index += 1) {
    out += Math.floor(random() * 16)
      .toString(16)
      .toUpperCase();
  }
  return out;
}

const HEADER =
  '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, ' +
  '0000/00/00-00:00:00        ">\n' +
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
  '  <rdf:Description rdf:about=""\n' +
  '    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">\n' +
  "   <crs:MaskGroupBasedCorrections>\n" +
  "    <rdf:Seq>\n";

const FOOTER =
  "    </rdf:Seq>\n" +
  "   </crs:MaskGroupBasedCorrections>\n" +
  "  </rdf:Description>\n" +
  " </rdf:RDF>\n" +
  "</x:xmpmeta>\n";

function maskXml(mask: LocalMask, index: number, syncId: string): string {
  const name = mask.name ?? `선형 그레이디언트 ${String(index + 1)}`;
  return [
    "        <rdf:li",
    '         crs:What="Mask/Gradient"',
    '         crs:MaskActive="true"',
    `         crs:MaskName="${escapeXml(name)}"`,
    /* 0 은 '더하기' 다. 빼기·교차의 값은 아직 모른다 (ROADMAP §66). */
    '         crs:MaskBlendMode="0"',
    `         crs:MaskInverted="${mask.inverted === true ? "true" : "false"}"`,
    `         crs:MaskSyncID="${syncId}"`,
    '         crs:MaskValue="1"',
    `         crs:ZeroX="${formatXmpNumber(mask.from.x)}"`,
    `         crs:ZeroY="${formatXmpNumber(mask.from.y)}"`,
    `         crs:FullX="${formatXmpNumber(mask.to.x)}"`,
    `         crs:FullY="${formatXmpNumber(mask.to.y)}"/>`,
  ].join("\n");
}

function correctionXml(correction: LocalCorrection, index: number, newId: () => string): string {
  const amount = (correction.amount ?? 100) / 100;
  const name = correction.name ?? `마스크 ${String(index + 1)}`;

  const attributes: string[] = [
    '       crs:What="Correction"',
    `       crs:CorrectionAmount="${formatXmpNumber(amount)}"`,
    '       crs:CorrectionActive="true"',
    `       crs:CorrectionName="${escapeXml(name)}"`,
    `       crs:CorrectionSyncID="${newId()}"`,
  ];

  for (const slot of BASE_ORDER) {
    const fixed = FIXED[slot];
    if (fixed !== undefined) {
      attributes.push(`       crs:${slot}="${fixed}"`);
      continue;
    }
    const entry = SLIDERS[slot];
    /* 표에 없는 이름이 BASE_ORDER 에 들어가면 조용히 빠진다 — 막는다. */
    if (entry === undefined) {
      throw new Error(`XMP 조립표에 없는 항목입니다: ${slot}`);
    }
    const [key, divisor] = entry;
    const raw = (correction as unknown as Record<string, unknown>)[slot];
    const value = typeof raw === "number" ? raw / divisor : 0;
    attributes.push(`       crs:${key}="${formatXmpNumber(value)}"`);
  }

  return [
    "     <rdf:li>",
    "      <rdf:Description",
    `${attributes.join("\n")}>`,
    "      <crs:CorrectionMasks>",
    "       <rdf:Seq>",
    maskXml(correction.mask, index, newId()),
    "       </rdf:Seq>",
    "      </crs:CorrectionMasks>",
    "      </rdf:Description>",
    "     </rdf:li>",
  ].join("\n");
}

/**
 * 보정 목록을 `$LCs` 에 넣을 XMP 문자열로 만든다.
 *
 * **기존 것과 합치지 않고 통째로 만든다.** `$LCs` 는 덩어리 하나이고, Camera
 * Raw 의 "한 번에 담아라"(§17.17)와 같은 자리다 — 나눠 부르면 앞의 보정이
 * 사라진다. 그 사실은 Tool 설명이 말한다.
 *
 * `newId` 를 주입받는 것은 테스트 때문이다. 무작위를 박아 두면 산출물을
 * 고정할 수 없다.
 */
export function buildLocalCorrectionsXmp(
  corrections: readonly LocalCorrection[],
  newId: () => string = (): string => randomSyncId(),
): string {
  if (corrections.length === 0) {
    throw new Error("보정이 하나도 없습니다.");
  }
  const body = corrections
    .map((correction, index) => correctionXml(correction, index, newId))
    .join("\n");
  return `${HEADER}${body}\n${FOOTER}`;
}
