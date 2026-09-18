import { constants, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { describeLayer, findLayerById } from "./layer-edit.js";
import { runModal } from "./modal.js";

/**
 * Phase 3 그룹 작업. (ROADMAP §7.2)
 *
 * 그룹 해제는 넣지 않는다. 자식 레이어의 위치를 바꾸는 구조 변경이라
 * Permission System 과 함께 검토한다. (ROADMAP §7.4)
 */

export async function groupCreate(params: {
  name?: string;
  layerIds?: number[];
}): Promise<LayerInfo> {
  return runModal("Create layer group", async () => {
    const document = requireActiveDocument();

    const fromLayers =
      params.layerIds === undefined
        ? undefined
        : params.layerIds.map((layerId) => {
            const layer = findLayerById(document.layers, layerId);
            if (layer === null) {
              throw new DispatchError("LAYER_NOT_FOUND", `레이어 ${layerId} 를 찾을 수 없습니다.`, {
                recoverable: true,
                details: { layerId },
              });
            }
            return layer;
          });

    const options: { name?: string; fromLayers?: PhotoshopLayer[] } = {};
    if (params.name !== undefined) {
      options.name = params.name;
    }
    if (fromLayers !== undefined) {
      options.fromLayers = fromLayers;
    }

    // createLayerGroup 은 Promise 를 돌려준다. createLayer / duplicate 와 같다.
    const group = await document.createLayerGroup(options);
    return describeLayer(document, group);
  });
}

/**
 * 최상위에서 기준으로 삼을 레이어를 고른다.
 *
 * 옮기려는 레이어 자신은 제외한다. 자기 자신 앞으로 옮기는 것은 의미가 없다.
 */
function topLevelAnchor(layers: unknown, excludeId: number): PhotoshopLayer | null {
  const top = Array.isArray(layers) ? (layers as PhotoshopLayer[]) : readCollection(layers);
  for (const layer of top) {
    if (layer.id !== excludeId) {
      return layer;
    }
  }
  return null;
}

function readCollection(value: unknown): PhotoshopLayer[] {
  if (value === null || value === undefined) {
    return [];
  }
  const collection = value as { length?: unknown; [index: number]: PhotoshopLayer };
  if (typeof collection.length !== "number") {
    return [];
  }
  const out: PhotoshopLayer[] = [];
  for (let i = 0; i < collection.length; i += 1) {
    const item = collection[i];
    if (item !== undefined) {
      out.push(item);
    }
  }
  return out;
}

export async function groupMoveLayer(params: {
  layerId: number;
  groupId: number | null;
}): Promise<LayerInfo> {
  return runModal("Move layer", async () => {
    const document = requireActiveDocument();

    const layer = findLayerById(document.layers, params.layerId);
    if (layer === null) {
      throw new DispatchError("LAYER_NOT_FOUND", `레이어 ${params.layerId} 를 찾을 수 없습니다.`, {
        recoverable: true,
        details: { layerId: params.layerId },
      });
    }

    if (params.groupId === null) {
      // 그룹에서 꺼내 최상위로 옮긴다.
      //
      // `move` 의 기준 객체로 Document 를 넘길 수 없다. 실기에서 Photoshop 이
      // "is of type object. Expecting type 레이어" 로 거부했다.
      // 그래서 최상위 레이어를 기준으로 그 앞에 놓는다.
      const anchor = topLevelAnchor(document.layers, layer.id);
      if (anchor === null) {
        throw new DispatchError("COMMAND_FAILED", "최상위로 옮길 기준 레이어를 찾을 수 없습니다.", {
          details: { layerId: params.layerId },
        });
      }
      await layer.move(anchor, constants.ElementPlacement.PLACEBEFORE);
      return describeLayer(document, layer);
    }

    const group = findLayerById(document.layers, params.groupId);
    if (group === null) {
      throw new DispatchError("LAYER_NOT_FOUND", `그룹 ${params.groupId} 를 찾을 수 없습니다.`, {
        recoverable: true,
        details: { groupId: params.groupId },
      });
    }
    if (group.id === layer.id) {
      throw new DispatchError("INVALID_PARAMETER", "레이어를 자기 자신 안으로 옮길 수 없습니다.", {
        details: { layerId: params.layerId },
      });
    }

    await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
    return describeLayer(document, layer);
  });
}
