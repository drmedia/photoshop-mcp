import { app, constants } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers, toArray } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * 문서 평탄화와 닫기. (ROADMAP §17.25)
 *
 * ## 대화상자를 띄우지 않는다
 *
 * `close()` 에 인자를 주지 않으면 Photoshop 이 저장 여부를 묻는다. 그 대화상자가
 * 뜨면 **플러그인이 멈추고 Bridge 가 타임아웃한다.** §17.11 이 `window.capture`
 * 를 만든 이유가 그 상황이었다.
 *
 * 그래서 언제나 "저장하지 않음" 을 명시해 부른다.
 */

/** 숨긴 레이어 수. 평탄화가 버리는 것이라 결과에 담는다. */
function countHidden(layers: readonly LayerInfo[]): number {
  return layers.filter((entry) => !entry.visible).length;
}

export async function documentFlatten(): Promise<{
  layer: LayerInfo;
  previousLayers: number;
  hiddenDiscarded: number;
}> {
  return runModal("Flatten document", async () => {
    const document = requireActiveDocument();
    const before = flattenLayers(document.layers);

    if (before.length === 0) {
      throw new DispatchError("INVALID_PARAMETER", "합칠 레이어가 없습니다.", {
        recoverable: true,
      });
    }

    await document.flatten();

    // **요청이 아니라 결과를 읽는다.** 하나로 합쳐졌는지 직접 확인한다.
    const after = flattenLayers(requireActiveDocument().layers);
    if (after.length !== 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `평탄화 뒤 레이어가 ${after.length}장입니다. 하나로 합쳐지지 않았습니다.`,
        { details: { before: before.length, after: after.length } },
      );
    }

    return {
      layer: (await withMaskStateAsync(after))[0] as LayerInfo,
      previousLayers: before.length,
      hiddenDiscarded: countHidden(before),
    };
  });
}

export async function documentClose(params: { discardChanges: true }): Promise<{
  closed: { id: number; name: string };
  remainingDocuments: number;
}> {
  return runModal("Close document", async () => {
    // 스키마가 리터럴 `true` 를 강제하지만, 직접 Command 를 부르는 Extension 도
    // 있으므로 여기서도 확인한다. (ARCHITECTURE §3.2)
    if (params.discardChanges !== true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "discardChanges 에 true 를 명시해야 합니다. 저장하려면 document.save 를 먼저 부르세요.",
        { recoverable: true },
      );
    }

    const document = requireActiveDocument();
    const closed = { id: document.id, name: document.name };

    // **대화상자를 띄우지 않는다.** 상수를 얻지 못하면 인자 없이 부르지 않고
    // 실패한다 — 인자 없는 close 는 사람에게 묻는 창을 띄우고 Bridge 가 멈춘다.
    const doNotSave = constants.SaveOptions?.DONOTSAVECHANGES;
    if (doNotSave === undefined) {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에서 SaveOptions.DONOTSAVECHANGES 를 찾을 수 없습니다. " +
          "인자 없이 닫으면 저장 여부를 묻는 창이 떠 플러그인이 멈추므로 실행하지 않았습니다.",
        { recoverable: false },
      );
    }

    await document.close(doNotSave);

    // **닫혔는지 확인한다.** 닫지 못했는데 성공으로 보고하면 호출자는 사라진
    // 줄 안다. `app.documents` 는 배열이 아니라 배열 유사 컬렉션이다.
    const open = toArray<{ id: number }>(app.documents);
    if (open.some((entry) => entry.id === closed.id)) {
      throw new DispatchError("COMMAND_FAILED", `문서 ${closed.id} 가 닫히지 않았습니다.`, {
        details: { closed },
      });
    }

    return { closed, remainingDocuments: open.length };
  });
}
