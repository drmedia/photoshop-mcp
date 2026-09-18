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
async function applyFilter(
  commandName: string,
  params: { layerId?: number; asSmartFilter?: boolean },
  descriptor: Record<string, unknown>,
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

    await play(commandName, descriptor);

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
