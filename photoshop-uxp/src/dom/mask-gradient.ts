import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * 레이어 마스크에 선형 그라디언트를 그린다. (ROADMAP §17.8)
 *
 * 지평선 쪽만 서서히 밝기를 낮추는 작업이 이것이다 — 빛 공해는 지평선에서 강하고
 * 위로 갈수록 약해지므로 경계가 뚜렷한 마스크로는 티가 난다.
 *
 * ## 지금까지의 선택 Tool 과 성격이 다르다
 *
 * 나머지는 **선택 영역을 만든다.** 이것은 **마스크의 내용을 칠한다.** 그래서
 * 마스크 채널을 편집 대상으로 잡았다가 끝나면 되돌려야 한다 — 안 되돌리면 이후
 * 편집이 전부 마스크에 들어간다.
 *
 * descriptor 는 검증된 좌표로 이 모듈이 조립한다. (ARCHITECTURE §13, §23)
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

const px = (value: number): Record<string, unknown> => ({ _unit: "pixelsUnit", _value: value });

/** 마스크용 흑백 그라디언트. `reverse` 면 흰색이 먼저 온다. */
function grayscaleGradient(reverse: boolean): Record<string, unknown> {
  const stop = (level: number, location: number): Record<string, unknown> => ({
    _obj: "colorStop",
    // Photoshop 의 RGBColor 는 green 을 `grain` 으로 부른다. 오타가 아니다.
    color: { _obj: "RGBColor", red: level, grain: level, blue: level },
    type: { _enum: "colorStopType", _value: "userStop" },
    location,
    midpoint: 50,
  });
  const alpha = (location: number): Record<string, unknown> => ({
    _obj: "transferSpec",
    opacity: { _unit: "percentUnit", _value: 100 },
    location,
    midpoint: 50,
  });

  return {
    _obj: "gradientClassEvent",
    gradientForm: { _enum: "gradientForm", _value: "customStops" },
    // 그라디언트 좌표계의 길이. Photoshop 이 쓰는 고정값이다.
    interfaceIconFrameDimmed: 4096,
    colors: reverse ? [stop(255, 0), stop(0, 4096)] : [stop(0, 0), stop(255, 4096)],
    transparency: [alpha(0), alpha(4096)],
  };
}

export async function maskGradient(params: {
  layerId?: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 흰색을 먼저 둔다. 마스크에서 흰색은 보이는 쪽이다. */
  reverse?: boolean;
}): Promise<LayerInfo> {
  return runModal("Mask gradient", async () => {
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
    document.activeLayers = [target];

    const info = flattenLayers(document.layers).find((entry) => entry.id === target.id);
    if (info === undefined) {
      throw new DispatchError("LAYER_NOT_FOUND", "대상 레이어를 확인하지 못했습니다.", {
        recoverable: true,
      });
    }

    // 마스크 채널을 편집 대상으로 잡는다. **끝나면 반드시 되돌린다** —
    // 안 되돌리면 이후 편집이 전부 마스크에 들어간다.
    //
    // 마스크가 없으면 Photoshop 이 `"선택" 명령은 현재 사용할 수 없습니다` 라고
    // 답한다. 원문만으로는 마스크가 없어서 난 오류라는 것을 알 수 없다.
    try {
      await play("Target mask channel", {
        _obj: "select",
        _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }],
        makeVisible: false,
      });
    } catch {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "이 레이어에 마스크가 없습니다. mask.create 로 먼저 만드세요. " +
          "layer.list 의 hasMask 로 확인할 수 있습니다.",
        { recoverable: true, details: { layerId: info.id } },
      );
    }

    try {
      await play("Gradient", {
        _obj: "gradientClassEvent",
        from: { _obj: "paint", horizontal: px(params.from.x), vertical: px(params.from.y) },
        to: { _obj: "paint", horizontal: px(params.to.x), vertical: px(params.to.y) },
        type: { _enum: "gradientType", _value: "linear" },
        gradient: grayscaleGradient(params.reverse === true),
      });
    } finally {
      // 실패해도 되돌린다. 여기서 빠져나가면 다음 편집이 마스크를 덮어쓴다.
      await play("Restore composite target", {
        _obj: "select",
        _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }],
      });
    }

    return (await withMaskStateAsync([info]))[0] as LayerInfo;
  });
}
