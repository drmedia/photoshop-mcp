import { app, type PhotoshopDocument, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers, toLayerInfo } from "./layers.js";
import { resolveMutatedLayer } from "./mutation-result.js";
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
  const id = readId(layer);
  if (id === null) {
    // 참조가 무효가 되었다. Photoshop 이 레이어를 갈아치웠다는 뜻이고, 그 말은
    // **변경이 이미 일어났다**는 뜻이다. Photoshop 의 원문
    // ("The 레이어 with an id of 1 does not exist.") 를 그대로 올리면 호출자가
    // 아무 일도 없었다고 오해한다. 무엇을 해야 하는지 말해 준다.
    throw new DispatchError(
      "COMMAND_FAILED",
      "변경은 적용되었지만 결과 레이어를 확인하지 못했습니다. " +
        "Photoshop 이 레이어를 교체했을 수 있습니다 — layer.list 로 확인하세요.",
      { recoverable: true },
    );
  }
  const found = flattenLayers(document.layers).find((entry) => entry.id === id);
  return found ?? toLayerInfo(layer);
}

/**
 * 변경 → 결과 읽기를 한 번에 한다.
 *
 * 변경 **전에** id 목록을 떠 두는 것이 핵심이다. Photoshop 이 레이어 객체를 갈아치우면
 * (배경 레이어에 불투명도를 주는 경우) 변경 뒤에는 원래 참조를 읽을 수조차 없다.
 * 그때 예외가 올라가면 변경은 일어났는데 실패로 보고된다. 실기에서 그렇게 틀렸다.
 * 자세한 것은 `resolveMutatedLayer` 의 주석에 있다.
 */
export function mutate(
  document: PhotoshopDocument,
  layer: PhotoshopLayer,
  apply: (layer: PhotoshopLayer) => void,
): LayerInfo {
  const before = flattenLayers(document.layers);
  // id 는 변경 전에 읽어 둔다. 변경 뒤에는 읽다가 던질 수 있다.
  const originalId = readId(layer);

  apply(layer);

  const after = flattenLayers(document.layers);
  const resolved = resolveMutatedLayer(
    before.map((entry) => entry.id),
    after,
    originalId,
  );
  if (resolved !== null) {
    return resolved;
  }

  // 어느 레이어가 되었는지 알 수 없다. 변경은 일어났으므로 실패로 만들지 않는다 —
  // 실패로 보고하면 호출자가 되돌리려다 더 망친다.
  throw new DispatchError(
    "COMMAND_FAILED",
    "변경은 적용되었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
    { recoverable: true, details: { originalId } },
  );
}

/** 무효가 된 참조는 id 조차 읽을 수 없다. 읽히지 않으면 `null`. */
function readId(layer: PhotoshopLayer): number | null {
  try {
    const id = layer.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
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
    return mutate(document, layer, (target) => {
      target.name = params.name;
    });
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
    return mutate(document, layer, (target) => {
      target.visible = params.visible;
    });
  });
}

export async function layerOpacity(params: TargetParams & { opacity: number }): Promise<LayerInfo> {
  return runModal("Set layer opacity", () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    // 배경 레이어에 불투명도를 주면 Photoshop 이 일반 레이어로 승격시키고 id 를 바꾼다.
    return mutate(document, layer, (target) => {
      target.opacity = params.opacity;
    });
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
