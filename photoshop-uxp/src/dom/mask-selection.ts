import { action, app } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";
import { readMaskState, withMaskStateAsync } from "./mask-state.js";
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

/**
 * `MASK_SELECT` — 마스크를 편집 대상으로. (CORE_API §5 P1)
 *
 * ## 무엇이 달라지는가
 *
 * 필터·조정·칠하기는 **지금 선택된 채널**에 걸린다. 마스크를 편집 대상으로 두면
 * `filter.gaussian_blur` 가 마스크 경계를 부드럽게 하고, `adjustment.curves` 가
 * 마스크의 세기를 조절한다. 지금까지는 `mask.dab` · `mask.gradient` 처럼 **대상을
 * 스스로 정하는 Command** 로만 마스크를 건드릴 수 있었다.
 *
 * ## 양방향이다
 *
 * `target: "pixels"` 를 함께 연다. 마스크로 보내는 길만 있으면 호출자가 돌아올 수
 * 없고, 그 뒤의 모든 편집이 조용히 마스크에 걸린다 — 이 프로젝트가 가장 싫어하는
 * 실패 형태다. Tool 을 둘로 나누지 않은 이유는 **두 번째를 안 만들 수 없기
 * 때문**이다. 하나면 짝이 빠질 수 없다.
 *
 * ## descriptor 는 잡은 것이다
 *
 * DOM 에 레이어 마스크를 채널로 얻는 길이 문서화되어 있지 않다 —
 * `document.activeChannels` 는 문서 채널용이고 `Channel` 에 마스크를 가리키는
 * 값이 없다. 그래서 batchPlay 이고, 이름은 `["all"]` 알림으로 사람이 썸네일을
 * 클릭하는 것을 잡아 확인했다(§17.28). 짐작한 것이 하나도 없다.
 *
 * **마스크가 이미 대상이면 클릭해도 알림이 안 난다** — 잡는 동안 그것 때문에 한 번
 * 헛돌았다. `mask.create` 직후에는 마스크가 이미 대상이다.
 */
export interface MaskSelectResult {
  layer: LayerInfo;
  /** 요청한 대상. 실제로 그렇게 되었는지는 `verified` 가 말한다. */
  target: "mask" | "pixels";
  /**
   * 고른 뒤 읽은 `document.activeChannels` 의 이름. 예: `["빨강","녹색","파랑"]`.
   *
   * **마스크가 대상이면 `null` 이다** — 레이어 마스크는 문서 채널이 아니라서
   * Photoshop 이 `Unknown or unsupported active channels.` 로 던진다.
   */
  activeChannels: string[] | null;
  /**
   * **Photoshop 에 물어 확인했는가.** 요청값을 되풀이한 것이 아니다.
   *
   * ```text
   * pixels →  구성 채널이 활성인 것을 확인했다
   * mask   →  구성 채널이 활성이 **아님**을 확인했다
   * ```
   *
   * 마스크인지 알파 채널인지까지는 구분하지 않는다 — Photoshop 이 둘을 같은
   * 오류로 답한다. `false` 면 확인하지 못한 것이고, 바뀌지 않았다는 뜻은 아니다.
   */
  verified: boolean;
}

/**
 * `document.activeChannels` 를 읽어 본 결과.
 *
 * **셋을 구분해야 한다.** `null` 하나로 뭉뚱그리면 "마스크가 대상이라 못 읽었다"
 * 와 "이 Photoshop 에 속성이 없다" 가 같은 값이 되고, 그러면 `verified` 가
 * 능력 없는 호스트에서 거짓으로 참이 된다.
 */
type ChannelProbe =
  /** 문서 채널이 활성이다. */
  | { kind: "names"; names: string[] }
  /** Photoshop 이 던졌다 — 문서 채널이 활성이 아니다. */
  | { kind: "blocked" }
  /** 속성이 없거나 모양이 다르다. 아무것도 알아내지 못했다. */
  | { kind: "unknown" };

function probeActiveChannels(document: unknown): ChannelProbe {
  let raw: unknown;
  try {
    raw = (document as Record<string, unknown>)["activeChannels"];
  } catch {
    /* 실기에서 잡은 문구: `Unknown or unsupported active channels.`
     * 레이어 마스크가 활성일 때 난다. */
    return { kind: "blocked" };
  }
  if (!Array.isArray(raw)) {
    return { kind: "unknown" };
  }
  return {
    kind: "names",
    names: raw.map((channel) => {
      const name = (channel as { name?: unknown } | null)?.name;
      return typeof name === "string" ? name : "?";
    }),
  };
}

export async function maskSelect(params: {
  layerId?: number;
  target?: "mask" | "pixels";
}): Promise<MaskSelectResult> {
  const target = params.target ?? "mask";
  return runModal("Select mask", async () => {
    const document = requireActiveDocument();
    const targetId = activate(document, params.layerId);

    /* **마스크가 없으면 미리 막는다.** Photoshop 은 "명령을 사용할 수 없습니다"
     * 라고만 답해 이유를 알 수 없다 — Camera Raw 가 숨긴 레이어를 미리 막는 것과
     * 같은 자리다(§17.17). 읽지 못하면 막지 않는다. */
    if (target === "mask") {
      const state = (await readMaskState([targetId])).get(targetId);
      if (state !== undefined && !state.hasMask) {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `레이어 ${targetId} 에 마스크가 없습니다. photoshop.mask.create 로 먼저 만드세요.`,
          { recoverable: true, details: { layerId: targetId } },
        );
      }
    }

    await play("Select channel", [
      {
        _obj: "select",
        _target: [
          { _ref: "channel", _enum: "channel", _value: target === "mask" ? "mask" : "RGB" },
        ],
        // 편집 대상만 바꾼다. 마스크를 빨간 오버레이로 띄우지 않는다.
        makeVisible: false,
      },
    ]);

    const layer = flattenLayers(document.layers).find((entry) => entry.id === targetId);
    if (layer === undefined) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "채널은 바뀌었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { layerId: targetId } },
      );
    }

    const probe = probeActiveChannels(document);
    return {
      layer: (await withMaskStateAsync([layer]))[0] as LayerInfo,
      target,
      activeChannels: probe.kind === "names" ? probe.names : null,
      /* 요청을 되풀이하지 않는다. 구성 채널이 활성인지를 **물어서** 판단한다. */
      verified:
        target === "pixels"
          ? probe.kind === "names" && probe.names.length > 0
          : probe.kind === "blocked",
    };
  });
}
