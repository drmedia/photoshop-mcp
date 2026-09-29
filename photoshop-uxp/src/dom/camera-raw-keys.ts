/**
 * Camera Raw descriptor 조립. (ROADMAP §17.17)
 *
 * **`photoshop` 을 import 하지 않는다.** 순수 로직을 떼어 두어야 단위 테스트가
 * 실기 없이 이 규칙들을 고정할 수 있다. (`active-order.ts` · `mutation-result.ts`
 * 와 같은 이유다)
 *
 * ## 키는 잡아낸 것이지 짐작한 것이 아니다
 *
 * `action.addNotificationListener(["all"])` 를 걸어 두고 사람이 Camera Raw 를 한 번
 * 돌리면, 움직인 슬라이더가 **한 descriptor 에 모여** 알림으로 온다. 그것을 그대로
 * 옮겼다. 규칙성을 가정하면 안 된다 — **`$` 가 없는 것이 셋** 있다
 * (`saturation` · `curve` · `sharpen`).
 *
 * ## 버전 키는 넣지 않는다
 *
 * 잡힌 descriptor 에는 `$CrVe`·`$PrVN`·`$PrVe` 가 있지만 **빼도 동작한다.**
 * 실기에서 확인했다. 박아 넣으면 다른 Camera Raw 버전에서 깨진다.
 */

/** 포인트 곡선의 한 점. 0–255. */
export interface CurvePoint {
  x: number;
  y: number;
}

export interface CameraRawParams {
  layerId?: number;
  [key: string]: number | CurvePoint[] | undefined;
}

/** MCP 이름 → Camera Raw descriptor 키. 실기에서 잡아낸 그대로다. */
const KEYS: Record<string, string> = {
  exposure: "$Ex12",
  temperature: "$Temp",
  tint: "$Tint",
  contrast: "$Cr12",
  highlights: "$Hi12",
  shadows: "$Sh12",
  whites: "$Wh12",
  blacks: "$Bk12",
  texture: "$CrTx",
  clarity: "$Cl12",
  dehaze: "$Dhze",
  vibrance: "$Vibr",
  // **`$` 가 없다.** 규칙성을 가정하면 이 하나가 조용히 빠진다.
  saturation: "saturation",

  // ── 세부: 샤픈. (ROADMAP §64) ──
  //
  // **`sharpen` 에 `$` 가 없다** — `saturation` · `curve` 에 이은 세 번째
  // 예외다. `$Shpn` 같은 것을 짐작했으면 조용히 무시당했다.
  sharpenAmount: "sharpen",
  sharpenRadius: "$ShpR",
  sharpenDetail: "$ShpD",
  sharpenMasking: "$ShpM",

  noiseReduction: "$LNR",
  noiseDetail: "$LNRD",
  noiseContrast: "$LNRC",
  colorNoiseReduction: "$CNR",
  colorNoiseDetail: "$CNRD",
  colorNoiseSmoothness: "$CNRS",

  grainAmount: "$GRNA",
  grainSize: "$GRNS",
  grainRoughness: "$GRNF",
  vignetteAmount: "$PCVA",
  vignetteMidpoint: "$PCVM",
  vignetteFeather: "$PCVF",
  vignetteRoundness: "$PCVR",

  // ── 곡선: 파라메트릭. (ROADMAP §17.30) ──
  //
  // 접미사가 UI 이름 그대로다 — H 밝은 영역 · L 밝음 · D 어두움 · S 어두운 영역.
  curveHighlights: "$PC_H",
  curveLights: "$PC_L",
  curveDarks: "$PC_D",
  curveShadows: "$PC_S",

  // 범위 분할. 기본값 25 · 50 · 75 로 잡혔다.
  curveShadowSplit: "$PC_1",
  curveMidtoneSplit: "$PC_2",
  curveHighlightSplit: "$PC_3",

  // RGB 포인트 곡선 탭의 **채도 미세 조정**. 기본 100.
  //
  // descriptor 에 `$crfs: 100` 으로 잡혀 있었지만 처음에는 뜻을 몰라 빼 두었다.
  // 패널 캡처로 확인하고 넣었다 — **모르는 키를 그럴듯한 이름으로 노출하지 않는다.**
  curveRefineSaturation: "$crfs",

  // ── 색상 혼합 (HSL). (ROADMAP §17.29) ──
  // 접미사가 R·O·Y·G·A·B·P·M 로 UI 순서와 같다. 그래도 **잡아낸 그대로** 적는다 —
  // `saturation` 이 규칙을 깬 전례가 있다.
  // 값은 **정수**로 간다. `$Ex12` 와 달리 실수로 밀 필요가 없다(실기 확인).
  hueRed: "$HA_R",
  hueOrange: "$HA_O",
  hueYellow: "$HA_Y",
  hueGreen: "$HA_G",
  hueAqua: "$HA_A",
  hueBlue: "$HA_B",
  huePurple: "$HA_P",
  hueMagenta: "$HA_M",

  saturationRed: "$SA_R",
  saturationOrange: "$SA_O",
  saturationYellow: "$SA_Y",
  saturationGreen: "$SA_G",
  saturationAqua: "$SA_A",
  saturationBlue: "$SA_B",
  saturationPurple: "$SA_P",
  saturationMagenta: "$SA_M",

  luminanceRed: "$LA_R",
  luminanceOrange: "$LA_O",
  luminanceYellow: "$LA_Y",
  luminanceGreen: "$LA_G",
  luminanceAqua: "$LA_A",
  luminanceBlue: "$LA_B",
  luminancePurple: "$LA_P",
  luminanceMagenta: "$LA_M",
};

/**
 * 포인트 곡선. **배열이라 숫자 키와 다루는 법이 다르다.** (ROADMAP §17.30)
 *
 * **`curve` 에는 `$` 가 없다.** `saturation` 에 이은 두 번째 예외다 —
 * 규칙성을 가정하면 이것 하나가 조용히 빠진다.
 */
const CURVE_KEYS: Record<string, string> = {
  curveRgb: "curve",
  curveRed: "$CrvR",
  curveGreen: "$CrvG",
  curveBlue: "$CrvB",
};

/**
 * 점 목록을 Camera Raw 가 쓰는 평탄 배열로 바꾼다.
 *
 * `[{x:0,y:0},{x:255,y:255}]` → `[0, 0, 255, 255]`
 *
 * 호출자에게 평탄 배열을 직접 받지 않는 것은 **홀수 길이가 조용히 통과**하기
 * 때문이다. 점으로 받으면 그 상태가 만들어지지 않는다.
 */
export function flattenCurve(points: readonly CurvePoint[]): number[] {
  return points.flatMap((point) => [point.x, point.y]);
}

/**
 * 실수로 만든다. `$Ex12` 는 정수면 조용히 무시된다.
 *
 * 순수 함수로 떼어 둔 것은 테스트 때문이다. 실기 없이도 이 규칙은 고정할 수 있다.
 */
export function asDouble(value: number): number {
  return Number.isInteger(value) ? value + 0.0001 : value;
}

/**
 * 검증된 파라미터로 descriptor 를 조립한다.
 *
 * 호출자가 descriptor 를 넘기는 통로를 만들지 않는다. (ARCHITECTURE §23)
 */
/**
 * 실수로 보내야 하는 것들.
 *
 * `exposure` 는 정수가 조용히 무시되는 것을 실기에서 확인했다. `sharpenRadius`
 * 는 Camera Raw 가 낸 descriptor 에 `2.4` 로 실려 있었고 UI 범위가 0.5–3.0 이라
 * **정수도 유효한 값**이다 — 그래서 같은 취급으로 둔다. 정수가 무시되는지는
 * 확인하지 않았고, 확인 전까지 안전한 쪽을 고른다. (ROADMAP §64)
 */
const DOUBLE_KEYS = new Set(["exposure", "sharpenRadius"]);

export function buildCameraRawDescriptor(params: CameraRawParams): {
  descriptor: Record<string, unknown>;
  applied: string[];
} {
  const descriptor: Record<string, unknown> = { _obj: "Adobe Camera Raw Filter" };
  const applied: string[] = [];

  for (const [name, key] of Object.entries(KEYS)) {
    const value = params[name];
    if (typeof value !== "number") {
      continue;
    }
    descriptor[key] = DOUBLE_KEYS.has(name) ? asDouble(value) : value;
    applied.push(name);
  }

  for (const [name, key] of Object.entries(CURVE_KEYS)) {
    const value = params[name];
    if (!Array.isArray(value)) {
      continue;
    }
    descriptor[key] = flattenCurve(value);
    applied.push(name);
  }

  // **파라메트릭 곡선은 구간 경계가 함께 있어야 적용된다.** (ROADMAP §17.30)
  //
  // 경계 없이 `$PC_H` 만 보내면 `ok` 를 돌려주면서 **아무 일도 하지 않는다** —
  // `$Ex12` 에 정수를 보낸 것과 같은 종류의 조용한 실패다. 실기에서 잡았다.
  //
  // Camera Raw 가 낸 descriptor 에는 언제나 셋이 함께 있었다. 기본값 25·50·75 를
  // 채워 넣는다. 호출자가 준 값이 있으면 그것을 쓴다.
  const PARAMETRIC = ["curveHighlights", "curveLights", "curveDarks", "curveShadows"];
  if (PARAMETRIC.some((name) => typeof params[name] === "number")) {
    const splits: [string, string, number][] = [
      ["curveShadowSplit", "$PC_1", 25],
      ["curveMidtoneSplit", "$PC_2", 50],
      ["curveHighlightSplit", "$PC_3", 75],
    ];
    for (const [name, key, fallback] of splits) {
      if (typeof params[name] !== "number") {
        descriptor[key] = fallback;
      }
    }
  }

  // 색온도·색조를 주면 화이트밸런스가 '사용자 정의' 여야 한다.
  // Camera Raw 가 직접 낸 descriptor 에 이 항목이 함께 있었다.
  if (params["temperature"] !== undefined || params["tint"] !== undefined) {
    descriptor["$WBal"] = { _enum: "$WBal", _value: "customEnum" };
  }

  return { descriptor, applied };
}
