import { app, type PhotoshopDocument, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers, toLayerInfo } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * Phase 3 레이어 편집. (ROADMAP §7.1)
 *
 * 전부 비파괴 작업이다. 삭제·병합은 이 모듈에 넣지 않는다. (ROADMAP §7.4)
 *
 * Photoshop 상태를 바꾸므로 반드시 `runModal` 안에서 수행한다. (ARCHITECTURE §13)
 */

export interface TargetParams {
  layerId?: number;
}

/**
 * 대상 레이어를 찾는다.
 *
 * `layerId` 를 주면 그 레이어를, 생략하면 활성 레이어를 돌려준다.
 * 활성 레이어가 여러 개면 첫 번째를 쓴다.
 */
function resolveLayer(document: PhotoshopDocument, layerId?: number): PhotoshopLayer {
  if (layerId === undefined) {
    const active = document.activeLayers;
    const first = active === undefined ? undefined : active[0];
    if (first === undefined) {
      throw new DispatchError("LAYER_NOT_FOUND", "활성 레이어가 없습니다.", { recoverable: true });
    }
    return first;
  }

  const found = findLayerById(document.layers, layerId);
  if (found === null) {
    throw new DispatchError("LAYER_NOT_FOUND", `레이어 ${layerId} 를 찾을 수 없습니다.`, {
      recoverable: true,
      details: { layerId },
    });
  }
  return found;
}

/** 레이어 트리에서 id 로 찾는다. 그룹 안쪽까지 내려간다. */
export function findLayerById(layers: unknown, layerId: number): PhotoshopLayer | null {
  for (const layer of asArray(layers)) {
    if (layer.id === layerId) {
      return layer;
    }
    const inner = findLayerById(layer.layers, layerId);
    if (inner !== null) {
      return inner;
    }
  }
  return null;
}

function asArray(value: unknown): PhotoshopLayer[] {
  if (Array.isArray(value)) {
    return value as PhotoshopLayer[];
  }
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

/**
 * 변경 후 상태를 프로토콜 형태로 돌려준다.
 *
 * `parentId` 는 트리 순회로만 알 수 있으므로 전체 목록에서 해당 레이어를 찾아 쓴다.
 * 편집 Command 는 호출 빈도가 낮아 이 비용은 받아들일 만하다.
 */
export function describeLayer(document: PhotoshopDocument, layer: PhotoshopLayer): LayerInfo {
  const found = flattenLayers(document.layers).find((entry) => entry.id === layer.id);
  return found ?? toLayerInfo(layer);
}

export async function layerCreate(params: { name?: string }): Promise<LayerInfo> {
  // createLayer 는 Promise 를 돌려준다. 동기로 다루면 Promise 객체의 속성을 읽게 되어
  // id 와 name 이 undefined 인 결과가 나간다.
  return runModal("Create layer", async () => {
    const document = requireActiveDocument();
    const created = await (params.name === undefined
      ? document.createLayer()
      : document.createLayer({ name: params.name }));
    return describeLayer(document, created);
  });
}

export async function layerDuplicate(params: TargetParams & { name?: string }): Promise<LayerInfo> {
  // duplicate 도 Promise 를 돌려준다.
  return runModal("Duplicate layer", async () => {
    const document = requireActiveDocument();
    const source = resolveLayer(document, params.layerId);
    const copy = await source.duplicate();
    if (params.name !== undefined) {
      copy.name = params.name;
    }
    return describeLayer(document, copy);
  });
}

export async function layerRename(params: TargetParams & { name: string }): Promise<LayerInfo> {
  return runModal("Rename layer", () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    layer.name = params.name;
    return describeLayer(document, layer);
  });
}

export async function layerSelect(params: { layerId: number }): Promise<LayerInfo> {
  return runModal("Select layer", () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    document.activeLayers = [layer];
    return describeLayer(document, layer);
  });
}

export async function layerVisibility(
  params: TargetParams & { visible: boolean },
): Promise<LayerInfo> {
  return runModal("Set layer visibility", () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    layer.visible = params.visible;
    return describeLayer(document, layer);
  });
}

export async function layerOpacity(params: TargetParams & { opacity: number }): Promise<LayerInfo> {
  return runModal("Set layer opacity", () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    layer.opacity = params.opacity;
    return describeLayer(document, layer);
  });
}

/** 활성 문서의 활성 레이어. 진단용. */
export function activeLayerIds(): number[] {
  const document = app.activeDocument;
  if (document === null || document === undefined) {
    return [];
  }
  return asArray(document.activeLayers).map((layer) => layer.id);
}
