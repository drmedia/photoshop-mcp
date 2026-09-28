import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { makeAdjustmentLayer } from "./adjustment.js";

/**
 * 조정 레이어 넷 — 노출 · 흑백 · 포토 필터 · 채널 혼합. (ROADMAP §52)
 *
 * ## descriptor 는 전부 잡아서 확인했다
 *
 * Adobe Document 레퍼런스가 **조정 레이어를 만드는 메서드가 없다고 명시한다** —
 * `createLayer` · `createPixelLayer` · `createTextLayer` · `createLayerGroup` 뿐이다.
 * 그래서 batchPlay 이고, 이름은 문서가 아니라 `["all"]` 알림으로 잡았다(§17.17).
 *
 * **체크박스와 드롭다운은 슬라이더와 따로 잡아야 했다.** 처음에는 슬라이더만
 * 움직여서 셋을 놓쳤고, 그것들이 하필 **이름을 틀리기 쉬운 것들**이었다.
 *
 * ```text
 * blackAndWhite   useTint        ← tint 가 아니다
 * channelMixer    monochromatic  ← monochrome 이 아니다
 * photoFilter     color 가 프리셋 이름이 아니라 labColor 다
 * ```
 *
 * ## 단위가 종류마다 다르다
 *
 * **채널 혼합만 `percentUnit` 로 감싼다.** 노출과 흑백은 맨숫자다. 하나로
 * 맞춰 두면 조용히 무시되는 쪽이 생긴다 — Camera Raw 의 `$Ex12` 가 정수를
 * 받고 아무 일도 안 했던 것과 같은 자리다(§17.17).
 *
 * ## 녹색은 `grain` 이다
 *
 * 이 저장소에서 세 번째다(`channelReference` · `RGBColor` · 여기). 우리 API 는
 * `green` 으로 받고 **경계에서 바꾼다** — 호출자가 Photoshop 의 버릇을 알
 * 이유가 없다.
 */

/** 퍼센트 값. 채널 혼합만 이 형태를 쓴다. */
const percent = (value: number): Record<string, unknown> => ({
  _unit: "percentUnit",
  _value: value,
});

/** 주어진 것만 담는다. 안 준 것을 기본값으로 채우면 사용자가 패널에서 맞춰 둔 값을 덮는다. */
function put(
  into: Record<string, unknown>,
  key: string,
  value: unknown,
  wrap?: (n: number) => unknown,
): void {
  if (value === undefined) {
    return;
  }
  into[key] = wrap !== undefined && typeof value === "number" ? wrap(value) : value;
}

/**
 * 노출 조정 레이어.
 *
 * 잡힌 것: `{_obj:"exposure", exposure:-0.5, offset:0.0667, gammaCorrection:0.77}`.
 * **셋 다 맨실수**이고 `gammaCorrection` 은 이름이 길다 — `gamma` 가 아니다.
 */
export async function adjustmentExposure(params: {
  exposure?: number;
  offset?: number;
  gammaCorrection?: number;
  name?: string;
}): Promise<LayerInfo> {
  const type: Record<string, unknown> = { _obj: "exposure" };
  put(type, "exposure", params.exposure);
  put(type, "offset", params.offset);
  put(type, "gammaCorrection", params.gammaCorrection);
  return makeAdjustmentLayer("Exposure adjustment", type, params.name);
}

/**
 * 흑백 조정 레이어.
 *
 * 잡힌 것: `{_obj:"blackAndWhite", red:56, yellow:104, grain:42, cyan:92,
 * blue:17, magenta:104}` 와 `{useTint:true}`.
 *
 * **`tintColor` 는 잡히지 않았다.** 체크박스만 토글해서 색은 안 나왔다.
 * 잡지 못한 키를 짐작해 넣지 않는다 — `useTint` 만 켜면 Photoshop 기본 색조가
 * 걸린다.
 */
export async function adjustmentBlackWhite(params: {
  red?: number;
  yellow?: number;
  green?: number;
  cyan?: number;
  blue?: number;
  magenta?: number;
  useTint?: boolean;
  name?: string;
}): Promise<LayerInfo> {
  const type: Record<string, unknown> = { _obj: "blackAndWhite" };
  put(type, "red", params.red);
  put(type, "yellow", params.yellow);
  /* 녹색이 `grain` 이다. */
  put(type, "grain", params.green);
  put(type, "cyan", params.cyan);
  put(type, "blue", params.blue);
  put(type, "magenta", params.magenta);
  put(type, "useTint", params.useTint);
  return makeAdjustmentLayer("Black & White adjustment", type, params.name);
}

/**
 * 포토 필터 조정 레이어.
 *
 * 잡힌 것: `{_obj:"photoFilter", color:{_obj:"labColor", luminance:48.24,
 * a:48, b:-122}, preserveLuminosity:true, density:51}`.
 *
 * **패널의 필터 드롭다운은 프리셋 이름이 아니라 Lab 색으로 나간다.** "Warming
 * Filter (85)" 같은 이름을 넘기는 통로가 descriptor 에 없었다 — 이름으로 받는
 * 스키마를 만들었으면 조용히 무시됐을 것이다.
 */
export async function adjustmentPhotoFilter(params: {
  color?: { luminance: number; a: number; b: number };
  density?: number;
  preserveLuminosity?: boolean;
  name?: string;
}): Promise<LayerInfo> {
  const type: Record<string, unknown> = { _obj: "photoFilter" };
  if (params.color !== undefined) {
    type["color"] = {
      _obj: "labColor",
      luminance: params.color.luminance,
      a: params.color.a,
      b: params.color.b,
    };
  }
  put(type, "density", params.density);
  put(type, "preserveLuminosity", params.preserveLuminosity);
  return makeAdjustmentLayer("Photo Filter adjustment", type, params.name);
}

export interface ChannelMix {
  red?: number;
  green?: number;
  blue?: number;
  constant?: number;
}

/** 출력 채널 하나의 행렬. 값은 전부 퍼센트다. */
function channelMatrix(mix: ChannelMix): Record<string, unknown> {
  const out: Record<string, unknown> = { _obj: "channelMatrix" };
  put(out, "red", mix.red, percent);
  /* 여기서도 녹색이 `grain` 이다. */
  put(out, "grain", mix.green, percent);
  put(out, "blue", mix.blue, percent);
  put(out, "constant", mix.constant, percent);
  return out;
}

/**
 * 채널 혼합 조정 레이어.
 *
 * 잡힌 것(컬러):
 * `{_obj:"channelMixer", red:{_obj:"channelMatrix", red:%42, grain:%18,
 * blue:%-38, constant:%33}, grain:{...}, blue:{...}}`
 *
 * 잡힌 것(단색):
 * `{_obj:"channelMixer", monochromatic:true, gray:{_obj:"channelMatrix",
 * red:%40, grain:%40, blue:%20, constant:%0}}`
 *
 * **`monochrome` 이 아니라 `monochromatic` 이고 `gray` 와 짝이다.**
 *
 * ## 두 모드를 섞어 부르면 거절한다
 *
 * 단색일 때 `red`·`green`·`blue` 출력을 함께 주면 Photoshop 은 **오류 없이**
 * 한쪽만 쓴다. 호출자는 준 값이 다 들어간 줄 안다 — 이 저장소가 반복해서
 * 겪은 "조용한 실패" 라 미리 가른다.
 *
 * ## 안 준 출력 채널을 항등으로 채운다
 *
 * 실기에서 `red` 만 주고 걸었더니 **녹색과 파랑 출력이 0 이 됐다** —
 * R180 G100 B60 이 R100 G0 B0 으로 갔다. Photoshop 은 descriptor 에 없는
 * 출력 채널을 항등이 아니라 **전부 0** 으로 둔다. 그대로 두면 "빨강만
 * 만졌는데 사진이 빨강 단색이 되는" 조용한 사고다.
 *
 * 채울 값은 `make` descriptor 에서 읽은 기본값이다 — `red:{red:100}` ·
 * `grain:{grain:100}` · `blue:{blue:100}`.
 *
 * **채널 안의 항은 채우지 않는다.** `red: {green: 100}` 은 "빨강 출력은
 * 녹색 입력만 쓴다" 로 읽는 것이 자연스럽다.
 */
export async function adjustmentChannelMixer(params: {
  monochrome?: boolean;
  red?: ChannelMix;
  green?: ChannelMix;
  blue?: ChannelMix;
  gray?: ChannelMix;
  name?: string;
}): Promise<LayerInfo> {
  const mono = params.monochrome === true;
  const hasColor =
    params.red !== undefined || params.green !== undefined || params.blue !== undefined;

  if (mono && hasColor) {
    throw new DispatchError(
      "INVALID_PARAMETER",
      "monochrome 일 때는 gray 만 줍니다. red · green · blue 는 쓰이지 않습니다.",
      { recoverable: true },
    );
  }
  if (!mono && params.gray !== undefined) {
    throw new DispatchError("INVALID_PARAMETER", "gray 는 monochrome: true 일 때만 쓰입니다.", {
      recoverable: true,
    });
  }

  const type: Record<string, unknown> = { _obj: "channelMixer" };
  put(type, "monochromatic", params.monochrome);

  if (mono) {
    type["gray"] = channelMatrix(params.gray ?? {});
    return makeAdjustmentLayer("Channel Mixer adjustment", type, params.name);
  }

  /* **안 준 출력 채널을 항등으로 채운다.**
   *
   * 실기에서 `red` 만 주고 걸었더니 **녹색과 파랑 출력이 0 이 됐다** —
   * R180 G100 B60 이 R100 G0 B0 으로 갔다. Photoshop 은 descriptor 에 없는
   * 출력 채널을 항등이 아니라 **전부 0** 으로 둔다.
   *
   * 그대로 두면 "빨강만 만졌는데 사진이 빨강 단색이 되는" 조용한 사고다.
   * `make` 의 기본이 항등행렬이라는 것은 캡처한 descriptor 에 있었다 —
   * 그것에 맞춘다. */
  type["red"] = channelMatrix(params.red ?? { red: 100 });
  /* 출력 채널 이름도 `grain` 이다. */
  type["grain"] = channelMatrix(params.green ?? { green: 100 });
  type["blue"] = channelMatrix(params.blue ?? { blue: 100 });
  return makeAdjustmentLayer("Channel Mixer adjustment", type, params.name);
}
