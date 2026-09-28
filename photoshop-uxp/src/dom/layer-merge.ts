import type { PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers, toArray } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_MERGE` — 레이어를 합친다. (CORE_API §5 P2)
 *
 * ## 선택 상태에 따라 뜻이 달라진다
 *
 * Adobe 레퍼런스가 이렇게 적는다 — "Combines selected layers; merges one layer
 * downward if only one is selected."
 *
 * ```text
 * 하나 선택   →  아래로 병합 (Merge Down)
 * 여럿 선택   →  그것들끼리 병합
 * ```
 *
 * **숨은 의존성을 그대로 두지 않는다.** `layerIds` 로 무엇을 합칠지 명시하면
 * 이 Command 가 먼저 선택해 준다 — 호출자가 "지금 무엇이 선택돼 있는지" 를
 * 추적해야 결과를 예측할 수 있는 API 는 조용히 틀린다(§17.20).
 *
 * 생략하면 지금 선택을 쓴다. 어느 쪽이었는지는 결과의 `merged` 에 담는다.
 *
 * ## 숨긴 레이어는 조용히 아무 일도 안 한다
 *
 * 실기에서 확인했다(ROADMAP §46). 내용이 있는 숨긴 레이어를 아래로 병합하면
 * **오류 없이 레이어 수가 그대로다.** `mergeVisibleLayers` 와 같은 자리다(§40).
 *
 * 그래서 **전후 레이어 수를 세어** 변화가 없으면 실패로 답한다. 성공으로
 * 보고하면 호출자는 합쳐진 줄 안다 — 이 검사가 실기에서 바로 값을 했다.
 *
 * ## 아래에 합칠 것이 없으면 미리 막는다
 *
 * 맨 아래 레이어 하나로 "아래로 병합" 은 할 수 없다. Photoshop 은 이유를
 * 말해 주지 않는다.
 */

export interface LayerMergeResult {
  /** 합쳐진 뒤의 레이어. */
  layer: LayerInfo;
  /** 실제로 합친 대상의 id. 호출자가 준 것이거나 그때 선택돼 있던 것이다. */
  merged: number[];
  /** 합치기 전후 전체 레이어 수. */
  before: number;
  after: number;
  /** 사라진 레이어 수. */
  removed: number;
  /** 하나만 주어 **아래로 병합**이 된 경우. */
  mergedDown: boolean;
}

export async function layerMerge(params: { layerIds?: number[] }): Promise<LayerMergeResult> {
  return runModal("Merge layers", async () => {
    const document = requireActiveDocument();

    /* 대상을 먼저 정한다. 주면 그것을 선택하고, 안 주면 지금 선택을 쓴다. */
    let targets: PhotoshopLayer[];
    if (params.layerIds === undefined) {
      targets = toArray<PhotoshopLayer>(document.activeLayers);
      if (targets.length === 0) {
        throw new DispatchError(
          "LAYER_NOT_FOUND",
          "선택된 레이어가 없습니다. layerIds 를 주거나 photoshop.layer.select_multiple 로 먼저 고르세요.",
          { recoverable: true },
        );
      }
    } else {
      /* **먼저 전부 찾고 나서 선택한다.** 하나씩 찾아 가며 선택하면 중간에
       * 없는 id 를 만났을 때 일부만 선택된 채로 실패한다(§17.20). */
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
          `레이어 ${missing.join(", ")} 를 찾을 수 없어 아무것도 합치지 않았습니다.`,
          { recoverable: true, details: { missing, requested: [...params.layerIds] } },
        );
      }
      document.activeLayers = found;
      targets = found;
    }

    const mergedIds = targets.map((layer) => layer.id);
    const mergedDown = mergedIds.length === 1;

    const beforeLayers = flattenLayers(document.layers);
    const before = beforeLayers.length;
    const beforeIds = new Set(beforeLayers.map((entry) => entry.id));

    /* **아래에 합칠 것이 없으면 미리 막는다.** 같은 부모 안에서 마지막이면
     * 아래가 없다 — Photoshop 은 이유를 말해 주지 않는다. */
    if (mergedDown) {
      const only = beforeLayers.find((entry) => entry.id === mergedIds[0]);
      const siblings = beforeLayers.filter((entry) => entry.parentId === (only?.parentId ?? null));
      const last = siblings[siblings.length - 1];
      if (only !== undefined && last !== undefined && last.id === only.id) {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `레이어 ${only.id} 아래에 합칠 레이어가 없습니다. ` +
            "여러 장을 합치려면 layerIds 에 둘 이상을 주세요.",
          { recoverable: true, details: { layerId: only.id } },
        );
      }
    }

    /* **아래로 병합이면 결과는 바로 밑 레이어다.** 대상 목록에도 없고 새로
     * 생긴 id 도 아니라 실기에서 못 찾았다(ROADMAP §46). 미리 떠 둔다. */
    const firstIndex = beforeLayers.findIndex((entry) => entry.id === mergedIds[0]);
    const below = firstIndex >= 0 ? beforeLayers[firstIndex + 1] : undefined;

    let returned: unknown;
    try {
      const first = targets[0] as PhotoshopLayer;
      const merge = (first as unknown as Record<string, unknown>)["merge"];
      if (typeof merge !== "function") {
        throw new DispatchError(
          "COMMAND_NOT_SUPPORTED",
          "이 Photoshop 에는 Layer.merge 가 없습니다(23.0 이상이 필요합니다).",
          { recoverable: false },
        );
      }
      returned = await (merge as () => Promise<unknown>).call(first);
    } catch (error) {
      if (error instanceof DispatchError) {
        throw error;
      }
      throw new DispatchError(
        "COMMAND_FAILED",
        `레이어를 합치지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )} 숨긴 레이어이거나 잠긴 레이어일 수 있습니다 — photoshop.layer.get 으로 확인하세요.`,
        { recoverable: true, details: { merged: mergedIds, before } },
      );
    }

    const afterLayers = flattenLayers(document.layers);
    const after = afterLayers.length;

    /* **아무 일도 안 일어났으면 실패로 답한다.** `merge_visible` 이 숨긴
     * 활성 레이어에서 조용히 지나갔다(§40). 성공으로 보고하면 호출자는
     * 합쳐진 줄 안다. */
    if (after === before) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "합쳐지지 않았습니다 — 레이어 수가 그대로입니다. " +
          "숨긴 레이어나 잠긴 레이어는 합쳐지지 않습니다. photoshop.layer.get 으로 확인하세요.",
        { recoverable: true, details: { merged: mergedIds, before, after } },
      );
    }

    /* **결과 레이어를 네 갈래로 찾는다.**
     *
     * `merge()` 가 돌려주는 객체를 먼저 쓰되 **믿지는 않는다** — 이 프로젝트가
     * `duplicate()` 에서 `id: undefined` 를 겪었다(`duplicated-document.ts`).
     * 실제로 열려 있는지 확인하고 아니면 목록으로 좁힌다.
     *
     * 아래로 병합이면 남는 것이 **바로 밑 레이어**라 대상 목록에도 새 id 에도
     * 없다 — 실기에서 이것 때문에 "확인하지 못했습니다" 로 끝났다(§46). */
    const returnedId = (returned as { id?: unknown } | null | undefined)?.id;
    const fromReturn =
      typeof returnedId === "number"
        ? afterLayers.find((entry) => entry.id === returnedId)
        : undefined;
    const survivor = afterLayers.find((entry) => mergedIds.includes(entry.id));
    const appeared = afterLayers.filter((entry) => !beforeIds.has(entry.id));
    const neighbour =
      below === undefined ? undefined : afterLayers.find((entry) => entry.id === below.id);
    const resolved =
      fromReturn ?? survivor ?? (appeared.length === 1 ? appeared[0] : undefined) ?? neighbour;

    if (resolved === undefined) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "합쳤지만 결과 레이어를 확인하지 못했습니다. photoshop.layer.list 로 확인하세요.",
        { recoverable: true, details: { merged: mergedIds, before, after } },
      );
    }

    return {
      layer: (await withMaskStateAsync([resolved]))[0] as LayerInfo,
      merged: mergedIds,
      before,
      after,
      removed: before - after,
      mergedDown,
    };
  });
}
