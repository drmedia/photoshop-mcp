import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";

/**
 * 결함 제거. (ROADMAP §17.14, RETOUCH_PROCESS 3단계)
 *
 * 타원 선택 → **내용 인식 채우기** 를 지점마다 반복한다.
 *
 * 치유 브러시가 아니라 채우기를 쓰는 이유: 치유 브러시는 붓질(획)을 요구하는데
 * batchPlay 로 획을 흉내 내는 것은 좌표 목록을 보내는 일이 되고, 그러면 호출자가
 * descriptor 를 조립하는 것과 다를 바 없어진다. 먼지는 "점 하나"라서 선택 + 채우기로
 * 충분하다. (ARCHITECTURE §23)
 */

interface Spot {
  x: number;
  y: number;
  radius: number;
}

function px(value: number): { _unit: string; _value: number } {
  return { _unit: "pixelsUnit", _value: value };
}

async function play(label: string, descriptor: Record<string, unknown>): Promise<void> {
  const results = await action.batchPlay([descriptor], {});
  const failure = results.find((result) => result["message"] !== undefined);
  if (failure !== undefined) {
    throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
      details: { step: label },
    });
  }
}

export async function retouchRemoveSpots(params: {
  spots: Spot[];
  layerId?: number;
  feather?: number;
}): Promise<{ layer: LayerInfo; removed: number }> {
  return runModal("Remove spots", async () => {
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
        `${kind === "group" ? "그룹" : "조정 레이어"}에는 지울 픽셀이 없습니다. ` +
          "픽셀 레이어를 layerId 로 지정하세요.",
        { recoverable: true, details: { layerId: layer.id, type: kind } },
      );
    }

    // **배경은 거절한다.**
    //
    // 이것은 원본 촬영 픽셀을 지우는 것이 목적인 유일한 Command 다. 필터는 효과를
    // 입히는 것이지만 먼지 제거는 있던 것을 없앤다. 배경에 바로 걸면 카메라가 본
    // 것의 기록이 사라진다. (RETOUCH_PROCESS 3단계)
    //
    // `isBackground` 는 Photoshop 이 알려줄 때만 담는 값이라 여기서도 그 규칙을
    // 따른다 — 모르면 막지 않는다. 없는 것을 참으로 읽어 멀쩡한 호출을 막는 것이
    // 더 나쁘다.
    if (layer.isBackgroundLayer === true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "배경 레이어에는 결함 제거를 적용하지 않습니다 — 원본이 사라집니다. " +
          "photoshop.layer.duplicate 로 복제한 뒤 그 레이어를 layerId 로 지정하세요.",
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    document.activeLayers = [layer];

    const feather = params.feather ?? 2;
    let removed = 0;

    try {
      for (const spot of params.spots) {
        const left = spot.x - spot.radius;
        const top = spot.y - spot.radius;
        const right = spot.x + spot.radius;
        const bottom = spot.y + spot.radius;

        // 문서 밖으로 나가면 선택이 비고, 빈 선택에 채우기를 걸면 Photoshop 이
        // 원인을 알 수 없는 메시지로 거절한다. 여기서 이유를 말한다.
        if (right <= 0 || bottom <= 0 || left >= document.width || top >= document.height) {
          throw new DispatchError(
            "INVALID_PARAMETER",
            `지점 (${spot.x}, ${spot.y}) 반지름 ${spot.radius} 가 ` +
              `문서(${document.width}×${document.height}) 밖입니다.`,
            { recoverable: true, details: { spot } },
          );
        }

        await play("Select spot", {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: {
            _obj: "ellipse",
            top: px(top),
            left: px(left),
            bottom: px(bottom),
            right: px(right),
          },
        });

        if (feather > 0) {
          await play("Feather", { _obj: "feather", radius: px(feather) });
        }

        await play("Content-aware fill", {
          _obj: "fill",
          using: { _enum: "fillContents", _value: "contentAware" },
          contentAwareColorAdaptionFill: true,
          opacity: { _unit: "percentUnit", _value: 100 },
          mode: { _enum: "blendMode", _value: "normal" },
        });

        removed += 1;
      }
    } finally {
      // 선택을 남기지 않는다. 남기면 다음 Command 가 조용히 그 범위에만 걸린다.
      await play("Deselect", {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _enum: "ordinal", _value: "none" },
      }).catch(() => {
        // 이미 실패한 길이면 해제 실패까지 덮어쓰지 않는다.
      });
    }

    return { layer: toLayerInfo(layer), removed };
  });
}
