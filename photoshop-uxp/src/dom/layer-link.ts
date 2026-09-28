import type { PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toArray, toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_LINK` · `LAYER_UNLINK` — 레이어 연결. (CORE_API §5)
 *
 * ## 연결은 무엇인가
 *
 * 연결된 레이어들은 **함께 움직이고 함께 변형된다.** `layer.translate` ·
 * `layer.scale` · `layer.rotate` 를 하나에 걸면 연결된 것들이 따라온다.
 * 그룹과 다르다 — 트리 구조가 바뀌지 않고 순서도 그대로다.
 *
 * ## `link` 만 `async` 가 아니다
 *
 * Adobe 레퍼런스가 `link(targetLayer) → Layer[]` 로 적는다. 나머지 변환·편집이
 * 전부 `Promise` 인데 이것만 배열을 바로 돌려준다. **`await` 는 둘 다 받으므로**
 * 그대로 기다린다 — 런타임이 문서와 달라도 깨지지 않는다.
 *
 * ## 상태는 `linkedLayers` 로 읽는다
 *
 * 읽기 전용 속성이다. `layer.get` 도 같은 값을 담으므로 쓰는 쪽과 읽는 쪽의
 * 어휘가 같다 — `set_lock` 과 `locked` 를 맞춘 것과 같은 자리다(§43).
 *
 * **레퍼런스의 `link` 예제는 자기 자신을 포함한 목록을 찍는다.**
 *
 * ```text
 * strokes.link(fillLayer)  →  "strokes" · "fillLayer"
 * ```
 *
 * **`linkedLayers` 속성은 다르다 — 자기 자신이 없다.** 실기에서 확인했다
 * (ROADMAP §48). `link()` 의 반환값과 출처가 다르다는 뜻이고, 그래서 이
 * Command 는 **반환값을 쓰지 않고 속성을 읽는다** — `layer.get` 과 같은
 * 출처라 두 Tool 이 다른 말을 하지 않는다.
 *
 * 연결은 **대칭이고 전이적**이다. A-B 를 묶고 A-C 를 묶으면 B 가 `[A, C]` 를
 * 본다. `unlink` 는 **그 레이어만** 집합에서 뺀다.
 */

export interface LayerLinkResult {
  layer: LayerInfo;
  /** 연결된 레이어의 id. **읽은 값**이고 요청을 되풀이한 것이 아니다. */
  linked: number[];
}

/** `linkedLayers` 를 읽는다. 속성 접근 자체가 던질 수 있다. */
export function readLinkedIds(layer: PhotoshopLayer): number[] {
  try {
    const raw = (layer as unknown as Record<string, unknown>)["linkedLayers"];
    return toArray<{ id?: unknown }>(raw)
      .map((entry) => entry.id)
      .filter((id): id is number => typeof id === "number");
  } catch {
    return [];
  }
}

function resolve(
  document: ReturnType<typeof requireActiveDocument>,
  layerId: number | undefined,
): PhotoshopLayer {
  const found =
    layerId === undefined ? document.activeLayers[0] : findLayerById(document.layers, layerId);
  if (found === undefined || found === null) {
    throw new DispatchError(
      "LAYER_NOT_FOUND",
      layerId === undefined
        ? "활성 레이어가 없습니다."
        : `레이어 ${String(layerId)} 를 찾을 수 없습니다.`,
      { recoverable: true, details: { layerId } },
    );
  }
  return found as PhotoshopLayer;
}

export async function layerLink(params: {
  layerId?: number;
  targetId: number;
}): Promise<LayerLinkResult> {
  return runModal("Link layers", async () => {
    const document = requireActiveDocument();
    const layer = resolve(document, params.layerId);

    /* **자기 자신과는 연결할 수 없다.** 통과시키면 Photoshop 이 무엇을 하는지
     * 알 수 없고, 되든 안 되든 호출자가 얻는 것이 없다. */
    if (layer.id === params.targetId) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${String(params.targetId)} 를 자기 자신과 연결할 수 없습니다.`,
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    const target = findLayerById(document.layers, params.targetId);
    if (target === null || target === undefined) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        `연결 대상 레이어 ${String(params.targetId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { targetId: params.targetId } },
      );
    }

    const link = (layer as unknown as Record<string, unknown>)["link"];
    if (typeof link !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 Layer.link 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    try {
      /* **`await` 가 둘 다 받는다.** 레퍼런스는 `Layer[]` 를 바로 돌려준다고
       * 적지만, 런타임이 `Promise` 여도 이 한 줄이 그대로 동작한다. */
      await (link as (...args: unknown[]) => unknown).call(layer, target);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `레이어를 연결하지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { layerId: layer.id, targetId: params.targetId } },
      );
    }

    /* **돌려받은 배열을 쓰지 않고 속성을 읽는다.** 이 프로젝트는 반환값을
     * 믿지 않는다(`duplicate()` 의 `id: undefined`). `linkedLayers` 가
     * `layer.get` 과 같은 출처라 두 Tool 이 다른 말을 하지 않는다. */
    const linked = readLinkedIds(layer);
    if (!linked.includes(params.targetId)) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `연결되지 않았습니다 — 레이어 ${String(params.targetId)} 가 연결 목록에 없습니다.`,
        { recoverable: true, details: { linked, targetId: params.targetId } },
      );
    }

    return {
      layer: (await withMaskStateAsync([toLayerInfo(layer)]))[0] as LayerInfo,
      linked,
    };
  });
}

export async function layerUnlink(params: { layerId?: number }): Promise<LayerLinkResult> {
  return runModal("Unlink layer", async () => {
    const document = requireActiveDocument();
    const layer = resolve(document, params.layerId);

    const unlink = (layer as unknown as Record<string, unknown>)["unlink"];
    if (typeof unlink !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 Layer.unlink 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    try {
      await (unlink as () => Promise<void>).call(layer);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `연결을 끊지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    /* 끊겼는지 읽어서 확인한다. 연결이 없던 레이어에 불러도 오류가 아니다 —
     * 결과가 빈 목록이면 그것으로 충분하다. */
    return {
      layer: (await withMaskStateAsync([toLayerInfo(layer)]))[0] as LayerInfo,
      linked: readLinkedIds(layer),
    };
  });
}
