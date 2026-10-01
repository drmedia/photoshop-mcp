import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";
import { resolveMutatedLayer } from "./mutation-result.js";

/**
 * Phase 4 필터. (ROADMAP §8.4)
 *
 * **기본은 픽셀에 직접 적용이다.** `asSmartFilter: true` 일 때만 스마트 오브젝트로
 * 변환해 재편집 가능한 스마트 필터로 붙인다. 이유는 `applyFilter` 의 주석에 있다.
 *
 * batchPlay descriptor 는 이 모듈이 검증된 파라미터로 조립한다. (ARCHITECTURE §13, §23)
 */

async function play(commandName: string, descriptor: Record<string, unknown>): Promise<void> {
  const results = await action.batchPlay([descriptor], {});
  const failure = results.find((result) => result["message"] !== undefined);
  if (failure !== undefined) {
    throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
      details: { commandName },
    });
  }
}

/**
 * 필터를 적용한다. 대상 해결 · 스마트 오브젝트 변환 · 결과 확인이 전부 같으므로
 * descriptor 만 바꿔 쓴다.
 */
async function applyFilterCore(
  commandName: string,
  params: { layerId?: number; asSmartFilter?: boolean },
  run: (layer: unknown) => Promise<void>,
): Promise<LayerInfo> {
  return runModal(commandName, async () => {
    const document = requireActiveDocument();

    let target: { id: number; kind: unknown };
    if (params.layerId === undefined) {
      const active = document.activeLayers[0];
      if (active === undefined) {
        throw new DispatchError("LAYER_NOT_FOUND", "활성 레이어가 없습니다.", {
          recoverable: true,
        });
      }
      target = { id: active.id, kind: active.kind };
    } else {
      const layer = findLayerById(document.layers, params.layerId);
      if (layer === null) {
        throw new DispatchError(
          "LAYER_NOT_FOUND",
          `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
          {
            recoverable: true,
            details: { layerId: params.layerId },
          },
        );
      }
      document.activeLayers = [layer];
      target = { id: layer.id, kind: layer.kind };
    }

    // **대상을 먼저 검사한다.** 조정 레이어와 그룹에는 필터를 걸 수 없는데,
    // 그대로 진행하면 스마트 오브젝트 변환이 **먼저 성공**한 뒤 필터가 실패한다.
    // 그러면 실패로 보고되지만 조정 레이어는 이미 망가져 있다. 실기에서 그렇게
    // "Sky Color" 조정 레이어를 스마트 오브젝트로 만들어 놓고 실패를 돌려줬다.
    //
    // Photoshop 이 주는 메시지("선택 영역이 비어 있으므로…")로는 원인을 알 수 없다.
    const kind = toLayerType(target.kind).type;
    if (kind === "adjustment" || kind === "group") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `${kind === "group" ? "그룹" : "조정 레이어"}에는 필터를 적용할 수 없습니다. ` +
          "픽셀 레이어나 스마트 오브젝트를 layerId 로 지정하세요.",
        { recoverable: true, details: { layerId: target.id, type: kind } },
      );
    }

    // 변환 전에 id 목록을 떠 둔다. 변환 뒤에는 어느 것이 새로 생긴 것인지 알 수 없다.
    const before = flattenLayers(document.layers).map((entry) => entry.id);

    // **기본은 스마트 필터가 아니다.** Photoshop 자신의 동작과 같다 — 필터를 걸면
    // 픽셀에 적용되고, 스마트 필터는 '고급 필터용으로 변환' 을 명시적으로 고를 때만이다.
    //
    // 기본으로 변환하면 호출자가 요청하지 않은 일을 한다. 레이어가 스마트
    // 오브젝트로 바뀌고 id 와 type 이 달라져 호출자가 추적을 놓친다. 실기 한 번에
    // id 가 세 번 바뀌었다. 비파괴는 `layer.duplicate` 로 얻는 것이 더 명확하고 싸다.
    const asSmartFilter = params.asSmartFilter ?? false;
    const alreadySmart = String(target.kind).toLowerCase() === "smartobject";

    // 스마트 오브젝트로 변환하면 이후 필터가 스마트 필터로 붙는다. 픽셀은 보존된다.
    if (asSmartFilter && !alreadySmart) {
      await play("Convert to smart object", { _obj: "newPlacedLayer" });
    }

    /* **변환 뒤의 레이어를 넘긴다.** 스마트 오브젝트로 바꾸면 객체가 통째로
     * 교체되므로 변환 전에 잡아 둔 참조로 DOM 메서드를 부르면 던진다. */
    const current = document.activeLayers[0];
    if (current === undefined) {
      throw new DispatchError("COMMAND_FAILED", "필터를 걸 레이어를 찾지 못했습니다.", {
        recoverable: true,
        details: { commandName },
      });
    }
    await run(current);

    // 스마트 오브젝트로 변환되면 id 가 바뀐다. 활성 레이어로 추정하지 않고
    // **이번에 생긴 id** 로 찾는다 — 다른 이유로 활성 레이어가 바뀌었을 수 있다.
    const resolved = resolveMutatedLayer(before, flattenLayers(document.layers), target.id);
    if (resolved === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "필터는 적용되었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true },
      );
    }
    return resolved;
  });
}

/**
 * batchPlay descriptor 로 거는 필터. (ROADMAP §8.4 · §88)
 *
 * **"DOM 에 없어서" 가 아니다.** 이것을 쓰는 `gaussianBlur` · `highPass` ·
 * `minimum`/`maximum` 은 Adobe Layer 레퍼런스에 `applyGaussianBlur` · `applyHighPass` ·
 * `applyMinimum` · `applyMaximum` 으로 **있다**(23.5+). 이 주석이 한동안 반대로 적혀 있었다.
 *
 * 이 셋은 Phase 4(§8.4)에서 descriptor 로 만들었고, 그 뒤 §53 이 DOM `apply*` 를 열 때
 * (`applyDomFilter`) 옮기지 않은 채 남았다. **옮기지 않은 이유는 기록에 없다.**
 *
 * 옮길지는 열려 있다. 재 보지 않은 것이 있다 — DOM 메서드가 지금처럼 스마트 필터로 붙는지,
 * 결과가 같은지. `docs/API_COVERAGE.md` 의 "DOM 에 있는데 batchPlay 로 구현한 것" 이 이
 * 목록을 자동으로 낸다.
 *
 * 진짜로 DOM 에 없는 것은 `applySmartSharpen` · 표면 흐림 · 노이즈 감소다(`applyDomFilter`).
 */
async function applyFilter(
  commandName: string,
  params: { layerId?: number; asSmartFilter?: boolean },
  descriptor: Record<string, unknown>,
): Promise<LayerInfo> {
  return applyFilterCore(commandName, params, async () => {
    await play(commandName, descriptor);
  });
}

/**
 * DOM `layer.apply*` 로 거는 필터. (ROADMAP §53)
 *
 * **레퍼런스를 먼저 봤고 있었다.** Adobe Layer 레퍼런스에 `apply*` 가 서른여덟
 * 개 있다(23.5+). descriptor 를 잡을 이유가 없는 것들이다.
 *
 * 다만 **없는 것도 분명하다** — `applySmartSharpen` · 표면 흐림 · 노이즈
 * 감소는 목록에 없다. 이름이 비슷한 `applySmartBlur` 는 **고급 흐림**이라
 * 표면 흐림이 아니다. 비슷한 것으로 대신 채우지 않는다.
 *
 * 런타임에 메서드가 없으면 거절한다 — `constants.FlipAxis` 가 레퍼런스에
 * 있으면서 27.8 런타임에 없었다(§44).
 */
async function applyDomFilter(
  commandName: string,
  params: { layerId?: number; asSmartFilter?: boolean },
  method: string,
  args: readonly unknown[],
): Promise<LayerInfo> {
  return applyFilterCore(commandName, params, async (layer) => {
    const bag = layer as Record<string, unknown>;
    const fn = bag[method];
    if (typeof fn !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 의 Layer 에 ${method} 가 없습니다(23.5 이상이 필요합니다).`,
        { recoverable: false, details: { method } },
      );
    }
    try {
      await (fn as (...a: unknown[]) => Promise<void>).call(layer, ...args);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `${commandName} 을(를) 적용하지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { method } },
      );
    }
  });
}

export async function gaussianBlur(params: {
  layerId?: number;
  radius: number;
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return applyFilter("Gaussian blur", params, {
    _obj: "gaussianBlur",
    radius: { _unit: "pixelsUnit", _value: params.radius },
  });
}

/**
 * High Pass. 가장자리만 남기고 나머지를 중간 회색으로 만든다.
 *
 * 혼자서는 쓸모가 없고 **Soft Light · Overlay 혼합으로 겹쳐** 선명도를 올리는 데 쓴다.
 * 그래서 이 Tool 만으로 끝나지 않는다 — 복제 → High Pass → 혼합 모드 → 불투명도가
 * 한 묶음이다.
 */
export async function highPass(params: {
  layerId?: number;
  radius: number;
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return applyFilter("High pass", params, {
    _obj: "highPass",
    radius: { _unit: "pixelsUnit", _value: params.radius },
  });
}

/**
 * Minimum · Maximum. 밝은 영역을 줄이거나 늘린다.
 *
 * 천체사진의 별 축소가 Minimum 을 아주 작은 반지름(0.3~0.5px)으로 쓰는 것이다.
 * `preserveShape` 는 Photoshop 의 '유지: 원형/사각형' 이며 별에는 원형이 맞다.
 */
export async function minimumMaximum(params: {
  layerId?: number;
  radius: number;
  mode: "minimum" | "maximum";
  preserveShape?: "roundness" | "squareness";
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return applyFilter(params.mode === "minimum" ? "Minimum" : "Maximum", params, {
    _obj: params.mode,
    radius: { _unit: "pixelsUnit", _value: params.radius },
    preserveShape: {
      _enum: "preserveShape",
      _value: params.preserveShape ?? "roundness",
    },
  });
}

/**
 * 선명하게. **인자가 없다.**
 *
 * 레퍼런스의 `applySharpen` · `applySharpenEdges` · `applySharpenMore` 셋 다
 * 파라미터를 받지 않는다. 강도를 조절하려면 `unsharpMask` 쪽이다.
 *
 * `edges` 는 가장자리만 건드려 평탄한 영역의 노이즈를 덜 키운다.
 */
export async function filterSharpen(params: {
  layerId?: number;
  mode?: "sharpen" | "edges" | "more";
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  const method =
    params.mode === "edges"
      ? "applySharpenEdges"
      : params.mode === "more"
        ? "applySharpenMore"
        : "applySharpen";
  return applyDomFilter("Sharpen", params, method, []);
}

/**
 * 언샵 마스크.
 *
 * **`smart_sharpen` 이 DOM 에 없어서 이것이 조절 가능한 선명화의 자리다.**
 * 레퍼런스에 `applySmartSharpen` 이 없다 — 이름이 비슷한 것으로 채우지 않고
 * 있는 것을 쓴다.
 *
 * `threshold` 는 **이만큼 차이 나는 곳만 건드린다** — 천체사진에서 이것을 0 으로
 * 두면 배경 노이즈가 함께 선명해진다.
 */
export async function filterUnsharpMask(params: {
  layerId?: number;
  amount: number;
  radius: number;
  threshold?: number;
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return applyDomFilter("Unsharp mask", params, "applyUnSharpMask", [
    params.amount,
    params.radius,
    params.threshold ?? 0,
  ]);
}

/**
 * 모션 블러.
 *
 * `angle` 은 도, `distance` 는 픽셀이다. 별을 궤적처럼 늘리거나 배경을
 * 흐릴 때 쓴다.
 */
export async function filterMotionBlur(params: {
  layerId?: number;
  angle: number;
  distance: number;
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return applyDomFilter("Motion blur", params, "applyMotionBlur", [params.angle, params.distance]);
}

/**
 * 먼지와 스크래치.
 *
 * `radius` 안에서 `threshold` 보다 튀는 픽셀을 주변으로 덮는다. **`threshold` 를
 * 0 으로 두면 전체가 뭉개진다** — 값을 올릴수록 튀는 것만 골라낸다.
 *
 * **`retouch.remove_spots` 와 다른 물건이다.** 그쪽은 좌표를 받아 한 점을
 * 내용 인식으로 지우고, 이쪽은 레이어 전체에 건다. 새·비행기처럼 지우면 안 되는
 * 것까지 함께 사라지므로(§17.14) 전체에 걸 때는 결과를 확인한다.
 */
export async function filterDustAndScratches(params: {
  layerId?: number;
  radius: number;
  threshold?: number;
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return applyDomFilter("Dust & scratches", params, "applyDustAndScratches", [
    params.radius,
    params.threshold ?? 0,
  ]);
}
