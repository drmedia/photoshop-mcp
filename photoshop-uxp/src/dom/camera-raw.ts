import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";
import { buildCameraRawDescriptor, type CameraRawParams } from "./camera-raw-keys.js";

/**
 * Camera Raw 필터. (ROADMAP §17.17)
 *
 * descriptor 조립과 키 매핑은 `camera-raw-keys.ts` 에 있다 — 순수 로직이라
 * 실기 없이 테스트로 고정한다.
 *
 * 여기서는 **대상 검사**만 한다. 특히 숨긴 레이어를 미리 막는다.
 */

export async function cameraRawApply(
  params: CameraRawParams,
): Promise<{ layer: LayerInfo; applied: string[] }> {
  return runModal("Camera Raw", async () => {
    const document = requireActiveDocument();

    const layer =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (layer === undefined || layer === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const kind = toLayerType(layer.kind).type;
    if (kind === "adjustment" || kind === "group") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `${kind === "group" ? "그룹" : "조정 레이어"}에는 Camera Raw 를 걸 수 없습니다. ` +
          "픽셀 레이어를 layerId 로 지정하세요.",
        { recoverable: true, details: { layerId: layer.id, type: kind } },
      );
    }

    // **숨긴 레이어는 미리 막는다.**
    //
    // 그대로 보내면 Photoshop 이 "«Camera Raw 필터» 명령은 현재 사용할 수 없습니다"
    // 라고만 답한다. 왜인지 알 수 없는 메시지다 — 실기에서 한참 헤맸다.
    if (layer.visible === false) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "숨긴 레이어에는 Camera Raw 를 걸 수 없습니다. " +
          "photoshop.layer.set_visibility 로 보이게 한 뒤 다시 시도하세요.",
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    document.activeLayers = [layer];

    const { descriptor, applied } = buildCameraRawDescriptor(params);
    const played = await action.batchPlay([descriptor], {});
    const failure = played.find((entry) => entry["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { applied },
      });
    }

    return { layer: toLayerInfo(layer), applied };
  });
}
