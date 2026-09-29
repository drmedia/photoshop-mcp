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

/**
 * 방사형 그레이디언트 마스크. (ROADMAP §68)
 *
 * **중심과 반지름이 아니라 경계 상자다.** `mask.gradient` 의 `radial` 과
 * 모양이 다르므로 그쪽 인터페이스를 그대로 쓸 수 없다. 좌표는 0–1
 * 정규화이고 **음수일 수 있다** — 실기에서 `Top` 이 −0.0247 이었다.
 */
export interface RadialGradientMask {
  type: "radialGradient";
  /** 타원의 경계 상자. */
  bounds: { top: number; left: number; bottom: number; right: number };
  /** 타원의 회전. 도 단위 원시값. */
  angle?: number;
  /** 가장자리 부드러움. 0–100 원시값. 실기에서 UI 83 → `Feather="83"`. */
  feather?: number;
  /** 모서리 둥글기. 0–100 원시값. */
  roundness?: number;
  inverted?: boolean;
  name?: string;
}

export type LocalMask = LinearGradientMask | RadialGradientMask;

/**
 * 바탕 마스크와 합치는 마스크. (ROADMAP §73 · §74)
 *
 * **`intersect`(교차)는 없다.** 실기에서 빼기와 합집합만 쟀다.
 *
 * §74 에서 `(0,1)` 을 교차로 고쳤다가 **다시 틀린 것이 드러났다.** 그때는
 * 캡처 한 장을 눈으로 읽고 정했는데, 재서 보니 합집합이었다 — 바탕 마스크
 * 밖의 타원 안쪽이 그대로 밝아졌고 겹치는 곳은 더 밝아지지 않았다
 * (겹침 210.88 = 바탕만 210.88).
 *
 * **교차의 부호화는 아직 모른다.** Camera Raw UI 에는 있지만 잡은 캡처의
 * 교차 마스크도 `(0,1)` 로 보였다 — 어딘가 다른 곳에 있다는 뜻이다.
 * 짐작으로 열지 않는다.
 */
export interface MaskCombine {
  mode: "subtract" | "add";
  mask: LocalMask;
}

/**
 * 색 보정 한 구간. (ROADMAP §69)
 *
 * **UI 값 그대로 받는다.** 슬라이더와 달리 **정규화하지 않으므로** 나누지
 * 않고 그대로 나간다 — `Local` 로 시작한다고 다 ±1 이 아니다(§66).
 */
export interface ColorGradeZone {
  /** 색상 휠의 각도. **0–359 한 바퀴이고 음수로 접히지 않는다.** */
  hue?: number;
  /** 색상 휠의 채도. 0–100. */
  saturation?: number;
  /** 광도. ±100. */
  luminance?: number;
}

/**
 * 색 보정. (ROADMAP §69)
 *
 * 네 구간(어두운·중간·밝은·전체)과 공통 둘(혼합·균형)이다. **혼합·균형은
 * 탭마다가 아니라 하나씩**이다 — UI 에는 네 탭에 모두 보이지만 값이 같다.
 *
 * **하나라도 주면 열넷이 전부 나간다.** Camera Raw 가 그렇게 낸다 — 안 쓰면
 * 키가 아예 없고, 쓰면 전부 있다. 캡처 둘을 견주어 확인했다.
 */
export interface ColorGrade {
  shadows?: ColorGradeZone;
  midtones?: ColorGradeZone;
  highlights?: ColorGradeZone;
  global?: ColorGradeZone;
  /** 구간이 섞이는 정도. 0–100. **생략하면 50** — Camera Raw UI 의 기본값이다. */
  blending?: number;
  /** 어두운 쪽과 밝은 쪽의 무게. ±100. 생략하면 0. */
  balance?: number;
}

/** 보정 하나. 슬라이더는 **UI 단위 그대로** 받는다. */
export interface LocalCorrection {
  /** 바탕 마스크. */
  mask: LocalMask;
  /** 바탕과 합치는 마스크들. */
  combine?: readonly MaskCombine[];
  name?: string;
  /** 색 보정. 주면 열넷이 전부 나간다. */
  colorGrade?: ColorGrade;
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

function linearXml(
  mask: LinearGradientMask,
  index: number,
  syncId: string,
  blend: MaskBlend,
): string {
  const name = mask.name ?? `선형 그레이디언트 ${String(index + 1)}`;
  return [
    "        <rdf:li",
    '         crs:What="Mask/Gradient"',
    '         crs:MaskActive="true"',
    `         crs:MaskName="${escapeXml(name)}"`,
    /* 0 은 '더하기' 다. 빼기는 1 이고 교차는 아직 모른다 (ROADMAP §74). */
    `         crs:MaskBlendMode="${blend.blendMode}"`,
    `         crs:MaskInverted="${mask.inverted === true ? "true" : "false"}"`,
    `         crs:MaskSyncID="${syncId}"`,
    `         crs:MaskValue="${blend.maskValue}"`,
    `         crs:ZeroX="${formatXmpNumber(mask.from.x)}"`,
    `         crs:ZeroY="${formatXmpNumber(mask.from.y)}"`,
    `         crs:FullX="${formatXmpNumber(mask.to.x)}"`,
    `         crs:FullY="${formatXmpNumber(mask.to.y)}"/>`,
  ].join("\n");
}

/**
 * 방사형.
 *
 * **`Flipped` 와 `MaskInverted` 가 둘 다 있다.** 어느 쪽이 UI 의 '반전' 인지
 * 데이터만으로는 갈리지 않아 **픽셀로 재서 정했다** (ROADMAP §68).
 *
 * `Version="2"` 는 실기 캡처에 있던 것이다. 필수인지는 모르지만 빼서 얻는
 * 것이 없다.
 */
function radialXml(
  mask: RadialGradientMask,
  index: number,
  syncId: string,
  blend: MaskBlend,
): string {
  const name = mask.name ?? `방사형 그레이디언트 ${String(index + 1)}`;
  return [
    "        <rdf:li",
    '         crs:What="Mask/CircularGradient"',
    '         crs:MaskActive="true"',
    `         crs:MaskName="${escapeXml(name)}"`,
    `         crs:MaskBlendMode="${blend.blendMode}"`,
    `         crs:MaskInverted="${mask.inverted === true ? "true" : "false"}"`,
    `         crs:MaskSyncID="${syncId}"`,
    `         crs:MaskValue="${blend.maskValue}"`,
    `         crs:Top="${formatXmpNumber(mask.bounds.top)}"`,
    `         crs:Left="${formatXmpNumber(mask.bounds.left)}"`,
    `         crs:Bottom="${formatXmpNumber(mask.bounds.bottom)}"`,
    `         crs:Right="${formatXmpNumber(mask.bounds.right)}"`,
    `         crs:Angle="${formatXmpNumber(mask.angle ?? 0)}"`,
    '         crs:Midpoint="50"',
    `         crs:Roundness="${formatXmpNumber(mask.roundness ?? 0)}"`,
    `         crs:Feather="${formatXmpNumber(mask.feather ?? 50)}"`,
    '         crs:Flipped="false"',
    '         crs:Version="2"/>',
  ].join("\n");
}

/**
 * 마스크가 바탕인지 빼는 것인지. (ROADMAP §73 · §74)
 *
 * **둘이 함께 바뀐다.** 실기에서 `빼기` 를 걸었더니 `MaskBlendMode` 가
 * `0 → 1` 로 가면서 `MaskValue` 도 `1 → 0` 으로 갔다. **어느 쪽이 일을 하는지,
 * 둘 다 필요한지는 모른다** — 한 점뿐이라 Photoshop 이 낸 짝을 그대로 쓴다.
 */
interface MaskBlend {
  blendMode: string;
  maskValue: string;
}

const BASE_BLEND: MaskBlend = { blendMode: "0", maskValue: "1" };
const SUBTRACT_BLEND: MaskBlend = { blendMode: "1", maskValue: "0" };
/* **바탕과 같은 짝이 합집합이다.** 픽셀로 쟀다 (ROADMAP §74). */
const ADD_BLEND: MaskBlend = { blendMode: "0", maskValue: "1" };

function maskXml(mask: LocalMask, index: number, syncId: string, blend: MaskBlend): string {
  return mask.type === "radialGradient"
    ? radialXml(mask, index, syncId, blend)
    : linearXml(mask, index, syncId, blend);
}

/**
 * 색 보정 값의 직렬화. **부호를 붙인다.**
 *
 * 실기 캡처가 `"+27"` · `"+53"` 이었다. UI 는 혼합을 부호 없이 `53` 으로
 * 보여 주므로 **UI 를 따라가는 것이 아니라 직렬화 규칙**이다.
 * 음수는 재 보지 않았다 — `"-24"` 로 나가는 것이 자연스럽지만 확인은 아니다.
 */
export function formatColorGrade(value: number): string {
  const rounded = Math.round(value);
  return rounded >= 0 ? `+${String(rounded)}` : String(rounded);
}

/**
 * 색 보정 열넷. **순서는 샘플 그대로다** — UI 순서와 전혀 다르고
 * `Balance` 가 다섯 번째에 끼어 있다. 중요한지는 모르지만 따르는 쪽이 싸다.
 */
function colorGradeAttributes(grade: ColorGrade): string[] {
  const zone = (z: ColorGradeZone | undefined, key: "hue" | "saturation" | "luminance"): number =>
    z?.[key] ?? 0;
  const entries: [string, number][] = [
    ["ShadowHue", zone(grade.shadows, "hue")],
    ["ShadowSat", zone(grade.shadows, "saturation")],
    ["HighlightHue", zone(grade.highlights, "hue")],
    ["HighlightSat", zone(grade.highlights, "saturation")],
    ["Balance", grade.balance ?? 0],
    ["MidtoneHue", zone(grade.midtones, "hue")],
    ["MidtoneSat", zone(grade.midtones, "saturation")],
    ["ShadowLum", zone(grade.shadows, "luminance")],
    ["MidtoneLum", zone(grade.midtones, "luminance")],
    ["HighlightLum", zone(grade.highlights, "luminance")],
    /* **생략하면 50 이다.** Camera Raw UI 의 기본값이고 0 으로 두면 구간이
     * 섞이지 않아 호출자가 의도하지 않은 결과가 된다. 우리가 잰 값은 아니다. */
    ["Blending", grade.blending ?? 50],
    ["GlobalHue", zone(grade.global, "hue")],
    ["GlobalSat", zone(grade.global, "saturation")],
    ["GlobalLum", zone(grade.global, "luminance")],
  ];
  return entries.map(
    ([name, value]) => `       crs:LocalColorGrade${name}="${formatColorGrade(value)}"`,
  );
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

  /* **하나라도 주면 열넷이 전부 나간다.** 안 주면 키가 아예 없다. */
  if (correction.colorGrade !== undefined) {
    attributes.push(...colorGradeAttributes(correction.colorGrade));
  }

  return [
    "     <rdf:li>",
    "      <rdf:Description",
    `${attributes.join("\n")}>`,
    "      <crs:CorrectionMasks>",
    "       <rdf:Seq>",
    maskXml(correction.mask, index, newId(), BASE_BLEND),
    ...(correction.combine ?? []).map((entry) =>
      maskXml(entry.mask, index, newId(), entry.mode === "subtract" ? SUBTRACT_BLEND : ADD_BLEND),
    ),
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
