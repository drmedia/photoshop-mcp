import { core, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { requireActiveDocument } from "./document.js";
import { toLayerType } from "./mappings.js";

/**
 * `LAYER_LIST` — 활성 문서의 레이어 목록. (PROTOCOL.md §4)
 *
 * 순서는 Photoshop 의 레이어 순서(위 → 아래)를 따른다.
 * 그룹은 그룹 자신을 먼저 넣고 자식을 이어서 넣는 깊이 우선 순서로 평탄화한다.
 *
 * Parent 는 Phase 3 범위이므로 여기서는 계층 관계를 보고하지 않는다.
 */
export async function layerList(): Promise<LayerInfo[]> {
  return core.executeAsModal(
    async () => {
      const document = requireActiveDocument();
      return flattenLayers(document.layers);
    },
    { commandName: "List layers" },
  );
}

/** 레이어 트리를 깊이 우선으로 평탄화한다. */
export function flattenLayers(layers: readonly PhotoshopLayer[] | undefined): LayerInfo[] {
  const out: LayerInfo[] = [];
  collect(layers, out);
  return out;
}

function collect(layers: readonly PhotoshopLayer[] | undefined, out: LayerInfo[]): void {
  if (layers === undefined) {
    return;
  }
  for (const layer of layers) {
    out.push(toLayerInfo(layer));
    collect(layer.layers, out);
  }
}

export function toLayerInfo(layer: PhotoshopLayer): LayerInfo {
  return {
    id: layer.id,
    name: layer.name,
    type: toLayerType(layer.kind),
    visible: layer.visible === true,
  };
}
