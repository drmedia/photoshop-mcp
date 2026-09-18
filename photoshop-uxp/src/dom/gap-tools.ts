import { action } from "photoshop";
import type { BlendMode, LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { makeAdjustmentLayer } from "./adjustment.js";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { describeLayer, findLayerById } from "./layer-edit.js";
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
    target.blendMode = params.blendMode;
    return describeLayer(document, target);
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
