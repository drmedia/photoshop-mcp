import { action } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { hasSelection } from "./mask-selection.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";
import { selectionBounds } from "./state-read.js";

/**
 * Photoshop 네이티브 자동 선택 — `선택 > 하늘`.
 *
 * UXP DOM 에 API 가 없어 batchPlay 를 쓴다. descriptor 는 파라미터가 없는 고정값이며
 * 이 모듈이 조립한다. (ARCHITECTURE §13, §23)
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

/**
 * 선택 결과를 읽는다.
 *
 * 자동 선택은 **아무것도 못 찾을 수 있다.** 하늘이 없는 사진이 그렇다. 그때는
 * 실패가 아니라 `hasSelection: false` 다 — 조회에서 '없음' 은 답이지 오류가 아니다.
 *
 * 경계 파싱은 `state-read` 의 것을 쓴다. UXP 가 단위 객체(`{_value, _unit}`)로 줄
 * 때가 있어 직접 읽으면 틀린다.
 */
function describeSelection(): SelectionResult {
  const has = hasSelection();
  return { hasSelection: has, bounds: has ? selectionBounds() : null };
}

export async function selectionSky(): Promise<SelectionResult> {
  return runModal("Select sky", async () => {
    const document = requireActiveDocument();

    // **그룹이 활성이면 Photoshop 이 거부한다.** 조정 레이어는 괜찮다.
    // 원문("'하늘 선택' 명령은 현재 사용할 수 없습니다")으로는 왜인지 알 수 없다.
    //
    // 워크플로 순서상 흔히 걸린다 — 그룹을 만들면 그룹이 활성이 되고, 바로 다음이
    // 하늘 선택인 경우가 많다. 실기에서 그렇게 막혔다.
    const active = document.activeLayers[0];
    if (active !== undefined && toLayerType(active.kind).type === "group") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "그룹이 활성 레이어면 하늘을 선택할 수 없습니다. " +
          "layer.select 로 픽셀 레이어나 조정 레이어를 먼저 고르세요.",
        { recoverable: true, details: { layerId: active.id } },
      );
    }

    await play("Select sky", { _obj: "selectSky" });
    return describeSelection();
  });
}
