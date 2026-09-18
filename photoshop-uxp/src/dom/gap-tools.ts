import { action } from "photoshop";
import type { BlendMode, LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { makeAdjustmentLayer } from "./adjustment.js";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById, mutate } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { resolveMutatedLayer } from "./mutation-result.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";

/**
 * ROADMAP §8.6 — 실기에서 드러난 공백.
 *
 * batchPlay descriptor 는 검증된 파라미터로 이 모듈이 조립한다. (ARCHITECTURE §13, §23)
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

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export async function selectionSet(params: {
  shape: "rectangle" | "ellipse" | "canvas" | "layerTransparency";
  bounds?: Bounds;
  layerId?: number;
  feather?: number;
}): Promise<{ hasSelection: boolean }> {
  return runModal("Set selection", async () => {
    const document = requireActiveDocument();

    if (params.shape === "layerTransparency") {
      if (params.layerId !== undefined) {
        const layer = findLayerById(document.layers, params.layerId);
        if (layer === null) {
          throw new DispatchError(
            "LAYER_NOT_FOUND",
            `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
            { recoverable: true, details: { layerId: params.layerId } },
          );
        }
        document.activeLayers = [layer];
      }
      await play("Select layer transparency", {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" },
      });
    } else if (params.shape === "canvas") {
      await play("Select all", {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _enum: "ordinal", _value: "allEnum" },
      });
    } else {
      const bounds = params.bounds;
      if (bounds === undefined) {
        throw new DispatchError("INVALID_PARAMETER", `${params.shape} 에는 bounds 가 필요합니다.`);
      }
      await play(`Select ${params.shape}`, {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: {
          _obj: params.shape,
          top: px(bounds.top),
          left: px(bounds.left),
          bottom: px(bounds.bottom),
          right: px(bounds.right),
        },
      });
    }

    if (params.feather !== undefined && params.feather > 0) {
      await play("Feather selection", { _obj: "feather", radius: px(params.feather) });
    }

    return { hasSelection: hasSelection() };
  });
}

export async function layerBlendMode(params: {
  layerId?: number;
  blendMode: BlendMode;
}): Promise<LayerInfo> {
  return runModal("Set blend mode", async () => {
    const document = requireActiveDocument();

    let target;
    if (params.layerId === undefined) {
      const active = document.activeLayers[0];
      if (active === undefined) {
        throw new DispatchError("LAYER_NOT_FOUND", "활성 레이어가 없습니다.", {
          recoverable: true,
        });
      }
      target = active;
    } else {
      const layer = findLayerById(document.layers, params.layerId);
      if (layer === null) {
        throw new DispatchError(
          "LAYER_NOT_FOUND",
          `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
          { recoverable: true, details: { layerId: params.layerId } },
        );
      }
      target = layer;
    }

    // DOM 으로 처리할 수 있으므로 batchPlay 를 쓰지 않는다. (ARCHITECTURE §13)
    // 배경 레이어에 혼합 모드를 주면 불투명도와 마찬가지로 승격되어 id 가 바뀐다.
    return await mutate(document, target, (layer) => {
      layer.blendMode = params.blendMode;
    });
  });
}

export async function adjustmentHueSaturation(params: {
  hue?: number;
  saturation?: number;
  lightness?: number;
  name?: string;
}): Promise<LayerInfo> {
  return makeAdjustmentLayer(
    "Hue/Saturation adjustment",
    {
      _obj: "hueSaturation",
      colorize: false,
      adjustment: [
        {
          _obj: "hueSatAdjustmentV2",
          hue: params.hue ?? 0,
          saturation: params.saturation ?? 0,
          lightness: params.lightness ?? 0,
        },
      ],
    },
    params.name,
  );
}

export async function adjustmentVibrance(params: {
  vibrance?: number;
  saturation?: number;
  name?: string;
}): Promise<LayerInfo> {
  return makeAdjustmentLayer(
    "Vibrance adjustment",
    {
      _obj: "vibrance",
      vibrance: params.vibrance ?? 0,
      saturation: params.saturation ?? 0,
    },
    params.name,
  );
}

/**
 * Color Balance 조정 레이어.
 *
 * 세 구간(그림자·중간톤·하이라이트)마다 세 축을 준다 — 각각
 * `[cyan↔red, magenta↔green, yellow↔blue]` 이고 −100~100 이다.
 *
 * 천체사진에서 특히 필요하다. 야경의 green/cyan cast 를 빼면서 중성~차가운 밤하늘을
 * 유지하는 작업이 Curves 만으로는 어렵다. 워크플로 시험에서 두 단계가 이것 때문에
 * 막혔다.
 */
export async function adjustmentColorBalance(params: {
  shadows?: [number, number, number];
  midtones?: [number, number, number];
  highlights?: [number, number, number];
  preserveLuminosity?: boolean;
  name?: string;
}): Promise<LayerInfo> {
  const zero: [number, number, number] = [0, 0, 0];
  return makeAdjustmentLayer(
    "Color Balance adjustment",
    {
      _obj: "colorBalance",
      shadowLevels: params.shadows ?? zero,
      midtoneLevels: params.midtones ?? zero,
      highlightLevels: params.highlights ?? zero,
      // 기본 켜짐. 색을 옮기면서 밝기가 따라 바뀌면 다른 조정이 어긋난다.
      preserveLuminosity: params.preserveLuminosity ?? true,
    },
    params.name,
  );
}

/**
 * 배경 레이어를 일반 레이어로 바꾼다.
 *
 * 배경은 이름을 못 바꾸고, 마스크도 불투명도도 가질 수 없다. 평탄화된 이미지로
 * 시작하는 작업은 **거의 항상 첫 단계가 이 변환**인데 명시적인 방법이 없었다.
 * 지금까지는 `set_opacity` 나 `mask.create` 의 부작용으로만 일어났다 — 의도를
 * 드러내지 않는 우회다.
 *
 * 이미 일반 레이어면 아무것도 하지 않고 그대로 돌려준다. 되돌릴 수 없는 작업이
 * 아니므로 오류로 만들지 않는다.
 */
export async function layerFromBackground(params: { name?: string }): Promise<LayerInfo> {
  return runModal("Layer from background", async () => {
    const document = requireActiveDocument();
    const before = flattenLayers(document.layers);
    const background = before.find((entry) => entry.isBackground === true);
    if (background === undefined) {
      const active = document.activeLayers[0];
      if (active === undefined) {
        throw new DispatchError("LAYER_NOT_FOUND", "활성 레이어가 없습니다.", {
          recoverable: true,
        });
      }
      return before.find((entry) => entry.id === active.id) ?? before[0]!;
    }

    // 이 descriptor 는 이름을 받지 않는다. 변환 뒤에 따로 바꾼다.
    await play("Layer from background", {
      _obj: "set",
      _target: [{ _ref: "layer", _property: "background" }],
      to: {
        _obj: "layer",
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" },
      },
    });

    const resolved = resolveMutatedLayer(
      before.map((entry) => entry.id),
      flattenLayers(document.layers),
      background.id,
    );
    if (resolved === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "변환은 되었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true },
      );
    }

    if (params.name === undefined) {
      return resolved;
    }
    const promoted = findLayerById(document.layers, resolved.id);
    if (promoted === null) {
      return resolved;
    }
    return await mutate(document, promoted, (layer) => {
      layer.name = params.name as string;
    });
  });
}
