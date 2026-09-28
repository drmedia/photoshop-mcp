import { app } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { runModal } from "./modal.js";
import { solidColor } from "./text.js";

/**
 * 앱 설정과 색. (ROADMAP §61)
 *
 * ## 전부 DOM 이다
 *
 * `app.preferences`(24.0+) · `app.foregroundColor` · `app.backgroundColor`
 * (둘 다 23.0+) 로 된다. batchPlay 를 쓰지 않는다.
 *
 * ## 환경 설정은 속성 이름을 짐작하지 않는다
 *
 * `Preferences` 는 열두 개 하위 객체(`general` · `unitsAndRulers` · `type` …)
 * 이고 **그 안쪽 속성은 레퍼런스 페이지에 없다.** 이름을 지어 읽으면 무엇이
 * 빠졌는지도 모른다.
 *
 * 그래서 **반사적으로 읽는다** — 하위 객체의 열거 가능한 키를 훑어 값이
 * 읽히는 것만 담는다. 읽히지 않는 키는 아예 넣지 않는다.
 */

type Bag = Record<string, unknown>;

/** `Preferences` 의 하위 객체 이름. 레퍼런스에 적힌 열둘이다. */
export const PREFERENCE_CATEGORIES = [
  "cursors",
  "fileHandling",
  "general",
  "guidesGridsAndSlices",
  "history",
  "interface",
  "notifications",
  "performance",
  "tools",
  "transparencyAndGamut",
  "type",
  "unitsAndRulers",
] as const;

export type PreferenceCategory = (typeof PREFERENCE_CATEGORIES)[number];

/**
 * 하위 객체 하나를 평평한 값 묶음으로 읽는다.
 *
 * **객체와 함수는 담지 않는다.** 중첩을 그대로 실으면 결과가 커지고, 무엇이
 * 값이고 무엇이 API 인지 호출자가 가릴 수 없다.
 */
function flatten(source: unknown): Record<string, string | number | boolean> | null {
  if (source === null || source === undefined || typeof source !== "object") {
    return null;
  }
  const out: Record<string, string | number | boolean> = {};
  let keys: string[];
  try {
    /* UXP 객체는 프로토타입에 접근자를 두는 경우가 있어 둘 다 본다. */
    const own = Object.keys(source as object);
    const proto = Object.getPrototypeOf(source) as object | null;
    const inherited = proto === null ? [] : Object.getOwnPropertyNames(proto);
    keys = [...new Set([...own, ...inherited])];
  } catch {
    return null;
  }

  for (const key of keys) {
    if (key === "constructor" || key === "typename" || key === "parent") {
      continue;
    }
    try {
      const value = (source as Bag)[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        out[key] = value;
      }
    } catch {
      /* 읽히지 않는 키는 넣지 않는다. 지어내지 않는다. */
    }
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function preferencesGet(params: { category?: PreferenceCategory }): {
  categories: Record<string, Record<string, string | number | boolean> | null>;
} {
  const preferences = (app as unknown as Bag)["preferences"] as Bag | undefined;
  if (preferences === undefined || preferences === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 app.preferences 가 없습니다(24.0 이상이 필요합니다).",
      { recoverable: false },
    );
  }

  const wanted =
    params.category === undefined ? PREFERENCE_CATEGORIES : ([params.category] as const);
  const categories: Record<string, Record<string, string | number | boolean> | null> = {};
  for (const name of wanted) {
    try {
      categories[name] = flatten(preferences[name]);
    } catch {
      /* **읽지 못하면 `null` 이다.** 없는 것과 못 읽은 것을 가르지 않는다 —
       * 어느 쪽이든 호출자가 쓸 값이 없다. */
      categories[name] = null;
    }
  }
  return { categories };
}

export interface ColorInfo {
  red: number | null;
  green: number | null;
  blue: number | null;
  /** `#RRGGBB`. 셋을 다 읽었을 때만 담는다. */
  hex: string | null;
}

/**
 * `SolidColor` 에서 RGB 를 읽는다.
 *
 * `solidColor()` 가 쓰는 것과 같은 경로다(`rgb.red` …). **통째로 읽을 수
 * 없다** — 쓸 때와 같은 제약이다(§17.33).
 *
 * ## 반올림한다 (ROADMAP §62)
 *
 * **Photoshop 은 정수로 넣은 값을 정수로 돌려주지 않는다** — 220 을 넣으면
 * `220.00000208616257` 이 나온다. 내부가 0–1 실수라 왕복에서 오차가 샌다.
 *
 * 그대로 두면 **되돌리기가 깨진다.** `previous` 를 그 값으로 주면 호출자가
 * 다시 넣을 수 없다 — 스키마가 정수만 받는다. 사용자가 색 선택기에서 고를 수
 * 있는 것도 0–255 정수뿐이므로 반올림이 정보를 버리지 않는다.
 *
 * 배경 레이어의 `opacityApplied` 와 같은 자리다 — 거기도 0–255 저장 때문에
 * 정확히 비교하면 오탐이 났다.
 */
function readColor(source: unknown): ColorInfo {
  const pick = (key: string): number | null => {
    try {
      const rgb = (source as Bag | undefined)?.["rgb"] as Bag | undefined;
      const value = rgb?.[key];
      return typeof value === "number" ? Math.round(value) : null;
    } catch {
      return null;
    }
  };
  const red = pick("red");
  const green = pick("green");
  const blue = pick("blue");
  const hex =
    red === null || green === null || blue === null
      ? null
      : `#${[red, green, blue]
          .map((n) => Math.round(n).toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()}`;
  return { red, green, blue, hex };
}

/**
 * 전경색과 배경색을 읽는다.
 *
 * **`path.stroke` 와 `dodge_burn` 이 이 값을 쓴다** — `strokePath` 에 색을
 * 주는 인자가 없어 전경색이 그대로 쓰인다(§58). 긋기 전에 이것으로 무슨 색이
 * 나올지 알 수 있다.
 *
 * **바꾸는 쪽은 `colorSetForeground` · `colorSetBackground` 다**(§62). 전경색은
 * 사용자가 Photoshop UI 에서 쓰는 상태이므로 이것으로 먼저 읽어 두었다가
 * 되돌린다. 색을 정해 칠하려면 `paint.dab` · `path.fill` 처럼 색을 받는
 * Tool 을 쓴다.
 */
export function colorGetForegroundBackground(): {
  foreground: ColorInfo;
  background: ColorInfo;
} {
  const bag = app as unknown as Bag;
  return {
    foreground: readColor(bag["foregroundColor"]),
    background: readColor(bag["backgroundColor"]),
  };
}

/**
 * 전경색·배경색을 바꾼다. (ROADMAP §62)
 *
 * ## 되돌릴 수 있게 만든다
 *
 * §61 에서 **만들지 않기로** 했던 것이다 — "사용자가 UI 에서 쓰는 상태라
 * 말없이 바꾸면 다음에 칠할 때 엉뚱한 색이 나온다" 가 이유였다. 그 이유는
 * 지금도 맞으므로 **바꾸기 전 색을 결과에 담는다.** 호출자가 끝나고
 * 되돌릴 수 있어야 한다.
 *
 * ## 쓴 값이 들어갔는지 확인한다
 *
 * `SolidColor` 인스턴스를 통째로 대입하는 경로다. 배경 레이어의
 * `set_opacity` 처럼 **오류 없이 무시되는** 자리가 이 프로젝트에 여럿
 * 있었으므로 넣고 나서 다시 읽어 `applied` 로 답한다.
 */
async function setColor(
  key: "foregroundColor" | "backgroundColor",
  color: { red: number; green: number; blue: number },
): Promise<{ previous: ColorInfo; current: ColorInfo; applied: boolean }> {
  const bag = app as unknown as Bag;
  const previous = readColor(bag[key]);

  try {
    bag[key] = solidColor(color);
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `색을 바꾸지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { key } },
    );
  }

  /* `readColor` 가 반올림한 값이라 그대로 비교한다. 반올림 전 값으로 비교하면
   * **들어갔는데 안 들어갔다고 답한다** — 실기에서 그렇게 나왔다. */
  const current = readColor(bag[key]);
  /* 읽지 못했으면 들어갔는지 알 수 없다 — `true` 로 답하지 않는다. */
  const applied =
    current.red === color.red && current.green === color.green && current.blue === color.blue;
  return { previous, current, applied };
}

export async function colorSetForeground(params: {
  red: number;
  green: number;
  blue: number;
}): Promise<{ previous: ColorInfo; current: ColorInfo; applied: boolean }> {
  return runModal("Set foreground color", async () => setColor("foregroundColor", params));
}

export async function colorSetBackground(params: {
  red: number;
  green: number;
  blue: number;
}): Promise<{ previous: ColorInfo; current: ColorInfo; applied: boolean }> {
  return runModal("Set background color", async () => setColor("backgroundColor", params));
}
