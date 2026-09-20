import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerInfo } from "./layers.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";
import { featherFor } from "./dodge-burn-geometry.js";

/**
 * 닷징 · 버닝. (ROADMAP §17.31)
 *
 * ## 브러시가 아니라 얼룩이다
 *
 * 치유 브러시를 만들지 않은 이유(§17.14)가 여기에는 해당하지 않는다. 치유
 * 브러시는 **획 경로**를 요구해서 좌표 목록을 보내는 일이 되지만, 닷징·버닝에
 * 필요한 것은 부드러운 원형 얼룩 하나이고 그것은 `중심 · 반지름 · 강도` 로
 * 결정된다. 검증된 파라미터로 조립할 수 있다. (ARCHITECTURE §23)
 *
 * 그래서 먼지 제거와 같은 길을 쓴다 — 타원 선택 → 페더 → 채우기. 다른 것은
 * 채우는 내용뿐이다(내용 인식 대신 흰색·검정).
 *
 * ## 투명 레이어에 칠한다
 *
 * 전통적으로는 50% 회색을 채운 레이어에 칠하지만, Soft Light 에서 회색이
 * 중립이라는 사실을 이용하는 것뿐이다. **투명 픽셀도 중립이다.** 빈 레이어에
 * 그대로 칠하면 같은 결과가 나오고 회색을 채우는 단계가 필요 없다.
 *
 * 레이어 준비는 이 Command 가 하지 않는다 — `layer.create` 로 만들고
 * `layer.set_blend_mode` 로 `softLight` 를 거는 일이며 둘 다 이미 있다.
 * 여기서 대신 만들면 얼룩을 찍을 때마다 레이어가 하나씩 생긴다.
 *
 * ## 배경은 거절한다
 *
 * 닷징·버닝은 원본 픽셀을 직접 밝히거나 어둡게 만드는 작업이다. 배경에 바로
 * 걸면 되돌릴 수 없다. `retouch.remove_spots` 와 같은 규칙이며, 같은 이유로
 * **모르면 막지 않는다** — 없는 것을 참으로 읽어 멀쩡한 호출을 막는 것이 더 나쁘다.
 */

export interface Dab {
  x: number;
  y: number;
  radius: number;
  /** 1–100. 채우기 불투명도로 간다. */
  strength: number;
  /** 0–100. 0 이면 가장 부드럽다. 페더 = radius × (1 − hardness/100). */
  hardness?: number;
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

export async function dodgeBurnDab(params: {
  dabs: Dab[];
  mode: "dodge" | "burn";
  layerId?: number;
}): Promise<{ layer: LayerInfo; applied: number }> {
  return runModal("Dodge and burn", async () => {
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
    if (kind !== "pixel") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `${kind} 레이어에는 칠할 수 없습니다. ` +
          "photoshop.layer.create 로 빈 픽셀 레이어를 만들고 " +
          "photoshop.layer.set_blend_mode 로 softLight 를 건 뒤 그 레이어를 지정하세요.",
        { recoverable: true, details: { layerId: layer.id, type: kind } },
      );
    }

    if (layer.isBackgroundLayer === true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "배경 레이어에는 닷징·버닝을 걸지 않습니다 — 원본 픽셀이 바뀝니다. " +
          "photoshop.layer.create 로 빈 레이어를 만들고 softLight 를 건 뒤 거기에 칠하세요.",
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    document.activeLayers = [layer];

    // 닷징은 흰색, 버닝은 검정이다. Soft Light 에서 흰색은 밝히고 검정은 어둡게 한다.
    const fillWith = params.mode === "dodge" ? "white" : "black";
    let applied = 0;

    try {
      for (const dab of params.dabs) {
        const left = dab.x - dab.radius;
        const top = dab.y - dab.radius;
        const right = dab.x + dab.radius;
        const bottom = dab.y + dab.radius;

        // 문서 밖이면 선택이 비고, 빈 선택에 채우기를 걸면 Photoshop 이 원인을 알 수
        // 없는 메시지로 거절한다. 여기서 이유를 말한다. (§17.14 와 같은 자리)
        if (right <= 0 || bottom <= 0 || left >= document.width || top >= document.height) {
          throw new DispatchError(
            "INVALID_PARAMETER",
            `얼룩 (${dab.x}, ${dab.y}) 반지름 ${dab.radius} 가 ` +
              `문서(${document.width}×${document.height}) 밖입니다.`,
            { recoverable: true, details: { dab, applied } },
          );
        }

        await play("Select dab", {
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

        const feather = featherFor(dab.radius, dab.hardness ?? 0);
        if (feather > 0) {
          await play("Feather", { _obj: "feather", radius: px(feather) });
        }

        await play("Fill", {
          _obj: "fill",
          using: { _enum: "fillContents", _value: fillWith },
          opacity: { _unit: "percentUnit", _value: dab.strength },
          mode: { _enum: "blendMode", _value: "normal" },
        });

        applied += 1;
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

    return { layer: toLayerInfo(layer), applied };
  });
}
