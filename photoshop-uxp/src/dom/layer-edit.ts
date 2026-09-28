import { app, type PhotoshopDocument, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers, toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { opacityApplied, resolveMutatedLayer } from "./mutation-result.js";
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
export async function mutate(
  document: PhotoshopDocument,
  layer: PhotoshopLayer,
  apply: (layer: PhotoshopLayer) => void,
): Promise<LayerInfo> {
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
    // **마스크 상태를 함께 담는다.** `layer.list` 는 담는데 편집 결과가 안 담으면
    // 같은 레이어에 대해 답이 둘이 된다 — 호출자는 마스크가 사라졌다고 읽는다.
    // 실기에서 set_opacity 뒤에 그렇게 보였다.
    return (await withMaskStateAsync([resolved]))[0] as LayerInfo;
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
  return runModal("Rename layer", async () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    return await mutate(document, layer, (target) => {
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
  return runModal("Set layer visibility", async () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    return await mutate(document, layer, (target) => {
      target.visible = params.visible;
    });
  });
}

export async function layerOpacity(params: TargetParams & { opacity: number }): Promise<LayerInfo> {
  return runModal("Set layer opacity", async () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    // 배경 레이어에 불투명도를 주면 Photoshop 이 일반 레이어로 승격시키고 id 를 바꾼다.
    const result = await mutate(document, layer, (target) => {
      target.opacity = params.opacity;
    });

    // **쓴 값이 실제로 들어갔는지 확인한다.**
    //
    // 배경 레이어는 조건에 따라 대입을 조용히 무시한다 — 예외도 없고 값도 그대로다.
    // 실기에서 레이어가 둘 이상인 문서의 배경에 60 을 넣었더니 100 그대로였다.
    // 그런데도 성공으로 보고하면 호출자는 60 이 되었다고 믿는다. 반환값에 100 이
    // 담겨 있어도 성공 신호를 먼저 읽는다.
    //
    // 비교 규칙은 `opacityApplied` 에 있다 — Photoshop 의 0–255 저장 때문에
    // 정확히 비교하면 오탐이 난다.
    if (!opacityApplied(params.opacity, result.opacity)) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `불투명도가 적용되지 않았습니다 — 요청 ${params.opacity}, 실제 ${result.opacity}. ` +
          (result.isBackground === true
            ? "배경 레이어라서 Photoshop 이 거부했습니다. layer.duplicate 로 복제본을 만들어 쓰세요."
            : "Photoshop 이 이 레이어의 불투명도를 바꾸지 않았습니다."),
        {
          recoverable: true,
          details: { requested: params.opacity, actual: result.opacity, layer: result },
        },
      );
    }
    return result;
  });
}

/**
 * `LAYER_FILL_OPACITY` — 칠 불투명도. (CORE_API §5 P1)
 *
 * ## `opacity` 와 다르다
 *
 * `opacity` 는 레이어 전체(효과 포함)를 투명하게 하고, `fillOpacity` 는 **픽셀만**
 * 투명하게 하며 레이어 스타일은 그대로 남긴다. Adobe 레퍼런스가 `opacity` 를
 * "master opacity" 라고 부르며 둘을 따로 둔다.
 *
 * ## 읽어서 확인한다
 *
 * `LayerInfo` 에 `fillOpacity` 가 없어 `mutate()` 의 결과만으로는 값이 들어갔는지
 * 알 수 없다. 대입 뒤 **다시 읽는다** — 배경 레이어 `set_opacity` 가 예외 없이
 * 무시되던 전례가 있다(§17.6). 못 읽으면 `null` 이고, 그때는 막지 않는다.
 * 없는 것을 참으로 읽어 멀쩡한 호출을 막는 쪽이 더 나쁘다.
 *
 * ## 배경 레이어는 `opacity` 와 다르게 실패한다
 *
 * 실기에서 두 경우를 다 봤다.
 *
 * ```text
 * 레이어가 둘 이상  →  승격도 없고 값도 그대로 (id 1, 100)
 * 배경이 유일       →  승격만 일어나고 값은 그대로 (id 1 → 6, 100)
 * 승격된 레이어     →  적용된다 (50.196)
 * ```
 *
 * `set_opacity` 는 승격되면 값도 들어갔는데 **이쪽은 승격만 하고 만다.** 그러면
 * 실패를 보고하는데 문서는 이미 바뀐 상태다 — 이 프로젝트에서 가장 나쁜 실패
 * 유형이다. 그래서 **승격 사실과 새 id 를 오류에 담고 다시 부르라고 말한다.**
 *
 * 그리고 배경 여부는 **변경 전에** 읽어 둔다. 변경 뒤에는 승격되어
 * `isBackground` 가 `false` 라서, 그것을 보고 판단하면 원인을 놓친다.
 */
export async function layerFillOpacity(
  params: TargetParams & { fillOpacity: number },
): Promise<{ layer: LayerInfo; fillOpacity: number | null }> {
  return runModal("Set layer fill opacity", async () => {
    const document = requireActiveDocument();
    const layer = resolveLayer(document, params.layerId);
    const targetId = readId(layer);
    /* 변경 **전에** 읽는다. 승격되면 뒤에는 `false` 라 원인을 놓친다. */
    const wasBackground = toLayerInfo(layer).isBackground === true;

    const info = await mutate(document, layer, (target) => {
      (target as unknown as Record<string, unknown>)["fillOpacity"] = params.fillOpacity;
    });

    /* 결과 레이어에서 다시 읽는다. `mutate` 가 찾아 준 id 로 가야 한다 —
     * 원래 참조는 Photoshop 이 레이어를 갈아치웠으면 무효다. */
    const after = findLayerById(document.layers, info.id);
    const actual = readFillOpacity(after);

    if (actual !== null && !opacityApplied(params.fillOpacity, actual)) {
      /* **문서가 이미 바뀌었는지 먼저 말한다.** 승격되면 id 가 달라지는데,
       * 그 사실 없이 실패만 보고하면 호출자는 아무 일도 없었다고 믿는다. */
      const promoted = wasBackground && targetId !== null && info.id !== targetId;
      throw new DispatchError(
        "COMMAND_FAILED",
        `칠 불투명도가 적용되지 않았습니다 — 요청 ${params.fillOpacity}, 실제 ${actual}. ` +
          (promoted
            ? `배경 레이어라서 Photoshop 이 일반 레이어(id ${info.id})로 승격시켰지만 값은 넣지 않았습니다. ` +
              `**문서는 이미 바뀌었습니다.** 같은 요청을 layerId ${info.id} 로 다시 보내면 적용됩니다.`
            : wasBackground
              ? "배경 레이어라서 Photoshop 이 거부했습니다. layer.from_background 로 일반 레이어로 바꾼 뒤 쓰세요."
              : "Photoshop 이 이 레이어의 칠 불투명도를 바꾸지 않았습니다."),
        {
          recoverable: true,
          details: {
            requested: params.fillOpacity,
            actual,
            layerId: targetId,
            promoted,
            layer: info,
          },
        },
      );
    }

    return { layer: info, fillOpacity: actual };
  });
}

/** 못 읽으면 `null`. 던지는 경우도 포함한다 — 무효가 된 참조가 있다. */
function readFillOpacity(layer: PhotoshopLayer | null): number | null {
  if (layer === null) {
    return null;
  }
  try {
    const value = (layer as unknown as Record<string, unknown>)["fillOpacity"];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** 활성 문서의 활성 레이어. 진단용. */
export function activeLayerIds(): number[] {
  const document = app.activeDocument;
  if (document === null || document === undefined) {
    return [];
  }
  return asArray(document.activeLayers).map((layer) => layer.id);
}
