import { action, app } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";
import { withMaskStateAsync } from "./mask-state.js";
import { resolveMutatedLayer } from "./mutation-result.js";

/**
 * Phase 4 마스크와 선택 영역. (ROADMAP §8.1, §8.2)
 *
 * UXP DOM 에 해당 API 가 없어 `batchPlay` 를 쓴다. descriptor 는 이 모듈이
 * 검증된 파라미터로 조립한다. (ARCHITECTURE §13, §23)
 */

/** batchPlay 를 실행하고 실패를 DispatchError 로 바꾼다. */
async function play(
  commandName: string,
  descriptors: Record<string, unknown>[],
  code = "COMMAND_FAILED",
): Promise<void> {
  const results = await action.batchPlay(descriptors, {});
  const failure = results.find((result) => result["message"] !== undefined);
  if (failure !== undefined) {
    throw new DispatchError(code, String(failure["message"]), { details: { commandName } });
  }
}

/** 활성 문서에 선택 영역이 있는지. */
export function hasSelection(): boolean {
  const document = app.activeDocument;
  if (document === null || document === undefined) {
    return false;
  }
  const bounds = document.selection?.bounds;
  return bounds !== undefined && bounds !== null;
}

/** 대상 레이어를 활성 레이어로 만든다. batchPlay 는 활성 레이어에 작용한다. */
function activate(document: ReturnType<typeof requireActiveDocument>, layerId?: number): number {
  if (layerId === undefined) {
    const active = document.activeLayers[0];
    if (active === undefined) {
      throw new DispatchError("LAYER_NOT_FOUND", "활성 레이어가 없습니다.", { recoverable: true });
    }
    return active.id;
  }

  const layer = findLayerById(document.layers, layerId);
  if (layer === null) {
    throw new DispatchError("LAYER_NOT_FOUND", `레이어 ${layerId} 를 찾을 수 없습니다.`, {
      recoverable: true,
      details: { layerId },
    });
  }
  document.activeLayers = [layer];
  return layer.id;
}

export async function maskCreate(params: {
  layerId?: number;
  from?: "revealAll" | "hideAll" | "fromSelection";
}): Promise<LayerInfo> {
  return runModal("Create mask", async () => {
    const document = requireActiveDocument();
    const targetId = activate(document, params.layerId);
    const from = params.from ?? "revealAll";

    if (from === "fromSelection" && !hasSelection()) {
      throw new DispatchError("INVALID_PARAMETER", "선택 영역이 없어 마스크를 만들 수 없습니다.", {
        recoverable: true,
      });
    }

    // 배경 레이어에 마스크를 붙이면 Photoshop 이 일반 레이어로 승격시키고 id 를
    // 바꾼다. 그래서 변경 **전에** id 목록을 떠 둔다. (`resolveMutatedLayer` 참조)
    const before = flattenLayers(document.layers).map((entry) => entry.id);

    await play("Create mask", [
      {
        _obj: "make",
        new: { _class: "channel" },
        at: { _ref: "channel", _enum: "channel", _value: "mask" },
        using: {
          _enum: "userMaskEnabled",
          _value: from === "fromSelection" ? "revealSelection" : from,
        },
      },
    ]);

    const resolved = resolveMutatedLayer(before, flattenLayers(document.layers), targetId);
    if (resolved === null) {
      // 마스크는 이미 만들어졌다. 실패로 보고하면 호출자가 되돌리려다 더 망친다.
      throw new DispatchError(
        "COMMAND_FAILED",
        "마스크는 만들어졌지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { layerId: targetId } },
      );
    }
    // 마스크를 만든 결과를 돌려주는 자리다. 마스크 상태가 빠지면 호출자가
    // 확인하려고 layer.list 를 또 불러야 한다.
    return (await withMaskStateAsync([resolved]))[0] as LayerInfo;
  });
}

async function setMaskEnabled(
  commandName: string,
  layerId: number | undefined,
  enabled: boolean,
): Promise<LayerInfo> {
  return runModal(commandName, async () => {
    const document = requireActiveDocument();
    const targetId = activate(document, layerId);
    const before = flattenLayers(document.layers).map((entry) => entry.id);

    try {
      await play(commandName, [
        {
          _obj: "set",
          _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
          to: { _obj: "layer", userMaskEnabled: enabled },
        },
      ]);
    } catch (error) {
      // 마스크가 없는 레이어면 Photoshop 이 `"설정" 명령은 현재 사용할 수 없습니다`
      // 라고 답한다. 원문만으로는 무엇을 해야 할지 알 수 없다 — 실기에서 LLM 으로
      // 테스트하다 이 벽을 만났다. 가장 흔한 원인을 짚어 준다.
      throw new DispatchError(
        "COMMAND_FAILED",
        `마스크 상태를 바꾸지 못했습니다. 이 레이어에 마스크가 없을 수 있습니다 — ` +
          `mask.create 로 먼저 만드세요. (Photoshop: ${String(
            (error as { message?: unknown })?.message ?? error,
          )})`,
        { recoverable: true, details: { layerId: targetId, enabled } },
      );
    }

    const resolved = resolveMutatedLayer(before, flattenLayers(document.layers), targetId);
    if (resolved === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "마스크 상태는 바뀌었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { layerId: targetId } },
      );
    }
    return (await withMaskStateAsync([resolved]))[0] as LayerInfo;
  });
}

/**
 * 마스크를 픽셀에 굽고 없앤다.
 *
 * **가려 둔 것은 사라지지 않는다.** 마스크는 픽셀을 가릴 뿐이라, 끄거나
 * 지우면 다시 드러난다. `gx.run_gradient` 의 하늘 경로는 지상부에 **우리가
 * 만든 가짜 평면**을 담고 있어 그대로 두면 안 된다.
 *
 * 적용하면 가려진 곳이 실제로 투명해지고 레이어는 마스크 없는 픽셀 레이어가
 * 된다. History 로 되돌릴 수 있으므로 `edit` 이다.
 */
export async function maskApply(params: { layerId?: number }): Promise<LayerInfo> {
  return runModal("Apply mask", async () => {
    const document = requireActiveDocument();
    const targetId = activate(document, params.layerId);
    const before = flattenLayers(document.layers).map((entry) => entry.id);

    try {
      await play("Apply mask", [
        {
          _obj: "delete",
          _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }],
          // `apply: false` 면 마스크를 그냥 버린다. 가려 둔 것이 되살아난다.
          apply: true,
        },
      ]);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `마스크를 적용하지 못했습니다. 이 레이어에 마스크가 없을 수 있습니다 — ` +
          `layer.list 의 hasMask 로 확인하세요. (Photoshop: ${String(
            (error as { message?: unknown })?.message ?? error,
          )})`,
        { recoverable: true, details: { layerId: targetId } },
      );
    }

    const resolved = resolveMutatedLayer(before, flattenLayers(document.layers), targetId);
    if (resolved === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "마스크는 적용되었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { layerId: targetId } },
      );
    }
    return (await withMaskStateAsync([resolved]))[0] as LayerInfo;
  });
}

export async function maskEnable(params: { layerId?: number }): Promise<LayerInfo> {
  return setMaskEnabled("Enable mask", params.layerId, true);
}

export async function maskDisable(params: { layerId?: number }): Promise<LayerInfo> {
  return setMaskEnabled("Disable mask", params.layerId, false);
}

export async function selectionClear(): Promise<{ hasSelection: boolean }> {
  return runModal("Clear selection", async () => {
    requireActiveDocument();
    await play("Clear selection", [
      {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _enum: "ordinal", _value: "none" },
      },
    ]);
    return { hasSelection: hasSelection() };
  });
}

export async function selectionInvert(): Promise<{ hasSelection: boolean }> {
  return runModal("Invert selection", async () => {
    requireActiveDocument();
    if (!hasSelection()) {
      throw new DispatchError("INVALID_PARAMETER", "반전할 선택 영역이 없습니다.", {
        recoverable: true,
      });
    }
    await play("Invert selection", [{ _obj: "inverse" }]);
    return { hasSelection: hasSelection() };
  });
}
