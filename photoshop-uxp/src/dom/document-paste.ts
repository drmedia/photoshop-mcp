import type { PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { toBounds, type LayerBounds } from "./layer-get.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers, toLayerInfo } from "./layers.js";
import { hasSelection } from "./mask-selection.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_PASTE` — 클립보드 내용을 붙여 넣는다. (CORE_API §5)
 *
 * ## 이 서버에서 성격이 다른 Command 다
 *
 * 나머지는 문서 안에서 끝나는데 **이것은 사용자의 클립보드를 문서로 끌어들인다.**
 * 무엇이 들어올지 서버도 호출자도 알 수 없다 — 사용자가 방금 복사한 것이면
 * 무엇이든 온다.
 *
 * 그래서 `external` 이다. `layer.place` 가 승인된 폴더의 파일을 읽어 `external`
 * 인 것과 같은 논리이고, **클립보드는 그런 폴더 승인조차 없다.**
 *
 * 들어온 것은 `document.capture` · `document.statistics` 로 읽을 수 있다. 즉
 * 이 Command 는 **사용자의 클립보드를 LLM 이 볼 수 있게 만드는 통로**다. 기본
 * 허용 밖에 두는 이유가 그것이다.
 *
 * ## 무엇이 왔는지 크기로 알린다
 *
 * 내용을 해석하지 않는다. 대신 만들어진 레이어와 그 **경계**를 담는다 —
 * 호출자가 "붙여 넣어졌는가, 얼마나 큰가" 를 확인할 수 있어야 한다.
 *
 * **위치를 짐작하지 않는다.** 실기에서 선택 영역이 있는 채로 붙여 넣었더니
 * 그 자리에 들어왔는데, 그것이 "제자리에 붙이기" 인지 "선택에 맞춰 가운데"
 * 인지 한 번의 측정으로는 가를 수 없다. 결과의 `bounds` 를 읽는다.
 *
 * ## `intoSelection` 은 **마스크를 만든다**
 *
 * 실기에서 확인했다(ROADMAP §41). 선택 영역을 마스크로 쓰는 레이어가 생기고
 * 내용이 그 안에 맞춰진다 — 200×120 을 180×130 선택에 넣었더니 180×120 으로
 * 잘려 세로 가운데에 놓였다. 결과의 `layer.hasMask` 가 `true` 다.
 *
 * ## 클립보드가 비면 **던지지 않고 빈 값을 돌려준다**
 *
 * 실기에서 잡았다(ROADMAP §41). `paste()` 가 `null` 을 돌려주고 문서는 그대로다.
 * 처음에는 그 경우에 "붙여 넣었지만 결과를 확인하지 못했습니다" 라고 답했는데
 * **거짓말이었다** — 아무 일도 안 일어났다.
 *
 * 그래서 **레이어 목록을 전후로 떠서** 판단한다. 늘지 않았으면 붙여 넣어지지
 * 않은 것이고, 늘었으면 돌려받은 객체가 쓸모없어도 그 레이어를 찾아낸다.
 * `mutate()` 가 배경 승격을 다루는 방식과 같다.
 *
 * 클립보드가 비었는지 미리 볼 방법은 UXP 에 없다.
 */

export interface PasteResult {
  layer: LayerInfo;
  /** 붙여 넣어진 내용의 경계. 못 읽으면 `null`. */
  bounds: LayerBounds | null;
  /** 실제로 쓴 값. 선택 영역 안에 넣었는가. */
  intoSelection: boolean;
}

export async function documentPaste(params: { intoSelection?: boolean }): Promise<PasteResult> {
  const intoSelection = params.intoSelection ?? false;
  return runModal("Paste", async () => {
    const document = requireActiveDocument();

    const paste = (document as unknown as Record<string, unknown>)["paste"];
    if (typeof paste !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.paste 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    /* **선택 영역이 없는데 `intoSelection` 을 주면 미리 막는다.** 그대로 넘기면
     * Photoshop 이 그냥 가운데에 붙여 넣고, 호출자는 선택 안에 들어간 줄 안다 —
     * `mask.create` 의 `fromSelection` 과 같은 자리다. */
    if (intoSelection && !hasSelection()) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "선택 영역이 없어 intoSelection 을 쓸 수 없습니다. " +
          "photoshop.selection.* 로 먼저 선택하거나 intoSelection 을 빼세요.",
        { recoverable: true },
      );
    }

    /* 변경 **전** id 를 떠 둔다. 돌려받은 객체를 믿지 않는 이 프로젝트의
     * 기본 규칙이다(`resolveMutatedLayer` · `duplicated-document.ts`). */
    const beforeIds = new Set(flattenLayers(document.layers).map((entry) => entry.id));

    let created: unknown;
    try {
      created = await (paste as (...args: unknown[]) => Promise<unknown>).call(
        document,
        intoSelection,
      );
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "붙여 넣지 못했습니다. 클립보드가 비었거나 Photoshop 이 읽을 수 없는 " +
          `내용일 수 있습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { intoSelection } },
      );
    }

    /* **돌려받은 객체가 비면 목록의 차이로 찾는다.** 클립보드가 비었을 때
     * `paste()` 는 던지지 않고 `null` 을 준다 — 실기에서 확인했다. */
    let layer = created as PhotoshopLayer | null | undefined;
    if (layer === null || layer === undefined) {
      const appeared = flattenLayers(document.layers).filter((entry) => !beforeIds.has(entry.id));
      if (appeared.length === 0) {
        /* **아무 일도 안 일어났다.** "붙여 넣었지만" 이라고 말하면 호출자가
         * 문서가 바뀐 줄 안다. */
        throw new DispatchError(
          "COMMAND_FAILED",
          "붙여 넣어지지 않았습니다 — 문서는 그대로입니다. " +
            "클립보드가 비었거나 Photoshop 이 읽을 수 없는 내용일 수 있습니다.",
          { recoverable: true, details: { intoSelection } },
        );
      }
      layer = findLayerById(document.layers, (appeared[0] as LayerInfo).id) ?? undefined;
      if (layer === null || layer === undefined) {
        throw new DispatchError(
          "COMMAND_FAILED",
          "붙여 넣어졌지만 결과 레이어를 확인하지 못했습니다. photoshop.layer.list 로 확인하세요.",
          { recoverable: true, details: { intoSelection } },
        );
      }
    }

    const info = (await withMaskStateAsync([toLayerInfo(layer)]))[0] as LayerInfo;
    const raw = layer as unknown as Record<string, unknown>;

    return { layer: info, bounds: toBounds(raw["bounds"]), intoSelection };
  });
}
