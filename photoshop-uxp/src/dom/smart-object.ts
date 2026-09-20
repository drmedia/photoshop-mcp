import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { resolveMutatedLayer } from "./mutation-result.js";
import { runModal } from "./modal.js";

/**
 * 스마트 오브젝트 변환. (ROADMAP §17.27)
 *
 * DOM 에 변환 API 가 없어 batchPlay 를 쓴다. descriptor 는 파라미터가 없는 고정
 * 상수라 호출자가 끼어들 자리가 없다. (ARCHITECTURE §13, §23)
 *
 * `filter.ts` 가 `asSmartFilter` 에서 쓰는 것과 같은 descriptor 다.
 */

export async function smartObjectConvert(params: { layerId?: number }): Promise<{
  layer: LayerInfo;
  converted: boolean;
  previousId: number;
}> {
  return runModal("Convert to smart object", async () => {
    const document = requireActiveDocument();

    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const previousId = target.id;
    const before = flattenLayers(document.layers);
    const info = before.find((entry) => entry.id === previousId);
    if (info === undefined) {
      throw new DispatchError("LAYER_NOT_FOUND", "대상 레이어를 확인하지 못했습니다.", {
        recoverable: true,
      });
    }

    // **두 번 변환하지 않는다.** 스마트 오브젝트 안에 스마트 오브젝트가 생겨
    // 구조가 한 겹 깊어지고, 호출자가 의도한 적이 없는 일이다.
    if (info.type === "smartObject") {
      return {
        layer: (await withMaskStateAsync([info]))[0] as LayerInfo,
        converted: false,
        previousId,
      };
    }

    document.activeLayers = [target];

    const results = await action.batchPlay([{ _obj: "newPlacedLayer" }], {});
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { layerId: previousId },
      });
    }

    // **id 가 바뀐다.** 활성 레이어로 추정하지 않고 이번에 생긴 id 로 찾는다 —
    // 다른 이유로 활성 레이어가 바뀌었을 수 있다. (§8.4 의 mutate() 와 같은 규칙)
    const after = flattenLayers(requireActiveDocument().layers);
    const resolved = resolveMutatedLayer(
      before.map((entry) => entry.id),
      after,
      previousId,
    );
    if (resolved === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "변환은 실행되었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { previousId } },
      );
    }

    // 변환됐다고 말하기 전에 실제로 스마트 오브젝트인지 본다.
    if (resolved.type !== "smartObject") {
      throw new DispatchError(
        "COMMAND_FAILED",
        `변환 명령은 오류 없이 끝났지만 레이어가 ${resolved.type} 입니다.`,
        { details: { previousId, actual: resolved.type } },
      );
    }

    return {
      layer: (await withMaskStateAsync([resolved]))[0] as LayerInfo,
      converted: true,
      previousId,
    };
  });
}
