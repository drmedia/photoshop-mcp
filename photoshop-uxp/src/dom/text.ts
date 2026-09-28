import { app } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";

/**
 * 텍스트 레이어. (ROADMAP §17.33)
 *
 * ## batchPlay 를 쓰지 않는다
 *
 * **DOM 에 있는지 짐작하지 않고 재 봤고, 있었다** — `document.createTextLayer` 와
 * `layer.textItem.characterStyle` 이다. `document.rotate`(§17.19) 때와 같은
 * 방식으로 확인했다.
 *
 * DOM 이 있으면 DOM 을 쓴다. descriptor 를 조립할 자리가 줄어든다.
 *
 * ## 범위는 워터마크·서명이다
 *
 * `CORE_API.md` §5.12 가 텍스트 전체를 P3 로 두고 "실제 요구가 확인된 뒤에
 * 연다" 고 적은 자리다. 확인된 요구가 워터마크·서명이므로 거기까지만 연다 —
 * 자간·행간·단락·변형은 넣지 않았다.
 */

export interface TextStyle {
  /** PostScript 이름. `font.list` 가 주는 값이다. */
  font?: string;
  /** 포인트. */
  size?: number;
  color?: { red: number; green: number; blue: number };
  /** 0–100. */
  opacity?: number;
  alignment?: "left" | "center" | "right";
}

/**
 * 폰트를 PostScript 이름으로 찾는다.
 *
 * **없는 폰트를 그대로 주면 Photoshop 이 조용히 대체한다.** 호출자는 지정한
 * 폰트가 걸렸다고 믿는다 — 배경 `set_opacity` 가 무시되던 것과 같은 종류의
 * 실패다(ARCHITECTURE §8.4). 그래서 미리 찾아보고 없으면 거절한다.
 */
function requireFont(postScriptName: string): void {
  const fonts = (app as unknown as Record<string, unknown>)["fonts"] as
    { length: number; [index: number]: { postScriptName?: string } } | undefined;
  if (fonts === undefined || typeof fonts.length !== "number") {
    // 목록을 얻지 못하면 막지 않는다. 없는 것을 참으로 읽어 멀쩡한 호출을
    // 막는 것이 더 나쁘다. (`isBackground` 와 같은 원칙)
    return;
  }
  for (let index = 0; index < fonts.length; index += 1) {
    if (fonts[index]?.postScriptName === postScriptName) {
      return;
    }
  }
  throw new DispatchError(
    "INVALID_PARAMETER",
    `'${postScriptName}' 폰트가 이 기기에 없습니다. ` +
      "photoshop.font.list 로 설치된 PostScript 이름을 확인하세요. " +
      "없는 이름을 주면 Photoshop 이 조용히 다른 폰트로 대체합니다.",
    { recoverable: true, details: { font: postScriptName } },
  );
}

/**
 * `SolidColor` 인스턴스를 만든다.
 *
 * 짐작으로 두 번 틀렸고 두 번 다 실기가 답을 줬다.
 *
 * ```text
 * { rgb: {...} } 를 color 에      'color' is of type object. Expecting type SolidColor.
 * solid.rgb = {...} 통째 대입      Argument 1 has an invalid type … actual type: undefined
 * solid.rgb.red = 255 하나씩       red=255 green=255 blue=255  ✓
 * ```
 *
 * 생성자는 `app.SolidColor` 다 — `photoshop` 모듈 최상위에는 없다.
 * **`rgb` 는 통째로 바꿀 수 없고 속성을 하나씩 넣어야 한다.**
 */
export function solidColor(color: { red: number; green: number; blue: number }): unknown {
  const Ctor = (app as unknown as Record<string, unknown>)["SolidColor"] as
    (new () => Record<string, unknown>) | undefined;
  if (typeof Ctor !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 app.SolidColor 가 없어 색을 지정할 수 없습니다.",
    );
  }
  const made = new Ctor();
  const rgb = made["rgb"] as Record<string, unknown>;
  rgb["red"] = color.red;
  rgb["green"] = color.green;
  rgb["blue"] = color.blue;
  return made;
}

/** `characterStyle` · `paragraphStyle` 에 스타일을 적용한다. */
function applyStyle(layer: Record<string, unknown>, style: TextStyle): string[] {
  const textItem = layer["textItem"] as Record<string, unknown> | undefined;
  if (textItem === undefined) {
    throw new DispatchError("COMMAND_FAILED", "텍스트 레이어에 textItem 이 없습니다.");
  }
  const character = textItem["characterStyle"] as Record<string, unknown> | undefined;
  const paragraph = textItem["paragraphStyle"] as Record<string, unknown> | undefined;
  const applied: string[] = [];

  if (style.font !== undefined && character !== undefined) {
    character["font"] = style.font;
    applied.push("font");
  }
  if (style.size !== undefined && character !== undefined) {
    character["size"] = style.size;
    applied.push("size");
  }
  if (style.color !== undefined && character !== undefined) {
    character["color"] = solidColor(style.color);
    applied.push("color");
  }
  if (style.alignment !== undefined && paragraph !== undefined) {
    paragraph["justification"] = style.alignment;
    applied.push("alignment");
  }
  if (style.opacity !== undefined) {
    (layer as { opacity?: number }).opacity = style.opacity;
    applied.push("opacity");
  }
  return applied;
}

export async function textCreate(params: {
  contents: string;
  x: number;
  y: number;
  name?: string;
  font?: string;
  size?: number;
  color?: { red: number; green: number; blue: number };
  opacity?: number;
  alignment?: "left" | "center" | "right";
}): Promise<{ layer: LayerInfo; applied: string[] }> {
  return runModal("Create text", async () => {
    const document = requireActiveDocument();
    if (params.font !== undefined) {
      requireFont(params.font);
    }

    const make = (document as unknown as Record<string, unknown>)["createTextLayer"] as
      ((options: unknown) => Promise<unknown>) | undefined;
    if (typeof make !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.createTextLayer 가 없습니다.",
      );
    }

    // `createTextLayer` 가 받는 것만 여기서 준다. 나머지는 만든 뒤 스타일로 건다 —
    // 어느 옵션을 받는지 확실한 것만 넣는 편이 조용히 무시되는 것보다 낫다.
    const created = (await make.call(document, {
      contents: params.contents,
      position: { x: params.x, y: params.y },
      ...(params.name === undefined ? {} : { name: params.name }),
    })) as Record<string, unknown> | null;

    if (created === null || created === undefined) {
      throw new DispatchError("COMMAND_FAILED", "텍스트 레이어가 만들어지지 않았습니다.");
    }

    const applied = applyStyle(created, params);
    return { layer: toLayerInfo(created as never), applied };
  });
}

export async function textSet(params: {
  layerId?: number;
  contents?: string;
  font?: string;
  size?: number;
  color?: { red: number; green: number; blue: number };
  opacity?: number;
  alignment?: "left" | "center" | "right";
}): Promise<{ layer: LayerInfo; applied: string[] }> {
  return runModal("Set text", async () => {
    const document = requireActiveDocument();
    if (params.font !== undefined) {
      requireFont(params.font);
    }

    const layer =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (layer === undefined || layer === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    // **텍스트 레이어가 아니면 막는다.** 픽셀 레이어의 `textItem` 은 없고,
    // 그대로 진행하면 원인을 알 수 없는 오류가 난다.
    const kind = toLayerType(layer.kind).type;
    if (kind !== "text") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `${kind} 레이어는 텍스트가 아닙니다. photoshop.layer.list 의 type 으로 확인하세요.`,
        { recoverable: true, details: { layerId: layer.id, type: kind } },
      );
    }

    const raw = layer as unknown as Record<string, unknown>;
    const applied: string[] = [];
    if (params.contents !== undefined) {
      const textItem = raw["textItem"] as Record<string, unknown> | undefined;
      if (textItem === undefined) {
        throw new DispatchError("COMMAND_FAILED", "텍스트 레이어에 textItem 이 없습니다.");
      }
      textItem["contents"] = params.contents;
      applied.push("contents");
    }
    applied.push(...applyStyle(raw, params));

    return { layer: toLayerInfo(layer), applied };
  });
}

export async function fontList(): Promise<{
  fonts: { name: string; family: string; style: string; postScriptName: string }[];
  total: number;
}> {
  const raw = (app as unknown as Record<string, unknown>)["fonts"] as
    | {
        length: number;
        [index: number]: {
          name?: string;
          family?: string;
          style?: string;
          postScriptName?: string;
        };
      }
    | undefined;
  if (raw === undefined || typeof raw.length !== "number") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에서 폰트 목록을 얻지 못했습니다(app.fonts 없음).",
    );
  }

  const fonts: { name: string; family: string; style: string; postScriptName: string }[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const font = raw[index];
    const postScriptName = font?.postScriptName;
    // PostScript 이름이 없으면 쓸 수 없는 항목이다. 담으면 호출자가 쓰려다 실패한다.
    if (typeof postScriptName !== "string" || postScriptName.length === 0) {
      continue;
    }
    fonts.push({
      name: String(font?.name ?? postScriptName),
      family: String(font?.family ?? ""),
      style: String(font?.style ?? ""),
      postScriptName,
    });
  }
  return { fonts, total: fonts.length };
}
