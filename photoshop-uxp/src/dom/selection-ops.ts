import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers } from "./layers.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";
import { resolveMutatedLayer } from "./mutation-result.js";
import { selectionBounds } from "./state-read.js";

/**
 * 선택 영역 조작과 병합본 복제. (ROADMAP §17.8)
 *
 * 실제 편집 워크플로에서 막히던 것들이다 — 선택을 채널로 저장했다가 다시 불러오기,
 * 이미 만든 선택의 페더·확장·축소, 광도 기반 선택, 그리고 보이는 레이어를 합친
 * 복제본 만들기.
 *
 * UXP DOM 에 API 가 없어 batchPlay 를 쓴다. descriptor 는 검증된 파라미터로 이
 * 모듈이 조립한다. (ARCHITECTURE §13, §23)
 */

interface SelectionResult {
  hasSelection: boolean;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

async function play(commandName: string, descriptor: Record<string, unknown>): Promise<void> {
  const results = await action.batchPlay([descriptor], {});
  const failure = results.find((result) => result["message"] !== undefined);
  if (failure !== undefined) {
    throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
      details: { commandName },
    });
  }
}

function describeSelection(): SelectionResult {
  const has = hasSelection();
  return { hasSelection: has, bounds: has ? selectionBounds() : null };
}

/** 선택이 없으면 할 수 있는 일이 없다. 무엇을 해야 하는지 말해 준다. */
function requireSelection(what: string): void {
  if (!hasSelection()) {
    throw new DispatchError("INVALID_PARAMETER", `${what} 하려면 선택 영역이 있어야 합니다.`, {
      recoverable: true,
    });
  }
}

const px = (value: number): Record<string, unknown> => ({ _unit: "pixelsUnit", _value: value });

/** 현재 선택을 알파 채널로 저장한다. */
export async function selectionSaveChannel(params: { name: string }): Promise<{ name: string }> {
  return runModal("Save selection to channel", async () => {
    requireActiveDocument();
    requireSelection("선택을 채널로 저장");
    await play("Save selection", {
      _obj: "duplicate",
      _target: [{ _ref: "channel", _property: "selection" }],
      name: params.name,
    });
    return { name: params.name };
  });
}

/**
 * 저장해 둔 알파 채널에서 선택을 불러온다.
 *
 * `invert` 는 불러오면서 반전한다. 하늘 채널 하나로 전경까지 얻을 수 있어
 * 채널을 두 개 만들지 않아도 된다.
 */
export async function selectionLoadChannel(params: {
  name: string;
  invert?: boolean;
}): Promise<SelectionResult> {
  return runModal("Load selection from channel", async () => {
    requireActiveDocument();
    try {
      await play("Load selection", {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: { _ref: "channel", _name: params.name },
        ...(params.invert === true ? { invert: true } : {}),
      });
    } catch {
      // 없는 채널이면 Photoshop 이 `"설정" 명령은 현재 사용할 수 없습니다` 라고
      // 답한다. 원문으로는 이름이 틀렸는지조차 알 수 없다. 실기에서 저장이 실패해
      // 채널이 없는 상태로 불러오다 이 벽을 만났다.
      throw new DispatchError(
        "COMMAND_FAILED",
        `채널 '${params.name}' 을 불러올 수 없습니다. ` +
          "selection.save_channel 로 저장한 이름인지 확인하세요.",
        { recoverable: true, details: { name: params.name } },
      );
    }
    return describeSelection();
  });
}

/**
 * 이미 만든 선택을 다듬는다.
 *
 * `selection.set` 의 `feather` 는 만들 때만 쓸 수 있다. 지평선 마스크의 경계를
 * 나중에 부드럽게 하는 작업은 이쪽이 필요하다.
 */
export async function selectionModify(params: {
  operation: "feather" | "expand" | "contract" | "smooth";
  radius: number;
}): Promise<SelectionResult> {
  return runModal("Modify selection", async () => {
    requireActiveDocument();
    requireSelection("선택을 다듬기");

    const descriptor: Record<string, unknown> =
      params.operation === "feather"
        ? { _obj: "feather", radius: px(params.radius) }
        : params.operation === "smooth"
          ? { _obj: "smooth", radius: px(params.radius) }
          : { _obj: params.operation, by: px(params.radius) };

    await play(`Selection ${params.operation}`, descriptor);
    return describeSelection();
  });
}

/**
 * 광도 구간으로 선택한다. (색상 범위의 밝기 모드)
 *
 * 천체사진의 광도 마스크가 이것이다 — 밝은 부분만 골라 은하수 중심부를 살리거나,
 * 어두운 부분만 골라 노이즈를 다룬다.
 *
 * `fuzziness` 는 경계의 너그러움(0–200)이다. 크면 더 넓게 잡힌다.
 */
export async function selectionColorRange(params: {
  range: "highlights" | "midtones" | "shadows";
  fuzziness?: number;
}): Promise<SelectionResult> {
  return runModal("Color range", async () => {
    requireActiveDocument();
    await play("Color range", {
      _obj: "colorRange",
      fuzziness: params.fuzziness ?? 40,
      colors: { _enum: "colors", _value: params.range },
    });
    return describeSelection();
  });
}

/**
 * 보이는 레이어를 합친 **복제본**을 새 레이어로 만든다. (Stamp Visible)
 *
 * 원본 레이어들은 그대로 남는다. 샤프닝처럼 "지금까지의 결과 전체" 를 대상으로
 * 삼아야 하는 단계에서 필요하다.
 */
export async function layerStampVisible(params: { name?: string }): Promise<LayerInfo> {
  return runModal("Stamp visible", async () => {
    const document = requireActiveDocument();
    const layers = flattenLayers(document.layers);

    // 보이는 레이어가 하나뿐이면 Photoshop 이 '보이는 레이어 병합' 을 막는다.
    // 원문("명령은 현재 사용할 수 없습니다")으로는 왜인지 알 수 없다. 실기에서 확인했다.
    const visible = layers.filter((entry) => entry.visible && entry.type !== "group");
    if (visible.length < 2) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `보이는 레이어가 ${visible.length}장뿐이라 병합할 것이 없습니다. ` +
          "2장 이상이어야 합니다 — 합칠 필요가 없으면 layer.duplicate 를 쓰세요.",
        { recoverable: true, details: { visibleCount: visible.length } },
      );
    }

    const before = layers.map((entry) => entry.id);

    await play("Merge visible copy", { _obj: "mergeVisible", duplicate: true });

    const after = flattenLayers(document.layers);
    const created = resolveMutatedLayer(before, after, null);
    if (created === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "병합본은 만들어졌지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true },
      );
    }
    if (params.name === undefined) {
      return created;
    }
    await play("Rename merged copy", {
      _obj: "set",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      to: { _obj: "layer", name: params.name },
    });
    return flattenLayers(document.layers).find((entry) => entry.id === created.id) ?? created;
  });
}
