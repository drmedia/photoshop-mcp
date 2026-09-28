import type { PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { orderActiveLayers } from "./active-order.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers, toArray, toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_SELECT_MULTIPLE` — 레이어 여러 장을 한 번에 선택한다. (CORE_API §5 P1)
 *
 * ## 왜 필요한가
 *
 * `layer.select` 는 하나만 고른다. Photoshop 은 여러 장을 동시에 고를 수 있고,
 * 사람이 그렇게 해 둔 상태를 `layer.get_active` 가 이미 보고한다 — **읽기만
 * 되고 쓰기가 없었다.**
 *
 * ## 순서를 우리가 정하지 못한다
 *
 * 편집 Command 는 `layerId` 를 생략하면 `activeLayers[0]` 을 쓴다. 그런데
 * **`activeLayers` 의 순서는 레이어 순서도, 우리가 넘긴 순서도 아닐 수 있다.**
 * 실기에서 `layer.get_active` 가 한 번 틀렸던 자리다(`active-order.ts`).
 *
 * 그래서 넘긴 순서를 결과로 되풀이하지 않고 **선택한 뒤 다시 읽어서** 실제
 * 순서를 돌려준다. 호출자가 "내가 첫 번째로 준 것이 대상" 이라고 믿으면
 * 조용히 다른 레이어를 편집하게 된다.
 *
 * **실기에서 확인했다. Photoshop 은 넘긴 순서를 지키지 않는다.**
 *
 * ```text
 * 요청 [2, 4, 3]  →  activeLayers [2, 3, 4]
 * 요청 [4, 2, 3]  →  activeLayers [2, 3, 4]
 * ```
 *
 * 레이어 순서는 위→아래로 4·3·2 였으므로 **아래→위로 정규화한다.** 두 번째
 * 호출에서 첫 번째로 준 것은 4 인데 `layerId` 를 생략한 `set_opacity` 가
 * 걸린 것은 2 였다 — 넘긴 순서를 답했으면 그대로 거짓말이 된다.
 */
export async function layerSelectMultiple(params: {
  layerIds: readonly number[];
}): Promise<LayerInfo[]> {
  return runModal("Select layers", async () => {
    const document = requireActiveDocument();

    /* **먼저 전부 찾고 나서 선택한다.** 하나씩 찾아 가며 선택하면 중간에
     * 없는 id 를 만났을 때 일부만 선택된 채로 실패한다 — `group.create` 에서
     * 같은 실수를 했다(§17.20, "검증은 만들기 전에 한다"). */
    const missing: number[] = [];
    const found: PhotoshopLayer[] = [];
    for (const id of params.layerIds) {
      const layer = findLayerById(document.layers, id);
      if (layer === null || layer === undefined) {
        missing.push(id);
      } else {
        found.push(layer);
      }
    }

    if (missing.length > 0) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        `레이어 ${missing.join(", ")} 를 찾을 수 없어 아무것도 선택하지 않았습니다.`,
        { recoverable: true, details: { missing, requested: [...params.layerIds] } },
      );
    }

    document.activeLayers = found;

    /* **읽어서 돌려준다.** 넘긴 순서를 그대로 답하면 Photoshop 이 다르게
     * 정했을 때 거짓말이 된다. `layer.get_active` 와 같은 경로를 쓴다. */
    const active = toArray<PhotoshopLayer>(document.activeLayers);
    if (active.length === 0) {
      return [];
    }
    const ordered = orderActiveLayers(
      active.map((layer) => layer.id),
      flattenLayers(document.layers),
      active.map((layer) => toLayerInfo(layer)),
    );
    return withMaskStateAsync(ordered);
  });
}
