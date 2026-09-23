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
  mode?: "new" | "intersect";
}): Promise<SelectionResult> {
  return runModal("Load selection from channel", async () => {
    requireActiveDocument();
    if (params.mode === "intersect" && !hasSelection()) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "교집합을 낼 선택 영역이 없습니다. mode 를 빼거나 선택을 먼저 만드세요.",
        { recoverable: true },
      );
    }
    try {
      if (params.mode === "intersect") {
        /* 이름이 하는 일과 상관없다 — 실기에서 잡은 값이다. RGB 합성 채널과
         * 교차할 때와 같은 `_obj` 이고 `_target` 의 참조 형태만 다르다. */
        await play("Intersect channel", {
          _obj: "interfaceIconFrameDimmed",
          _target: [{ _ref: "channel", _name: params.name }],
          with: { _ref: "channel", _property: "selection" },
        });
        if (params.invert === true) {
          await play("Invert selection", { _obj: "inverse" });
        }
        return describeSelection();
      }
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
 * 합성 휘도를 선택으로 가져온다. 채널 패널에서 RGB 를 Ctrl+클릭하는 그것이다.
 *
 * ## `color_range` 와 무엇이 다른가
 *
 * `selection.color_range` 는 **임계 기반 구간 선택**이라 결과가 거의 이진에
 * 가깝다. 실기에서 highlights 마스크가 거의 새까맣고 shadows 마스크가 거의
 * 새하얗게 나왔다 — 성운처럼 계조가 이어지는 구조를 따라가지 못한다.
 *
 * 이쪽은 **픽셀의 밝기가 그대로 선택 강도**가 된다. 연속 계조라 구조를 그대로
 * 따라가고, 이것이 흔히 말하는 광도 마스크다.
 *
 * ## descriptor 는 짐작하지 않았다
 *
 * 서버를 띄워 둔 채로 사람이 채널 패널에서 Ctrl+클릭하게 하고
 * `photoshop.event.recent` 로 받아 적었다. (ROADMAP §17.17 과 같은 방법)
 *
 * ```text
 * photoshop.selection.changed
 *   { _obj: "set", _target: [{_ref:"channel",_property:"selection"}],
 *     to: { _ref: "channel", _enum: "channel", _value: "RGB" } }
 * ```
 *
 * History 에는 `Load Selection` 으로 남는다. 같은 조작을 메뉴가 아니라 패널
 * 클릭으로 하면 `invokeCommand { commandID: 1004 }` 만 남아 재생할 수 없다 —
 * 처음에 그것만 보고 "기록되지 않는다" 고 판단했는데, 한 번 더 눌러 보니
 * 위 descriptor 가 함께 나왔다.
 */
export async function selectionLuminosity(params: {
  invert?: boolean;
  mode?: "new" | "intersect";
}): Promise<SelectionResult> {
  return runModal("Load luminosity selection", async () => {
    requireActiveDocument();

    if (params.mode === "intersect") {
      if (!hasSelection()) {
        throw new DispatchError(
          "INVALID_PARAMETER",
          "교집합을 낼 선택 영역이 없습니다. mode 를 빼거나 선택을 먼저 만드세요.",
          { recoverable: true },
        );
      }
      /* **이름이 하는 일과 전혀 상관없다.** Photoshop 이 내부 이벤트 ID 를
       * 문자열로 되짚는 과정에서 엉뚱한 이름이 붙는 경우가 있고 이것이
       * 그렇다. 짐작으로는 나올 수 없는 값이라 실기에서 잡았다 —
       * 사람이 채널 패널에서 Ctrl+Alt+Shift+클릭하는 것을 받아 적었다. */
      await play("Intersect luminosity", {
        _obj: "interfaceIconFrameDimmed",
        _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }],
        with: { _ref: "channel", _property: "selection" },
      });
      if (params.invert === true) {
        await play("Invert luminosity selection", { _obj: "inverse" });
      }
      return describeSelection();
    }

    await play("Load luminosity", {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      /* **`_name` 이 아니라 `_enum`/`_value` 다.** 이름 있는 알파 채널을 부르는
       * `load_channel` 과 여기서 갈린다. */
      to: { _ref: "channel", _enum: "channel", _value: "RGB" },
    });

    /* **`invert: true` 를 위 descriptor 에 함께 넣으면 조용히 무시된다.**
     * `load_channel` 에서는 같은 키가 먹는데 합성 채널 형태에서는 안 먹는다 —
     * 실기에서 경계가 안 변하는 것으로 잡았다(검은 지상이 안 들어왔다).
     * 오류가 나지 않으므로 반전된 줄 알고 넘어가기 쉽다. 따로 반전한다. */
    if (params.invert === true) {
      await play("Invert luminosity selection", { _obj: "inverse" });
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
