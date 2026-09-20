import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";
import { applyDabs, monochromeFill, play, type Dab } from "./dab.js";

/**
 * 색 칠하기와 마스크 칠하기. (ROADMAP §17.32)
 *
 * `dodge_burn.dab`(§17.31)이 연 길을 두 방향으로 넓힌 것이다. 얼룩은 `중심 ·
 * 반지름 · 강도 · 경도` 로 결정되므로 획 경로가 필요 없고, 검증된 파라미터로만
 * 조립된다. (ARCHITECTURE §23)
 *
 * `RGBColor` 의 **녹색 키는 `green` 이 아니라 `grain`** 이다. `mask-gradient.ts`
 * 에서 이미 쓰고 있던 것을 그대로 가져왔다 — 짐작한 것이 아니다.
 */

/** 0–255. */
export interface PaintColor {
  red: number;
  green: number;
  blue: number;
}

function colorFill(color: PaintColor, strength: number): Record<string, unknown> {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: "color" },
    // **`grain` 이 녹색이다.** mask-gradient.ts 가 쓰는 것과 같은 형태다.
    color: { _obj: "RGBColor", red: color.red, grain: color.green, blue: color.blue },
    opacity: { _unit: "percentUnit", _value: strength },
    mode: { _enum: "blendMode", _value: "normal" },
  };
}

/**
 * 픽셀 레이어에 색 얼룩을 칠한다.
 *
 * 배경을 거절하는 것은 `dodge_burn.dab` 과 같은 이유다 — 원본 촬영 픽셀을
 * 덮어쓰면 되돌릴 수 없다.
 */
export async function paintDab(params: {
  dabs: Dab[];
  color: PaintColor;
  layerId?: number;
}): Promise<{ layer: LayerInfo; applied: number }> {
  return runModal("Paint", async () => {
    const document = requireActiveDocument();

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

    const kind = toLayerType(layer.kind).type;
    if (kind !== "pixel") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `${kind} 레이어에는 칠할 수 없습니다. ` +
          "photoshop.layer.create 로 빈 픽셀 레이어를 만들고 그것을 지정하세요. " +
          "마스크에 칠하려면 photoshop.mask.dab 을 쓰세요.",
        { recoverable: true, details: { layerId: layer.id, type: kind } },
      );
    }

    if (layer.isBackgroundLayer === true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "배경 레이어에는 칠하지 않습니다 — 원본 픽셀이 사라집니다. " +
          "photoshop.layer.create 로 빈 레이어를 만들고 거기에 칠하세요.",
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    document.activeLayers = [layer];

    const applied = await applyDabs(params.dabs, document, (dab) =>
      colorFill(params.color, dab.strength),
    );

    return { layer: toLayerInfo(layer), applied };
  });
}

/**
 * **레이어 마스크에** 얼룩을 칠한다.
 *
 * 이것이 `paint.dab` 과 다른 점은 대상이 픽셀이 아니라 마스크라는 것이다.
 * 그래서 **조정 레이어에도 쓸 수 있고**, 무엇보다 그래디언트로 맞출 수 없는
 * 비대칭한 빛 공해를 국소적으로 다듬을 수 있다.
 *
 * `mask.gradient`(§17.22)가 마스크를 통째로 덮어쓰는 것과 달리 이쪽은 **더한다.**
 *
 * 마스크 채널을 잡았으면 **반드시 되돌린다** — 안 되돌리면 이후 편집이 전부
 * 마스크에 들어간다. `mask-gradient.ts` 가 같은 자리에서 같은 일을 한다.
 */
export async function maskDab(params: {
  dabs: Dab[];
  mode: "reveal" | "hide";
  layerId?: number;
}): Promise<{ layer: LayerInfo; applied: number }> {
  return runModal("Mask dab", async () => {
    const document = requireActiveDocument();

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
    document.activeLayers = [layer];

    // 마스크가 없으면 Photoshop 이 `"선택" 명령은 현재 사용할 수 없습니다` 라고만
    // 답한다. 원문으로는 마스크가 없어서 난 오류라는 것을 알 수 없다.
    try {
      await play("Target mask channel", {
        _obj: "select",
        _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }],
        makeVisible: false,
      });
    } catch {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "이 레이어에 마스크가 없습니다. mask.create 로 먼저 만드세요. " +
          "layer.list 의 hasMask 로 확인할 수 있습니다.",
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    // 마스크에서 흰색은 보이는 쪽이다.
    const fillWith = params.mode === "reveal" ? "white" : "black";
    try {
      const applied = await applyDabs(params.dabs, document, (dab) =>
        monochromeFill(fillWith, dab.strength),
      );
      return { layer: toLayerInfo(layer), applied };
    } finally {
      await play("Restore composite target", {
        _obj: "select",
        _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }],
      }).catch(() => {
        // 이미 실패한 길이면 복원 실패까지 덮어쓰지 않는다.
      });
    }
  });
}
