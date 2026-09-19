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
 * 옮겼다. 규칙성을 가정하면 안 된다 — `saturation` 만 `$` 가 없다.
 *
 * ## 버전 키는 넣지 않는다
 *
 * 잡힌 descriptor 에는 `$CrVe`·`$PrVN`·`$PrVe` 가 있지만 **빼도 동작한다.**
 * 실기에서 확인했다. 박아 넣으면 다른 Camera Raw 버전에서 깨진다.
 */

export interface CameraRawParams {
  layerId?: number;
  [key: string]: number | undefined;
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
 * `$Ex12` 는 실수여야 한다. 정수면 조용히 무시된다.
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
export function buildCameraRawDescriptor(params: CameraRawParams): {
  descriptor: Record<string, unknown>;
  applied: string[];
} {
  const descriptor: Record<string, unknown> = { _obj: "Adobe Camera Raw Filter" };
  const applied: string[] = [];

  for (const [name, key] of Object.entries(KEYS)) {
    const value = params[name];
    if (value === undefined) {
      continue;
    }
    descriptor[key] = name === "exposure" ? asDouble(value) : value;
    applied.push(name);
  }

  // 색온도·색조를 주면 화이트밸런스가 '사용자 정의' 여야 한다.
  // Camera Raw 가 직접 낸 descriptor 에 이 항목이 함께 있었다.
  if (params["temperature"] !== undefined || params["tint"] !== undefined) {
    descriptor["$WBal"] = { _enum: "$WBal", _value: "customEnum" };
  }

  return { descriptor, applied };
}
