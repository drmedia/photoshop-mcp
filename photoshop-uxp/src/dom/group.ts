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
 *
 * ## 만든 자리를 확인한다 (ROADMAP §17.20)
 *
 * `createLayerGroup` 은 **활성 레이어가 있는 곳**에 만든다. 활성 레이어가 어느
 * 그룹 안이면 새 그룹도 그 안에 들어간다. 실기에서 이것이 조용히 연쇄를 만들어
 * 마지막 조정 레이어가 세 겹 마스크에 갇혔다.
 *
 * 그래서 만든 **뒤에 위치를 읽어** 요청과 다르면 옮기고, 옮긴 결과를 다시 읽어
 * 확인한다. 요청대로 됐다고 말하기 전에 실제로 그런지 본다.
 */

/** 그룹을 원하는 부모 밑으로 옮긴다. 이미 그 자리면 아무것도 하지 않는다. */
async function placeGroup(
  document: ReturnType<typeof requireActiveDocument>,
  group: PhotoshopLayer,
  parentId: number | null,
): Promise<void> {
  const current = describeLayer(document, group).parentId ?? null;
  if (current === parentId) {
    return;
  }

  if (parentId === null) {
    const anchor = topLevelAnchor(document.layers, group.id);
    if (anchor === null) {
      // 최상위에 다른 레이어가 없으면 이미 최상위다.
      return;
    }
    await group.move(anchor, constants.ElementPlacement.PLACEBEFORE);
  } else {
    // 호출부가 만들기 전에 이미 확인했다. 여기까지 오면 그 사이에 사라진 것이다.
    const parent = findLayerById(document.layers, parentId);
    if (parent === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `그룹 ${parentId} 가 사라졌습니다. 그룹은 만들어졌지만 옮기지 못했습니다.`,
        { details: { parentId } },
      );
    }
    await group.move(parent, constants.ElementPlacement.PLACEINSIDE);
  }

  // **옮겼다고 말하기 전에 확인한다.** move 가 던지지 않았다고 옮겨진 것은 아니다.
  const after = describeLayer(requireActiveDocument(), group).parentId ?? null;
  if (after !== parentId) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `그룹을 요청한 자리로 옮기지 못했습니다. 요청 parentId ${String(parentId)}, ` +
        `실제 ${String(after)}. 그룹은 만들어졌습니다.`,
      { details: { requested: parentId, actual: after, groupId: group.id } },
    );
  }
}

export async function groupCreate(params: {
  name?: string;
  layerIds?: number[];
  parentId?: number | null;
}): Promise<LayerInfo> {
  return runModal("Create layer group", async () => {
    const document = requireActiveDocument();

    // **만들기 전에 부모를 확인한다.** (ROADMAP §17.20)
    //
    // 실기에서 없는 id 를 줬더니 오류를 돌려주면서 그룹은 남아 있었다.
    // 안 했다고 말하고 뭔가를 하는 것이 가장 나쁜 실패다.
    if (params.parentId !== undefined && params.parentId !== null) {
      if (findLayerById(document.layers, params.parentId) === null) {
        throw new DispatchError("LAYER_NOT_FOUND", `그룹 ${params.parentId} 를 찾을 수 없습니다.`, {
          recoverable: true,
          details: { parentId: params.parentId },
        });
      }
    }

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

    // 레이어를 묶을 때는 그 레이어들이 있던 자리가 맞다. 옮기지 않는다.
    if (fromLayers === undefined) {
      await placeGroup(document, group, params.parentId ?? null);
    }

    return describeLayer(requireActiveDocument(), group);
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
