import { type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { requireActiveDocument } from "./document.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_LIST` — 활성 문서의 레이어 목록. (PROTOCOL.md §4)
 *
 * 순서는 Photoshop 의 레이어 순서(위 → 아래)를 따른다.
 * 그룹은 그룹 자신을 먼저 넣고 자식을 이어서 넣는 깊이 우선 순서로 평탄화한다.
 *
 * Parent 는 Phase 3 범위이므로 여기서는 계층 관계를 보고하지 않는다.
 */
export async function layerList(): Promise<LayerInfo[]> {
  return runModal("List layers", () => flattenLayers(requireActiveDocument().layers));
}

/** 레이어 트리를 깊이 우선으로 평탄화한다. */
export function flattenLayers(layers: unknown): LayerInfo[] {
  const out: LayerInfo[] = [];
  collect(layers, out);
  return out;
}

function collect(layers: unknown, out: LayerInfo[]): void {
  for (const layer of toArray<PhotoshopLayer>(layers)) {
    out.push(toLayerInfo(layer));
    collect(layer.layers, out);
  }
}

/**
 * Photoshop 의 레이어 컬렉션을 배열로 바꾼다.
 *
 * `Document.layers` 는 실제로 배열이 아니라 배열 유사 컬렉션이다.
 * 그대로 `for...of` 하면 `TypeError: layers is not iterable` 이 발생한다.
 */
function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }
  if (value === null || value === undefined) {
    return [];
  }
  const collection = value as { length?: unknown; [index: number]: T };
  if (typeof collection.length === "number") {
    const out: T[] = [];
    for (let i = 0; i < collection.length; i += 1) {
      const item = collection[i];
      if (item !== undefined) {
        out.push(item);
      }
    }
    return out;
  }
  return [];
}

export function toLayerInfo(layer: PhotoshopLayer): LayerInfo {
  return {
    id: layer.id,
    name: layer.name,
    type: toLayerType(layer.kind),
    visible: layer.visible === true,
  };
}
