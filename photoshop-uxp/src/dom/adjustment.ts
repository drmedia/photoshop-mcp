import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * Phase 4 조정 레이어. (ROADMAP §8.3)
 *
 * UXP DOM 에는 조정 레이어를 만드는 API 가 없어 `batchPlay` 를 쓴다.
 * ARCHITECTURE §13 이 "DOM 으로 처리하기 어려운 기능만 batchPlay" 로 허용한 경우다.
 *
 * **중요**: descriptor 는 이 모듈이 검증된 파라미터로 조립한다.
 * 호출자가 descriptor 를 직접 넘기는 통로는 없다. ARCHITECTURE §23 의
 * "LLM 이 임의 batchPlay descriptor 를 실행할 수 없도록 한다" 를 지키는 방식이다.
 */

type Channel = "composite" | "red" | "green" | "blue";

/** 채널 이름을 Photoshop descriptor 의 채널 참조로 바꾼다. */
function channelReference(channel: Channel | undefined): Record<string, unknown> {
  const name =
    channel === "red"
      ? "red"
      : channel === "green"
        ? "grain"
        : channel === "blue"
          ? "blue"
          : "composite";
  return { _ref: "channel", _enum: "channel", _value: name };
}

/** 조정 레이어를 만들고 결과를 프로토콜 형태로 돌려준다. */
export async function makeAdjustmentLayer(
  commandName: string,
  type: Record<string, unknown>,
  name: string | undefined,
): Promise<LayerInfo> {
  return runModal(commandName, async () => {
    const document = requireActiveDocument();

    /* **`presetKind` 가 없으면 Photoshop 속성 패널이 열리지 않는다.**
     *
     * 조정 레이어의 존재 이유는 나중에 값을 고칠 수 있다는 것인데, 이것이
     * 빠지면 레이어는 만들어지고 보정도 적용되지만 슬라이더를 볼 수 없다.
     * 실기에서 채도를 다시 만지려다 드러났다 — 만드는 것만 확인하고
     * **고칠 수 있는지는 확인하지 않았다.**
     *
     * 키는 짐작한 것이 아니라 `addNotificationListener(["all"])` 로 잡았다.
     * 사람이 색조/채도 조정 레이어를 만들 때 Photoshop 이 쓰는 것이다(§17.17).
     *
     * `presetKindCustom` 이다. Photoshop 이 기본값으로 만들 때는
     * `presetKindDefault` 를 쓰지만, 우리는 언제나 값을 지정해 만든다.
     *
     * 호출자가 이미 넣었으면 덮지 않는다 — 타입마다 다른 값이 필요할 수 있다. */
    const typeWithPreset: Record<string, unknown> = {
      presetKind: { _enum: "presetKindType", _value: "presetKindCustom" },
      ...type,
    };

    const descriptor: Record<string, unknown> = {
      _obj: "make",
      _target: [{ _ref: "adjustmentLayer" }],
      using: {
        _obj: "adjustmentLayer",
        type: typeWithPreset,
        ...(name === undefined ? {} : { name }),
      },
    };

    const results = await action.batchPlay([descriptor], {});
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { commandName },
      });
    }

    // 새 조정 레이어가 활성 레이어가 된다. 목록에서 찾아 계층 정보까지 채운다.
    const active = document.activeLayers[0];
    if (active === undefined) {
      throw new DispatchError("COMMAND_FAILED", "조정 레이어를 만든 뒤 찾을 수 없습니다.", {
        details: { commandName },
      });
    }
    const found = flattenLayers(document.layers).find((entry) => entry.id === active.id);
    if (found === undefined) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "만들어진 조정 레이어를 목록에서 찾지 못했습니다.",
        {
          details: { commandName, layerId: active.id },
        },
      );
    }
    return found;
  });
}

export interface CurvePoint {
  input: number;
  output: number;
}

export async function adjustmentCurves(params: {
  channel?: Channel;
  points: CurvePoint[];
  name?: string;
}): Promise<LayerInfo> {
  return makeAdjustmentLayer(
    "Curves adjustment",
    {
      _obj: "curves",
      adjustment: [
        {
          _obj: "curvesAdjustment",
          channel: channelReference(params.channel),
          curve: params.points.map((point) => ({
            _obj: "paint",
            horizontal: point.input,
            vertical: point.output,
          })),
        },
      ],
    },
    params.name,
  );
}

export async function adjustmentLevels(params: {
  channel?: Channel;
  inputShadow?: number;
  inputHighlight?: number;
  gamma?: number;
  outputShadow?: number;
  outputHighlight?: number;
  name?: string;
}): Promise<LayerInfo> {
  const adjustment: Record<string, unknown> = {
    _obj: "levelsAdjustment",
    channel: channelReference(params.channel),
  };

  // Photoshop 은 입력 범위와 감마를 하나의 배열로 받는다.
  const inputShadow = params.inputShadow ?? 0;
  const inputHighlight = params.inputHighlight ?? 255;
  adjustment["input"] = [inputShadow, inputHighlight];
  if (params.gamma !== undefined) {
    adjustment["gamma"] = params.gamma;
  }
  if (params.outputShadow !== undefined || params.outputHighlight !== undefined) {
    adjustment["output"] = [params.outputShadow ?? 0, params.outputHighlight ?? 255];
  }

  return makeAdjustmentLayer(
    "Levels adjustment",
    { _obj: "levels", adjustment: [adjustment] },
    params.name,
  );
}

export async function adjustmentBrightnessContrast(params: {
  brightness?: number;
  contrast?: number;
  name?: string;
}): Promise<LayerInfo> {
  return makeAdjustmentLayer(
    "Brightness/Contrast adjustment",
    {
      _obj: "brightnessEvent",
      brightness: params.brightness ?? 0,
      center: params.contrast ?? 0,
      useLegacy: false,
    },
    params.name,
  );
}
