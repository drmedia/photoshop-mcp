import type { PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_SET_LOCK` — 레이어 잠금. (CORE_API §5 P2)
 *
 * ## 넷이 독립 플래그가 아니다 — 재서 알았다
 *
 * Adobe 레퍼런스는 `allLocked` · `pixelsLocked` · `positionLocked` ·
 * `transparentPixelsLocked` 를 **각각 읽기/쓰기 불린**으로 적는다. 실기는
 * 다르다 — **하나를 쓰면 나머지가 전부 지워진다.**
 *
 * ```text
 * pixels true              →  pixels true, 나머지 false
 * 그 뒤 position true      →  position true, pixels **false**
 * 그 뒤 transparent true   →  transparent true, position **false**
 * 그 뒤 all false          →  전부 false
 * ```
 *
 * 그래서 **한 번에 하나만 걸 수 있다.** 처음에는 네 불린을 받는 Tool 로
 * 만들었는데, 그러면 `pixels` 와 `position` 을 함께 달라는 **절대 성공할 수
 * 없는 요청**을 받아들이게 된다. 단일 값으로 바꿨다. (ROADMAP §43)
 *
 * `none` 이 "전부 풀기" 다 — `allLocked = false` 가 그 일을 한다.
 *
 * ## 배경 레이어는 예외다
 *
 * 배경은 `position` 과 `transparentPixels` 를 **동시에** 갖는다. 이 설정기로는
 * 도달할 수 없는 상태이고 풀 수도 없다 — 대입이 조용히 무시된다. 그래서
 * 결과의 `locks` 는 다섯을 **그대로 읽어** 돌려준다. 단일 값으로 요약하면
 * 배경의 실제 상태를 말할 수 없다.
 *
 * ## 참조가 무효가 될 수 있다
 *
 * 실기에서 배경의 `positionLocked` 를 풀려다
 * `The 레이어 with an id of undefined does not exist.` 를 만났다. 그래서
 * **id 를 미리 떠 두고 뒤에 다시 찾는다** — `mutate()` 가 있는 이유다.
 */

/** 다섯 잠금 상태. 못 읽은 것은 `null` 이다 — `false` 로 덮지 않는다. */
export interface LockState {
  /** `locked`. **읽기 전용** — 무엇이든 잠겼는가. */
  any: boolean | null;
  all: boolean | null;
  pixels: boolean | null;
  position: boolean | null;
  transparentPixels: boolean | null;
}

export interface LayerSetLockResult {
  layer: LayerInfo;
  /** 건 뒤에 **읽은** 다섯 값. 요청을 되풀이한 것이 아니다. */
  locks: LockState;
  /** 요청한 잠금이 실제로 걸렸는가. 못 읽었으면 `false` 다. */
  applied: boolean;
}

/** Tool 값 → 쓸 속성과 넣을 값. `none` 은 `allLocked = false` 다. */
const LOCK_WRITES = {
  none: { property: "allLocked", value: false },
  all: { property: "allLocked", value: true },
  pixels: { property: "pixelsLocked", value: true },
  position: { property: "positionLocked", value: true },
  transparentPixels: { property: "transparentPixelsLocked", value: true },
} as const;

export type LockName = keyof typeof LOCK_WRITES;

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * 잠금 다섯을 읽는다.
 *
 * **속성 접근 자체가 던질 수 있다.** 무효가 된 참조는
 * `The 레이어 with an id of undefined does not exist.` 를 낸다. 던지면 전부
 * `null` 이다 — 못 읽은 것을 `false` 로 덮지 않는다.
 */
export function readLocks(layer: PhotoshopLayer): LockState {
  try {
    const raw = layer as unknown as Record<string, unknown>;
    return {
      any: flag(raw["locked"]),
      all: flag(raw["allLocked"]),
      pixels: flag(raw["pixelsLocked"]),
      position: flag(raw["positionLocked"]),
      transparentPixels: flag(raw["transparentPixelsLocked"]),
    };
  } catch {
    return { any: null, all: null, pixels: null, position: null, transparentPixels: null };
  }
}

/** 무효가 된 참조는 id 조차 읽을 수 없다. */
function readId(layer: PhotoshopLayer): number | null {
  try {
    const id = layer.id;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

/** 요청한 잠금이 걸렸는지. 못 읽었으면 `false`. */
function matches(lock: LockName, locks: LockState): boolean {
  if (lock === "none") {
    return locks.any === false;
  }
  return locks[lock] === true;
}

export async function layerSetLock(params: {
  layerId?: number;
  lock: LockName;
}): Promise<LayerSetLockResult> {
  return runModal("Set layer lock", async () => {
    const document = requireActiveDocument();
    const found =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);

    if (found === undefined || found === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${String(params.layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const layer = found as PhotoshopLayer;
    /* **id 를 변경 전에 읽어 둔다.** Photoshop 이 레이어 객체를 갈아치우면
     * 뒤에는 읽을 수조차 없다 — `mutate()` 가 있는 이유다. */
    const originalId = readId(layer);
    const wasBackground = toLayerInfo(layer).isBackground === true;
    const write = LOCK_WRITES[params.lock];

    try {
      (layer as unknown as Record<string, unknown>)[write.property] = write.value;
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `${write.property} 를 바꾸지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}` +
          (wasBackground
            ? " 배경 레이어는 위치와 투명 영역이 태생적으로 잠겨 있어 풀 수 없습니다 — " +
              "photoshop.layer.from_background 로 일반 레이어로 바꾼 뒤 쓰세요."
            : ""),
        { recoverable: true, details: { lock: params.lock } },
      );
    }

    /* **원래 참조를 다시 쓰지 않는다.** id 로 새로 찾는다. */
    const fresh =
      originalId === null
        ? null
        : (findLayerById(document.layers, originalId) as PhotoshopLayer | null);
    if (fresh === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "잠금은 바뀌었을 수 있으나 결과 레이어를 확인하지 못했습니다. " +
          "photoshop.layer.list 로 확인하세요 — Photoshop 이 레이어를 교체했을 수 있습니다.",
        { recoverable: true, details: { layerId: originalId, lock: params.lock } },
      );
    }

    const locks = readLocks(fresh);
    const info = (await withMaskStateAsync([toLayerInfo(fresh)]))[0] as LayerInfo;
    const applied = matches(params.lock, locks);

    if (!applied) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `잠금 ${params.lock} 이 적용되지 않았습니다.` +
          (info.isBackground === true
            ? " 배경 레이어는 위치와 투명 영역이 태생적으로 잠겨 있고 풀 수 없습니다 — " +
              "photoshop.layer.from_background 로 일반 레이어로 바꾼 뒤 쓰세요."
            : " 결과의 locks 로 실제 상태를 확인하세요."),
        { recoverable: true, details: { locks, lock: params.lock } },
      );
    }

    return { layer: info, locks, applied };
  });
}
