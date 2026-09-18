import { type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { orderActiveLayers } from "./active-order.js";
import { requireActiveDocument } from "./document.js";
import { toBlendMode, toLayerType } from "./mappings.js";
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

/**
 * 레이어 트리를 깊이 우선으로 평탄화한다.
 *
 * 그룹은 자신을 먼저 넣고 자식을 이어서 넣는다. 자식의 `parentId` 는 순회 중에
 * 알 수 있으므로 Photoshop 의 `layer.parent` 를 조회하지 않는다 —
 * `parent` 는 문서일 수도 그룹일 수도 있어 구분이 번거롭다.
 */
export function flattenLayers(layers: unknown): LayerInfo[] {
  const out: LayerInfo[] = [];
  collect(layers, null, out);
  return out;
}

function collect(layers: unknown, parentId: number | null, out: LayerInfo[]): void {
  for (const layer of toArray<PhotoshopLayer>(layers)) {
    out.push(toLayerInfo(layer, parentId));
    collect(layer.layers, layer.id, out);
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

export function toLayerInfo(layer: PhotoshopLayer, parentId: number | null = null): LayerInfo {
  const kind = toLayerType(layer.kind);
  const blend = toBlendMode(layer.blendMode);
  return {
    id: layer.id,
    name: layer.name,
    type: kind.type,
    visible: layer.visible === true,
    // Photoshop 은 불투명도를 0–255 로 저장해 50 을 넣으면 50.196… 이 돌아온다.
    // 프로토콜은 0–100 정수로 정의하므로 반올림한다.
    opacity: typeof layer.opacity === "number" ? Math.round(layer.opacity) : 100,
    parentId,
    blendMode: blend.blendMode,
    ...(blend.raw === undefined ? {} : { rawBlendMode: blend.raw }),
    ...(kind.raw === undefined ? {} : { rawKind: kind.raw }),
    // Photoshop 이 알려줄 때만 담는다. 이 속성이 없는 UXP 버전에서 false 로 덮으면
    // "배경이 아니다" 라는 틀린 사실을 말하게 된다. (알 수 없는 값을 기본값으로
    // 덮지 않는다는 원칙과 같다)
    ...(typeof layer.isBackgroundLayer === "boolean"
      ? { isBackground: layer.isBackgroundLayer }
      : {}),
  };
}

/**
 * `LAYER_GET_ACTIVE` — 지금 선택된 레이어들.
 *
 * 순서는 `activeLayers` 를 그대로 따르고 `parentId` 만 평탄화 목록에서 가져온다.
 * 왜 그래야 하는지는 `orderActiveLayers` 의 주석에 있다 — 실기에서 한 번 틀렸다.
 *
 * `activeLayers` 의 레이어 객체를 `toLayerInfo` 로 바로 바꾸면 `parentId` 가 `null`
 * 이 된다. 그 값은 트리를 순회하는 중에만 알 수 있기 때문이다. 그러면 그룹 안의
 * 레이어를 골라 둔 사용자가 최상위 레이어라고 보고받는다.
 */
export async function layerGetActive(): Promise<LayerInfo[]> {
  return runModal("Get active layers", () => {
    const document = requireActiveDocument();
    const active = toArray<PhotoshopLayer>(document.activeLayers);
    if (active.length === 0) {
      return [];
    }
    return orderActiveLayers(
      active.map((layer) => layer.id),
      flattenLayers(document.layers),
      active.map((layer) => toLayerInfo(layer)),
    );
  });
}
