import type { PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_GET` — 레이어 하나의 상세. (CORE_API §5 P1)
 *
 * ## `layer.list` 가 안 주는 것
 *
 * 목록은 레이어마다 한 줄이라 **경계를 담지 않는다.** 그런데 실기에서 가장
 * 아쉬웠던 것이 그것이었다 — 외부 처리기가 돌려준 레이어가 위로 밀렸는데
 * 확인할 방법이 없어 가로 띠를 여러 번 재서 알아냈다(ROADMAP §28).
 * `bounds` 하나면 한 번에 끝나는 일이었다.
 *
 * ## 속성 이름은 Adobe 레퍼런스에서 가져왔다
 *
 * `clipped` 가 아니라 **`isClippingMask`** 이고, 잠금은 `locked`(무엇이든
 * 잠겼는가) 와 `allLocked`(전부 잠겼는가) 둘이다. 짐작했으면 `undefined` 를
 * 읽고 조용히 `null` 로 답했을 것이다.
 *
 * ## 못 읽으면 `null`
 *
 * 버전에 따라 없는 속성이 있다. 없는 것을 `0` 이나 `false` 로 채우면 **틀린
 * 사실**을 말하게 된다 — `isBackground` · `rawBitDepth` 와 같은 원칙이다.
 */

export interface LayerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface LayerDetail {
  layer: LayerInfo;
  bounds: LayerBounds | null;
  /** 효과를 뺀 경계. 효과가 없으면 `bounds` 와 같다. */
  boundsNoEffects: LayerBounds | null;
  locked: boolean | null;
  allLocked: boolean | null;
  isClippingMask: boolean | null;
  /** 0–100. `opacity` 와 다르다 — 효과는 남기고 픽셀만 투명해진다. */
  fillOpacity: number | null;
}

/** 숫자가 아니면 `null`. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * `Bounds` 의 모양이 레퍼런스에 없다. **네 값을 모두 읽을 수 있을 때만** 답하고
 * 하나라도 못 읽으면 `null` 이다 — 일부만 맞는 경계는 없느니만 못하다.
 */
function toBounds(value: unknown): LayerBounds | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const left = num(raw["left"]);
  const top = num(raw["top"]);
  const right = num(raw["right"]);
  const bottom = num(raw["bottom"]);
  if (left === null || top === null || right === null || bottom === null) {
    return null;
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}

export async function layerGet(params: { layerId?: number }): Promise<LayerDetail> {
  return runModal("Get layer", async () => {
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
          : `레이어 ${String(params.layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    /* 마스크 상태는 batchPlay 로 따로 읽는다. `layer.list` 와 같은 경로를 써야
     * 두 Tool 이 다른 말을 하지 않는다. */
    const base = (await withMaskStateAsync([toLayerInfo(layer as PhotoshopLayer)]))[0] as LayerInfo;
    const raw = layer as unknown as Record<string, unknown>;

    return {
      layer: base,
      bounds: toBounds(raw["bounds"]),
      boundsNoEffects: toBounds(raw["boundsNoEffects"]),
      locked: flag(raw["locked"]),
      allLocked: flag(raw["allLocked"]),
      isClippingMask: flag(raw["isClippingMask"]),
      fillOpacity: num(raw["fillOpacity"]),
    };
  });
}
