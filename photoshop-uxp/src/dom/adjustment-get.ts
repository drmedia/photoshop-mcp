import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * 조정 레이어가 가진 값을 읽는다. (ROADMAP §96)
 *
 * 보정 루프의 첫 단계는 "이미 걸린 보정을 읽는다" 인데, 읽을 도구가 없어서 마스크로 짐작해야 했다
 * (§95). 이 Tool 이 그 자리다.
 *
 * ## 읽기라서 키를 직접 물어도 된다
 *
 * batchPlay `get` 은 문서를 바꾸지 않는다. `smart_object.get_info` · `mask.select` 의 프로브와 같은
 * 방법으로 `adjustment` 속성을 묻는다.
 *
 * ## 모양을 짐작해 채우지 않는다
 *
 * 원본(`raw`)은 언제나 돌려준다. 해석한 값(`settings`)은 실기에서 모양을 확인한 종류에만 담고, 아니면
 * `null` 이다. `rawBitDepth` · `rawKind` · `rawAdjustmentType` 과 같은 원칙이다.
 */
export async function adjustmentGet(params: { layerId?: number }): Promise<{
  layer: LayerInfo;
  isAdjustment: boolean;
  raw: unknown;
}> {
  return runModal("Get adjustment", async () => {
    const document = requireActiveDocument();
    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${String(params.layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const info = flattenLayers(document.layers).find((entry) => entry.id === target.id);
    if (info === undefined) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        `레이어 ${String(target.id)} 를 목록에서 찾지 못했습니다.`,
        { recoverable: true, details: { layerId: target.id } },
      );
    }
    const layer = (await withMaskStateAsync([info]))[0] as LayerInfo;

    /* **조정 레이어가 아니면 묻지 않는다.** 픽셀 레이어에 `adjustment` 를 물으면 batchPlay 가
     * 실패한다. 그 실패를 "읽지 못했다" 로 돌려주면 호출자는 조정 레이어인데 읽기에 실패한 것으로
     * 읽는다. 오류가 아니라 `isAdjustment: false` 로 답해서 먼저 확인하는 용도로도 쓰게 한다. */
    if (layer.type !== "adjustment") {
      return { layer, isAdjustment: false, raw: null };
    }

    let raw: unknown = null;
    try {
      const results = await action.batchPlay(
        [
          {
            _obj: "get",
            _target: [{ _property: "adjustment" }, { _ref: "layer", _id: layer.id }],
          },
        ],
        {},
      );
      raw = results[0]?.["adjustment"] ?? null;
    } catch {
      // 읽지 못하면 null 이다. 지어내지 않는다.
      raw = null;
    }
    return { layer, isAdjustment: true, raw };
  });
}
