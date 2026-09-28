import { constants } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { toLayerInfo } from "./layers.js";
import { runModal } from "./modal.js";
import { requireTextLayer } from "./text.js";

/**
 * 텍스트 세부 — 자간 · 행간 · 단락 · 워프 · 변환. (ROADMAP §60)
 *
 * `text.create` · `text.set` 은 **워터마크·서명 범위**로 열어 두었고(§17.33)
 * 나머지는 `CORE_API.md` §5.12 에 "실제 요구가 확인된 뒤에 연다" 로 남아
 * 있었다. 요구가 확인되어 연다.
 *
 * ## 전부 DOM 이다
 *
 * `TextItem`(24.1+) 에 `characterStyle` · `paragraphStyle` · `warpStyle` 과
 * `convertToPointText` · `convertToParagraphText` · `convertToShape` 가 있다.
 * batchPlay 를 쓰지 않는다.
 *
 * ## 단위가 레퍼런스에 적혀 있다
 *
 * **`tracking` 은 1/1000 em** 이고 `leading` · `baselineShift` · 들여쓰기 ·
 * 문단 간격은 **72ppi 기준 픽셀**이다. 포인트가 아니다 — 300ppi 문서에서는
 * 화면에서 보는 값과 다르다.
 */

type Bag = Record<string, unknown>;

function styleOf(layer: unknown, key: string, label: string): Bag {
  const textItem = (layer as Bag)["textItem"] as Bag | undefined;
  if (textItem === undefined) {
    throw new DispatchError("COMMAND_FAILED", "텍스트 레이어에 textItem 이 없습니다.", {
      recoverable: true,
    });
  }
  const style = textItem[key] as Bag | undefined;
  if (style === undefined || style === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 의 TextItem 에 ${label} 이(가) 없습니다(24.1 이상이 필요합니다).`,
      { recoverable: false, details: { key } },
    );
  }
  return style;
}

function textItemOf(layer: unknown): Bag {
  const textItem = (layer as Bag)["textItem"] as Bag | undefined;
  if (textItem === undefined) {
    throw new DispatchError("COMMAND_FAILED", "텍스트 레이어에 textItem 이 없습니다.", {
      recoverable: true,
    });
  }
  return textItem;
}

/** 못 읽으면 `null` 이다. 지어내지 않는다. */
function read<T>(bag: Bag, key: string, guard: (v: unknown) => v is T): T | null {
  try {
    const value = bag[key];
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}
const isNumber = (v: unknown): v is number => typeof v === "number";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isString = (v: unknown): v is string => typeof v === "string";

/** 열거값은 문자열로 읽히면 그대로, 아니면 문자열화해서 담는다. */
function readEnum(bag: Bag, key: string): string | null {
  try {
    const value = bag[key];
    if (typeof value === "string") {
      return value;
    }
    return value === undefined || value === null ? null : String(value);
  } catch {
    return null;
  }
}

/** 상수 표에서 값을 꺼낸다. 없으면 **무엇이 있는지 함께** 담아 거절한다. */
function fromTable(table: unknown, key: string, label: string): unknown {
  const bag = table as Bag | undefined;
  const value = bag?.[key];
  if (value === undefined) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 에서 ${label} ${key} 를 찾을 수 없습니다.`,
      {
        recoverable: true,
        details: {
          key,
          hasTable: bag !== undefined,
          available: bag === undefined ? [] : Object.keys(bag),
        },
      },
    );
  }
  return value;
}

const WARP_KEYS = {
  none: "NONE",
  arc: "ARC",
  arcLower: "ARCLOWER",
  arcUpper: "ARCUPPER",
  arch: "ARCH",
  bulge: "BULGE",
  shellLower: "SHELLLOWER",
  shellUpper: "SHELLUPPER",
  flag: "FLAG",
  wave: "WAVE",
  fish: "FISH",
  rise: "RISE",
  fishEye: "FISHEYE",
  inflate: "INFLATE",
  squeeze: "SQUEEZE",
  twist: "TWIST",
} as const;
export type WarpName = keyof typeof WARP_KEYS;

/**
 * 읽은 워프 값을 우리 이름으로 되돌린다.
 *
 * **런타임 값에 `warp` 접두사가 붙는다** — 실기에서 `none` 을 넣고 읽으니
 * `warpNone`, `arcLower` 를 넣고 읽으니 `warpArcLower` 였다. 상수 멤버 이름
 * (`NONE` · `ARCLOWER`)과도 다르다.
 *
 * 그대로 돌려주면 **호출자가 넣는 어휘와 읽는 어휘가 달라진다.** 규칙이
 * 분명하므로 경계에서 되돌린다 — `path.kind` 의 `workPathIndex` 처럼 규칙을
 * 못 찾은 경우에는 원본을 그대로 뒀다(§58).
 *
 * 모르는 값은 **그대로 둔다.** 억지로 깎으면 없는 이름을 만들어낸다.
 */
function warpNameOf(value: string | null): string | null {
  if (value === null || !value.startsWith("warp") || value.length <= 4) {
    return value;
  }
  const rest = value.slice(4);
  const name = rest.charAt(0).toLowerCase() + rest.slice(1);
  return name in WARP_KEYS ? name : value;
}

export interface TextDetail {
  layer: LayerInfo;
  contents: string | null;
  isPointText: boolean | null;
  isParagraphText: boolean | null;
  orientation: string | null;
  clickPoint: { x: number; y: number } | null;
  character: {
    font: string | null;
    size: number | null;
    /** 72ppi 기준 픽셀. `useAutoLeading` 이 켜져 있으면 의미가 없다. */
    leading: number | null;
    useAutoLeading: boolean | null;
    /** **1/1000 em** 이다. */
    tracking: number | null;
    baselineShift: number | null;
    horizontalScale: number | null;
    verticalScale: number | null;
    fauxBold: boolean | null;
    fauxItalic: boolean | null;
  };
  paragraph: {
    justification: string | null;
    firstLineIndent: number | null;
    leftIndent: number | null;
    rightIndent: number | null;
    spaceBefore: number | null;
    spaceAfter: number | null;
    hyphenation: boolean | null;
  };
  warp: {
    style: string | null;
    bend: number | null;
    horizontalDistortion: number | null;
    verticalDistortion: number | null;
    direction: string | null;
  };
}

export function textGet(params: { layerId?: number }): TextDetail {
  const document = requireActiveDocument();
  const layer = requireTextLayer(document, params.layerId);
  const textItem = textItemOf(layer);

  /* **스타일 객체가 없어도 읽기는 실패하지 않는다.** 24.1 미만이면 전부
   * `null` 이 되고 호출자는 "못 읽었다" 를 본다. 거절하면 `contents` 같은
   * 읽을 수 있는 것까지 못 준다. */
  const character = (textItem["characterStyle"] as Bag | undefined) ?? {};
  const paragraph = (textItem["paragraphStyle"] as Bag | undefined) ?? {};
  const warp = (textItem["warpStyle"] as Bag | undefined) ?? {};

  const point = (() => {
    try {
      const value = textItem["textClickPoint"] as Bag | undefined;
      const x = value?.["x"];
      const y = value?.["y"];
      return typeof x === "number" && typeof y === "number" ? { x, y } : null;
    } catch {
      return null;
    }
  })();

  return {
    layer: toLayerInfo(layer),
    contents: read(textItem, "contents", isString),
    isPointText: read(textItem, "isPointText", isBoolean),
    isParagraphText: read(textItem, "isParagraphText", isBoolean),
    orientation: readEnum(textItem, "orientation"),
    clickPoint: point,
    character: {
      font: read(character, "font", isString),
      size: read(character, "size", isNumber),
      leading: read(character, "leading", isNumber),
      useAutoLeading: read(character, "useAutoLeading", isBoolean),
      tracking: read(character, "tracking", isNumber),
      baselineShift: read(character, "baselineShift", isNumber),
      horizontalScale: read(character, "horizontalScale", isNumber),
      verticalScale: read(character, "verticalScale", isNumber),
      fauxBold: read(character, "fauxBold", isBoolean),
      fauxItalic: read(character, "fauxItalic", isBoolean),
    },
    paragraph: {
      justification: readEnum(paragraph, "justification"),
      firstLineIndent: read(paragraph, "firstLineIndent", isNumber),
      leftIndent: read(paragraph, "leftIndent", isNumber),
      rightIndent: read(paragraph, "rightIndent", isNumber),
      spaceBefore: read(paragraph, "spaceBefore", isNumber),
      spaceAfter: read(paragraph, "spaceAfter", isNumber),
      hyphenation: read(paragraph, "hyphenation", isBoolean),
    },
    warp: {
      style: warpNameOf(readEnum(warp, "style")),
      bend: read(warp, "bend", isNumber),
      horizontalDistortion: read(warp, "horizontalDistortion", isNumber),
      verticalDistortion: read(warp, "verticalDistortion", isNumber),
      direction: readEnum(warp, "direction"),
    },
  };
}

/** 넣은 뒤 **다시 읽어** 결과로 준다. 요청값을 되돌려주면 안 들어간 것을 모른다. */
function assign(style: Bag, key: string, value: unknown, applied: string[]): void {
  if (value === undefined) {
    return;
  }
  try {
    style[key] = value;
    applied.push(key);
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `${key} 를 넣지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { key } },
    );
  }
}

export async function textSetTracking(params: {
  layerId?: number;
  tracking: number;
}): Promise<TextDetail> {
  return runModal("Set tracking", async () => {
    const document = requireActiveDocument();
    const layer = requireTextLayer(document, params.layerId);
    const character = styleOf(layer, "characterStyle", "characterStyle");
    const applied: string[] = [];
    assign(character, "tracking", params.tracking, applied);
    return textGet({ layerId: layer.id });
  });
}

export async function textSetLeading(params: {
  layerId?: number;
  leading?: number;
  auto?: boolean;
}): Promise<TextDetail> {
  return runModal("Set leading", async () => {
    const document = requireActiveDocument();
    const layer = requireTextLayer(document, params.layerId);
    const character = styleOf(layer, "characterStyle", "characterStyle");
    const applied: string[] = [];
    /* **`useAutoLeading` 를 먼저 끈다.** 켜져 있으면 `leading` 을 넣어도
     * 화면이 안 바뀐다 — 그러면 "넣었는데 아무 일도 없는" 상태가 된다. */
    if (params.leading !== undefined && params.auto !== true) {
      assign(character, "useAutoLeading", false, applied);
    }
    assign(character, "leading", params.leading, applied);
    if (params.auto !== undefined) {
      assign(character, "useAutoLeading", params.auto, applied);
    }
    return textGet({ layerId: layer.id });
  });
}

const JUSTIFICATION_KEYS = {
  left: "LEFT",
  center: "CENTER",
  right: "RIGHT",
  leftJustified: "LEFTJUSTIFIED",
  centerJustified: "CENTERJUSTIFIED",
  rightJustified: "RIGHTJUSTIFIED",
  fullyJustified: "FULLYJUSTIFIED",
} as const;
export type JustificationName = keyof typeof JUSTIFICATION_KEYS;

export async function textSetParagraph(params: {
  layerId?: number;
  justification?: JustificationName;
  firstLineIndent?: number;
  leftIndent?: number;
  rightIndent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  hyphenation?: boolean;
}): Promise<TextDetail> {
  return runModal("Set paragraph", async () => {
    const document = requireActiveDocument();
    const layer = requireTextLayer(document, params.layerId);
    const paragraph = styleOf(layer, "paragraphStyle", "paragraphStyle");
    const applied: string[] = [];

    if (params.justification !== undefined) {
      assign(
        paragraph,
        "justification",
        fromTable(constants.Justification, JUSTIFICATION_KEYS[params.justification], "정렬"),
        applied,
      );
    }
    assign(paragraph, "firstLineIndent", params.firstLineIndent, applied);
    assign(paragraph, "leftIndent", params.leftIndent, applied);
    assign(paragraph, "rightIndent", params.rightIndent, applied);
    assign(paragraph, "spaceBefore", params.spaceBefore, applied);
    assign(paragraph, "spaceAfter", params.spaceAfter, applied);
    assign(paragraph, "hyphenation", params.hyphenation, applied);
    return textGet({ layerId: layer.id });
  });
}

export async function textWarp(params: {
  layerId?: number;
  style: WarpName;
  bend?: number;
  horizontalDistortion?: number;
  verticalDistortion?: number;
  direction?: "horizontal" | "vertical";
}): Promise<TextDetail> {
  return runModal("Warp text", async () => {
    const document = requireActiveDocument();
    const layer = requireTextLayer(document, params.layerId);
    const warp = styleOf(layer, "warpStyle", "warpStyle");
    const applied: string[] = [];

    assign(warp, "style", fromTable(constants.WarpStyle, WARP_KEYS[params.style], "워프"), applied);
    if (params.direction !== undefined) {
      assign(
        warp,
        "direction",
        fromTable(
          constants.Direction,
          params.direction === "vertical" ? "VERTICAL" : "HORIZONTAL",
          "방향",
        ),
        applied,
      );
    }
    assign(warp, "bend", params.bend, applied);
    assign(warp, "horizontalDistortion", params.horizontalDistortion, applied);
    assign(warp, "verticalDistortion", params.verticalDistortion, applied);
    return textGet({ layerId: layer.id });
  });
}

async function convert(
  layerId: number | undefined,
  method: string,
  label: string,
): Promise<TextDetail> {
  return runModal(label, async () => {
    const document = requireActiveDocument();
    const layer = requireTextLayer(document, layerId);
    const textItem = textItemOf(layer);
    const fn = textItem[method];
    if (typeof fn !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 의 TextItem 에 ${method} 가 없습니다(24.1 이상이 필요합니다).`,
        { recoverable: false, details: { method } },
      );
    }
    try {
      await (fn as () => Promise<unknown>).call(textItem);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `${label} 하지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { method } },
      );
    }
    return textGet({ layerId: layer.id });
  });
}

export async function textConvertToPoint(params: { layerId?: number }): Promise<TextDetail> {
  return convert(params.layerId, "convertToPointText", "점 텍스트로 변환");
}

export async function textConvertToParagraph(params: { layerId?: number }): Promise<TextDetail> {
  return convert(params.layerId, "convertToParagraphText", "단락 텍스트로 변환");
}

/**
 * 텍스트를 모양 레이어로 바꾼다.
 *
 * **destructive 다.** 글자가 벡터 윤곽이 되어 **더는 텍스트가 아니다** —
 * 내용도 폰트도 고칠 수 없다. `layer.rasterize` 가 픽셀로 굽는 것과 같은
 * 종류이고, 되돌릴 길은 History 뿐이다.
 *
 * 결과가 텍스트 레이어가 아니므로 `textGet` 을 부를 수 없다. 레이어 정보만
 * 돌려준다.
 */
export async function textConvertToShape(params: { layerId?: number }): Promise<{
  layer: LayerInfo;
  previousType: string;
}> {
  return runModal("Convert text to shape", async () => {
    const document = requireActiveDocument();
    const layer = requireTextLayer(document, params.layerId);
    const textItem = textItemOf(layer);
    const layerId = layer.id;

    const fn = textItem["convertToShape"];
    if (typeof fn !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 의 TextItem 에 convertToShape 가 없습니다(24.1 이상이 필요합니다).",
        { recoverable: false },
      );
    }
    try {
      await (fn as () => Promise<void>).call(textItem);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `모양으로 변환하지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { layerId } },
      );
    }

    /* **정말 텍스트가 아니게 됐는지 확인한다.** 오류 없이 아무 일도 안 하는
     * 경로가 이 프로젝트에 여럿 있었다. */
    const after = document.activeLayers.find((entry) => entry.id === layerId) ?? layer;
    const info = toLayerInfo(after);
    if (info.type === "text") {
      throw new DispatchError(
        "COMMAND_FAILED",
        "변환 명령은 끝났지만 레이어가 아직 텍스트입니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { layerId } },
      );
    }
    return { layer: info, previousType: "text" };
  });
}
