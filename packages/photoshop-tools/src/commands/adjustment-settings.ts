import { z } from "zod";

/**
 * 조정 레이어 descriptor 를 읽기 쉬운 값으로 옮긴다. (ROADMAP §96)
 *
 * 순수 함수다 — Photoshop 없이 실제로 받은 descriptor 를 픽스처로 시험한다.
 *
 * ## 실기에서 모양을 확인한 두 종류만 옮긴다
 *
 * `curves` 와 `hueSaturation`. 나머지 종류는 `settings: null` 이고 원본(`raw`)만 돌려준다. 모양을
 * 짐작해 채우지 않는다 — `rawBitDepth` · `rawKind` · `rawAdjustmentType` 과 같은 원칙이다.
 *
 * ## 모르는 것은 통째로 `null` 이다
 *
 * 일부만 해석해 돌려주지 않는다. 곡선 채널 하나를 못 읽었는데 나머지만 주면 호출자는 그것이 곡선
 * 전부라고 읽는다.
 *
 * ## 초록 채널의 이름은 `grain` 이다
 *
 * Photoshop 은 곡선의 초록 채널을 `"grain"` 으로 돌려준다(`RGBColor` 의 녹색 키와 같은 함정). 실기에서
 * 확인했다(composite · red · grain · blue). 이 표에 없는 이름은 `channel: null` 이고 `rawChannel` 에
 * 원본을 남긴다 — 예컨대 Lab 이나 CMYK 문서의 채널.
 */

const CurvePointSchema = z.object({
  /** 입력, 0–255. */
  input: z.number(),
  /** 출력, 0–255. */
  output: z.number(),
});

export const CurveChannelNameSchema = z.enum(["composite", "red", "green", "blue"]);

const CurveChannelSchema = z.object({
  /** 알려진 채널이면 이름, 아니면 `null` (그때는 `rawChannel` 을 본다). */
  channel: CurveChannelNameSchema.nullable(),
  /** `channel` 이 `null` 일 때만 값이 있다. Photoshop 이 준 이름 그대로. */
  rawChannel: z.string().nullable(),
  /** 제어점. 입력 오름차순이다. 항등 곡선은 (0,0) (255,255) 두 점이다. */
  points: z.array(CurvePointSchema),
});

export const AdjustmentSettingsSchema = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("curves"),
      /** 채널별 곡선. 한 레이어에 여러 채널이 올 수 있다. */
      channels: z.array(CurveChannelSchema),
    }),
    z.object({
      kind: z.literal("hueSaturation"),
      /** 색상화 모드인가. */
      colorize: z.boolean(),
      /** 색조, −180 ~ 180 (Photoshop UI 값 그대로). */
      hue: z.number(),
      /** 채도, −100 ~ 100. */
      saturation: z.number(),
      /** 명도, −100 ~ 100. */
      lightness: z.number(),
    }),
  ])
  .nullable();

export type AdjustmentSettings = z.infer<typeof AdjustmentSettingsSchema>;

/** descriptor 의 채널 이름 → 우리 표기. `grain` 이 초록이다. */
const CHANNELS: Record<string, "composite" | "red" | "green" | "blue"> = {
  composite: "composite",
  red: "red",
  grain: "green",
  blue: "blue",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCurves(descriptor: Record<string, unknown>): AdjustmentSettings {
  const adjustment = descriptor["adjustment"];
  if (!Array.isArray(adjustment) || adjustment.length === 0) {
    return null;
  }

  const channels: z.infer<typeof CurveChannelSchema>[] = [];
  for (const entry of adjustment) {
    if (!isRecord(entry) || entry["_obj"] !== "curvesAdjustment") {
      return null;
    }
    const channelRef = entry["channel"];
    const channelName = isRecord(channelRef) ? channelRef["_value"] : undefined;
    if (typeof channelName !== "string") {
      return null;
    }
    const curve = entry["curve"];
    if (!Array.isArray(curve)) {
      return null;
    }
    const points: { input: number; output: number }[] = [];
    for (const point of curve) {
      if (
        !isRecord(point) ||
        typeof point["horizontal"] !== "number" ||
        typeof point["vertical"] !== "number"
      ) {
        return null;
      }
      points.push({ input: point["horizontal"], output: point["vertical"] });
    }
    const known = CHANNELS[channelName];
    channels.push(
      known === undefined
        ? { channel: null, rawChannel: channelName, points }
        : { channel: known, rawChannel: null, points },
    );
  }
  return { kind: "curves", channels };
}

function parseHueSaturation(descriptor: Record<string, unknown>): AdjustmentSettings {
  const adjustment = descriptor["adjustment"];
  // 마스터 하나만 해석한다. 색상 범위별 조정이 섞이면 어디가 마스터인지 짐작하지 않는다.
  if (!Array.isArray(adjustment) || adjustment.length !== 1) {
    return null;
  }
  const master = adjustment[0];
  if (!isRecord(master) || master["_obj"] !== "hueSatAdjustmentV2") {
    return null;
  }
  const { hue, saturation, lightness } = master;
  const colorize = descriptor["colorize"];
  if (
    typeof hue !== "number" ||
    typeof saturation !== "number" ||
    typeof lightness !== "number" ||
    typeof colorize !== "boolean"
  ) {
    return null;
  }
  return { kind: "hueSaturation", colorize, hue, saturation, lightness };
}

/**
 * `adjustment` 속성으로 받은 원본을 해석한다. 해석할 수 없으면 `null` 이다.
 *
 * 값은 배열이고 첫 항목의 `_obj` 가 종류다(`adjustment-kind.ts` 와 같은 규칙).
 */
export function parseAdjustmentSettings(raw: unknown): AdjustmentSettings {
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const descriptor = raw[0];
  if (!isRecord(descriptor)) {
    return null;
  }
  switch (descriptor["_obj"]) {
    case "curves":
      return parseCurves(descriptor);
    case "hueSaturation":
      return parseHueSaturation(descriptor);
    default:
      return null;
  }
}
