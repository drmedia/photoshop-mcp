import { action } from "photoshop";
import type { AdjustmentType, LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { captureAdjustmentType } from "./adjustment.js";
import {
  adjustmentBlackWhite,
  adjustmentChannelMixer,
  adjustmentExposure,
  adjustmentPhotoFilter,
} from "./adjustment-extra.js";
import { adjustmentBrightnessContrast, adjustmentCurves, adjustmentLevels } from "./adjustment.js";
import { requireActiveDocument } from "./document.js";
import { adjustmentColorBalance, adjustmentHueSaturation, adjustmentVibrance } from "./gap-tools.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * 걸려 있는 조정 레이어의 값을 고친다. (ROADMAP §101)
 *
 * ## descriptor 를 새로 쓰지 않는다
 *
 * 만들 때 쓰는 빌더(`adjustmentCurves` 등)가 이미 검증된 `type` descriptor 를 조립한다. 여기서는
 * 그것을 **빌더가 `makeAdjustmentLayer` 를 부르는 순간 가로채** `make` 대신 `set` 에 쓴다.
 * 만들 때와 고칠 때의 값 모양이 갈라질 수 없다.
 *
 * 가로채기는 **동기 구간 안에서만** 열려 있다(`captureAdjustmentType`). 두 호출이 겹쳐도 서로의
 * 값을 볼 수 없다.
 *
 * ## 고쳤는지 읽어서 답한다
 *
 * `set` 이 오류 없이 끝났다고 값이 바뀐 것은 아니다. 전후의 `adjustment` 속성을 읽어 견준다.
 */

type Kind =
  | "curves"
  | "levels"
  | "brightness_contrast"
  | "hue_saturation"
  | "vibrance"
  | "color_balance"
  | "exposure"
  | "black_white"
  | "photo_filter"
  | "channel_mixer";

type Builder = (settings: never) => Promise<unknown>;

const BUILDERS: Record<Kind, Builder> = {
  curves: adjustmentCurves as Builder,
  levels: adjustmentLevels as Builder,
  brightness_contrast: adjustmentBrightnessContrast as Builder,
  hue_saturation: adjustmentHueSaturation as Builder,
  vibrance: adjustmentVibrance as Builder,
  color_balance: adjustmentColorBalance as Builder,
  exposure: adjustmentExposure as Builder,
  black_white: adjustmentBlackWhite as Builder,
  photo_filter: adjustmentPhotoFilter as Builder,
  channel_mixer: adjustmentChannelMixer as Builder,
};

/** 프로토콜 표기(`LayerInfo.adjustmentType`). */
const EXPECTED_TYPE: Record<Kind, AdjustmentType> = {
  curves: "curves",
  levels: "levels",
  brightness_contrast: "brightnessContrast",
  hue_saturation: "hueSaturation",
  vibrance: "vibrance",
  color_balance: "colorBalance",
  exposure: "exposure",
  black_white: "blackAndWhite",
  photo_filter: "photoFilter",
  channel_mixer: "channelMixer",
};

async function readAdjustment(layerId: number): Promise<string> {
  try {
    const results = await action.batchPlay(
      [{ _obj: "get", _target: [{ _property: "adjustment" }, { _ref: "layer", _id: layerId }] }],
      {},
    );
    return JSON.stringify(results[0]?.["adjustment"] ?? null);
  } catch {
    // 읽지 못하면 비교할 수 없다. 지어내지 않고 null 로 표시한다.
    return "null";
  }
}

export async function adjustmentUpdate(params: {
  layerId?: number;
  kind: Kind;
  settings: Record<string, unknown>;
}): Promise<{ layer: LayerInfo; kind: Kind; changed: boolean }> {
  const build = BUILDERS[params.kind];
  if (build === undefined) {
    throw new DispatchError("INVALID_PARAMETER", `고칠 수 없는 종류입니다: ${params.kind}`, {
      recoverable: true,
    });
  }
  // 동기 구간. 빌더가 `makeAdjustmentLayer` 를 부르는 순간 `type` 을 받아 온다.
  const type = captureAdjustmentType(() => build(params.settings as never));

  return runModal("Update adjustment", async () => {
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
          : `레이어 ${String(params.layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }
    const info = flattenLayers(document.layers).find((entry) => entry.id === target.id);
    const withState = info === undefined ? undefined : (await withMaskStateAsync([info]))[0];
    if (withState === undefined || withState.type !== "adjustment") {
      throw new DispatchError("INVALID_PARAMETER", `레이어 ${target.id} 는 조정 레이어가 아닙니다.`, {
        recoverable: true,
        details: { layerId: target.id, type: withState?.type ?? null },
      });
    }
    // 종류를 아는데 다르면 거절한다. 모르면(`null`) 막지 않는다 — 없는 것을 틀렸다고 읽지 않는다.
    const expected = EXPECTED_TYPE[params.kind];
    if (withState.adjustmentType != null && withState.adjustmentType !== expected) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${target.id} 는 ${withState.adjustmentType} 인데 kind 는 ${params.kind} 입니다. ` +
          "종류를 바꿀 수 없습니다.",
        { recoverable: true, details: { layerId: target.id, adjustmentType: withState.adjustmentType } },
      );
    }

    const before = await readAdjustment(target.id);
    const typeWithPreset: Record<string, unknown> = {
      presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
      ...type,
    };
    const results = await action.batchPlay(
      [
        {
          _obj: "set",
          _target: [{ _ref: "adjustmentLayer", _id: target.id }],
          to: typeWithPreset,
        },
      ],
      {},
    );
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", `조정 값을 고치지 못했습니다: ${String(failure["message"])}`, {
        recoverable: true,
        details: { layerId: target.id, kind: params.kind },
      });
    }
    const after = await readAdjustment(target.id);

    return { layer: withState, kind: params.kind, changed: before !== after };
  });
}
