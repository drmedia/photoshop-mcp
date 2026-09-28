import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers, toArray, toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";
import type { PhotoshopLayer } from "photoshop";

/**
 * `DOCUMENT_MERGE_VISIBLE` — 보이는 레이어를 하나로 합친다. (CORE_API §5)
 *
 * ## 셋이 비슷하고 셋 다 다르다
 *
 * ```text
 * layer.stamp_visible      합친 **복제본**을 만든다. 원본은 남는다      edit
 * document.merge_visible   보이는 것을 합친다. **숨긴 것은 남는다**    destructive
 * document.flatten         전부 합친다. **숨긴 것은 버려진다**          destructive
 * ```
 *
 * 가운데가 이것이다. `flatten` 과의 차이는 **숨긴 레이어가 살아남는다**는 것이고,
 * `stamp_visible` 과의 차이는 **원본이 사라진다**는 것이다. 결과에 전후 개수를
 * 담아 그 둘을 호출자가 눈으로 확인할 수 있게 한다.
 *
 * ## 활성 레이어가 숨겨져 있으면 **아무 일도 안 일어난다**
 *
 * 실기에서 잡았다. 오류도 나지 않고 레이어 수도 그대로다 — 이 프로젝트가
 * 반복해서 겪은 "조용한 실패" 다(배경 `set_opacity` · Camera Raw 정수 ·
 * 파라메트릭 곡선 · `documents.add` 의 `bitsPerChannel`).
 *
 * Photoshop UI 에서도 숨긴 레이어가 선택돼 있으면 `보이는 레이어 병합` 이 회색
 * 처리된다. **미리 막고 무엇을 하라고 말한다** — Camera Raw 가 숨긴 레이어를
 * 미리 막는 것과 같은 자리다(§17.17).
 *
 * ## 합칠 것이 없으면 미리 막는다
 *
 * 보이는 레이어가 하나뿐이면 Photoshop 이 "명령을 사용할 수 없습니다" 라고만
 * 답해 이유를 알 수 없다.
 */

export interface LayerCounts {
  total: number;
  visible: number;
  hidden: number;
}

export interface MergeVisibleResult {
  /**
   * 병합 뒤 활성 레이어. **읽은 값이지 "이것이 결과다" 라는 주장이 아니다.**
   * 확실히 하려면 `layer.list` 로 확인한다.
   */
  activeLayer: LayerInfo | null;
  before: LayerCounts;
  after: LayerCounts;
  /** 사라진 레이어 수. `before.total - after.total` 이다. */
  removed: number;
}

function countLayers(document: ReturnType<typeof requireActiveDocument>): LayerCounts {
  const all = flattenLayers(document.layers);
  const visible = all.filter((layer) => layer.visible).length;
  return { total: all.length, visible, hidden: all.length - visible };
}

export async function documentMergeVisible(): Promise<MergeVisibleResult> {
  return runModal("Merge visible", async () => {
    const document = requireActiveDocument();

    const merge = (document as unknown as Record<string, unknown>)["mergeVisibleLayers"];
    if (typeof merge !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.mergeVisibleLayers 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    /* **활성 레이어가 숨겨져 있으면 조용히 아무 일도 안 일어난다.** 실기에서
     * 잡았다(ROADMAP §40). 보이는 레이어를 고르라고 말한다. */
    const active = toArray<PhotoshopLayer>(document.activeLayers)[0];
    if (active !== undefined && active.visible === false) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `활성 레이어 "${String(active.name)}" 가 숨겨져 있어 병합이 일어나지 않습니다. ` +
          "photoshop.layer.select 로 보이는 레이어를 먼저 고르세요.",
        { recoverable: true, details: { activeLayerId: active.id } },
      );
    }

    const before = countLayers(document);
    if (before.visible < 2) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `보이는 레이어가 ${before.visible}장이라 합칠 것이 없습니다. ` +
          "photoshop.layer.list 로 무엇이 보이는지 확인하세요.",
        { recoverable: true, details: { before } },
      );
    }

    try {
      await (merge as () => Promise<void>).call(document);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `보이는 레이어를 합치지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { before } },
      );
    }

    const after = countLayers(document);

    /* 활성 레이어를 **읽어서** 담는다. 병합 결과가 어느 것인지 Photoshop 이
     * 알려주지 않으므로 위치나 순서로 추정하지 않는다.
     *
     * 실기에서 본 규칙은 이렇다(ROADMAP §40). Adobe 레퍼런스와도 맞는다.
     *
     * ```text
     * 배경이 있다   →  배경이 남는다 (isBackground 유지)
     * 배경이 없다   →  선택한 레이어가 남는다. 배경으로 바뀌지 않는다
     * ```
     *
     * **`flatten` 은 언제나 배경으로 만든다** — 레퍼런스가 둘을 그렇게 가른다. */
    const merged = toArray<PhotoshopLayer>(document.activeLayers)[0];
    const activeLayer =
      merged === undefined
        ? null
        : ((await withMaskStateAsync([toLayerInfo(merged)]))[0] as LayerInfo);

    return { activeLayer, before, after, removed: before.total - after.total };
  });
}
