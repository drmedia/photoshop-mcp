import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";
import { resolveMutatedLayer } from "./mutation-result.js";

/**
 * Phase 4 필터. (ROADMAP §8.4)
 *
 * 기본은 스마트 필터다. 대상이 스마트 오브젝트가 아니면 먼저 변환한다.
 * `asSmartFilter: false` 일 때만 픽셀에 직접 적용한다.
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

export async function gaussianBlur(params: {
  layerId?: number;
  radius: number;
  asSmartFilter?: boolean;
}): Promise<LayerInfo> {
  return runModal("Gaussian blur", async () => {
    const document = requireActiveDocument();

    // 대상을 활성 레이어로 만든다. batchPlay 필터는 활성 레이어에 작용한다.
    let target: { id: number; kind: string };
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

    // 변환 전에 id 목록을 떠 둔다. 변환 뒤에는 어느 것이 새로 생긴 것인지 알 수 없다.
    const before = flattenLayers(document.layers).map((entry) => entry.id);

    const asSmartFilter = params.asSmartFilter ?? true;
    const alreadySmart = String(target.kind).toLowerCase() === "smartobject";

    // 스마트 오브젝트로 변환하면 이후 필터가 스마트 필터로 붙는다. 픽셀은 보존된다.
    if (asSmartFilter && !alreadySmart) {
      await play("Convert to smart object", { _obj: "newPlacedLayer" });
    }

    await play("Gaussian blur", {
      _obj: "gaussianBlur",
      radius: { _unit: "pixelsUnit", _value: params.radius },
    });

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
