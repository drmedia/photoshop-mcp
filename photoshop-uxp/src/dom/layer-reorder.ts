import { constants, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * 레이어 순서 변경. (ROADMAP §17.23)
 *
 * ## 형제 목록으로 위치를 센다
 *
 * `flattenLayers` 는 깊이 우선으로 평탄화하므로 그 배열의 인덱스는 "몇 번째
 * 형제인가" 가 아니다. 같은 `parentId` 를 가진 것만 걸러야 한다.
 *
 * ## 옮겼다고 말하기 전에 확인한다
 *
 * `move` 가 던지지 않았다고 옮겨진 것은 아니다. 배경 레이어는 맨 아래에
 * 고정이고, Photoshop 은 그런 요청을 조용히 넘길 수 있다. 옮긴 뒤 형제 목록을
 * 다시 읽어 실제 인덱스를 돌려준다.
 */

type Placement = "top" | "bottom" | "up" | "down" | "above" | "below";

/** 같은 부모를 가진 레이어들. Photoshop 순서(위 → 아래) 그대로다. */
function siblingsOf(all: LayerInfo[], parentId: number | null): LayerInfo[] {
  return all.filter((entry) => (entry.parentId ?? null) === parentId);
}

function indexOf(siblings: LayerInfo[], layerId: number): number {
  return siblings.findIndex((entry) => entry.id === layerId);
}

export async function layerReorder(params: {
  layerId: number;
  placement: Placement;
  referenceId?: number;
}): Promise<{
  layer: LayerInfo;
  moved: boolean;
  previousIndex: number;
  index: number;
  siblings: number;
}> {
  return runModal("Reorder layer", async () => {
    const document = requireActiveDocument();
    const target = findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError("LAYER_NOT_FOUND", `레이어 ${params.layerId} 를 찾을 수 없습니다.`, {
        recoverable: true,
        details: { layerId: params.layerId },
      });
    }

    const before = flattenLayers(document.layers);
    const info = before.find((entry) => entry.id === params.layerId);
    if (info === undefined) {
      throw new DispatchError("LAYER_NOT_FOUND", "대상 레이어를 확인하지 못했습니다.", {
        recoverable: true,
      });
    }

    const parentId = info.parentId ?? null;
    const siblings = siblingsOf(before, parentId);
    const previousIndex = indexOf(siblings, params.layerId);

    // 기준과 놓을 방향을 정한다. `null` 이면 옮길 곳이 없다는 뜻이다.
    let anchorId: number | null = null;
    let placeBefore = true;

    switch (params.placement) {
      case "top": {
        const first = siblings[0];
        if (first !== undefined && first.id !== params.layerId) {
          anchorId = first.id;
          placeBefore = true;
        }
        break;
      }
      case "bottom": {
        const last = siblings[siblings.length - 1];
        if (last !== undefined && last.id !== params.layerId) {
          anchorId = last.id;
          placeBefore = false;
        }
        break;
      }
      case "up": {
        const above = siblings[previousIndex - 1];
        if (above !== undefined) {
          anchorId = above.id;
          placeBefore = true;
        }
        break;
      }
      case "down": {
        const below = siblings[previousIndex + 1];
        if (below !== undefined) {
          anchorId = below.id;
          placeBefore = false;
        }
        break;
      }
      case "above":
      case "below": {
        // 스키마가 referenceId 를 보장하지만, 없는 레이어를 가리킬 수는 있다.
        const referenceId = params.referenceId as number;
        if (before.find((entry) => entry.id === referenceId) === undefined) {
          throw new DispatchError(
            "LAYER_NOT_FOUND",
            `기준 레이어 ${referenceId} 를 찾을 수 없습니다.`,
            { recoverable: true, details: { referenceId } },
          );
        }
        anchorId = referenceId;
        placeBefore = params.placement === "above";
        break;
      }
    }

    if (anchorId === null) {
      // 이미 그 자리다. 실패가 아니라 할 일이 없었던 것이다.
      return {
        layer: (await withMaskStateAsync([info]))[0] as LayerInfo,
        moved: false,
        previousIndex,
        index: previousIndex,
        siblings: siblings.length,
      };
    }

    const anchor = findLayerById(document.layers, anchorId);
    if (anchor === undefined || anchor === null) {
      throw new DispatchError("LAYER_NOT_FOUND", `기준 레이어 ${anchorId} 를 찾을 수 없습니다.`, {
        recoverable: true,
        details: { anchorId },
      });
    }

    await (target as PhotoshopLayer).move(
      anchor,
      placeBefore ? constants.ElementPlacement.PLACEBEFORE : constants.ElementPlacement.PLACEAFTER,
    );

    // **요청이 아니라 결과를 읽는다.** 배경 레이어처럼 움직이지 않는 것이 있다.
    const after = flattenLayers(requireActiveDocument().layers);
    const moved = after.find((entry) => entry.id === params.layerId);
    if (moved === undefined) {
      throw new DispatchError("COMMAND_FAILED", "옮긴 뒤 레이어를 찾지 못했습니다.", {
        details: { layerId: params.layerId },
      });
    }
    const afterSiblings = siblingsOf(after, moved.parentId ?? null);
    const index = indexOf(afterSiblings, params.layerId);

    return {
      layer: (await withMaskStateAsync([moved]))[0] as LayerInfo,
      // 부모가 바뀌었어도 움직인 것이다.
      moved: index !== previousIndex || (moved.parentId ?? null) !== parentId,
      previousIndex,
      index,
      siblings: afterSiblings.length,
    };
  });
}
