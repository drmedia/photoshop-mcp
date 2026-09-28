import { app, type PhotoshopDocument } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument, toDocumentInfo } from "./document.js";
import { resolveDuplicatedDocumentId } from "./duplicated-document.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_DUPLICATE` — 활성 문서를 복제한다. (CORE_API §5 P2)
 *
 * ## 되돌릴 수 없는 작업 앞의 안전망이다
 *
 * `image.resize` · `document.flatten` · `mask.apply` 는 되돌릴 수 없다.
 * 복제본에서 하면 원본이 남는다 — 이 프로젝트의 `export_tiff` 가 이미 그렇게
 * 한다(평탄화와 심도 변경이 원본에 남으면 안 되기 때문이다).
 *
 * ## 돌려준 객체를 믿지 않는다
 *
 * **`Document.duplicate()` 가 돌려준 객체의 `id` 가 `undefined` 일 때가 있다.**
 * 실기에서 잡았고 `duplicated-document.ts` 에 적어 두었다. 목록의 차이로 찾는
 * 같은 헬퍼를 쓴다 — 여기서 새로 짜면 그 실수를 다시 하게 된다.
 *
 * `app.activeDocument` 로 추정하지 않는다. 복제본이 반드시 활성이 된다는 보장이
 * 없고, 틀리면 사용자의 원본을 가리키게 된다.
 *
 * ## `mergeLayersOnly` 는 이름이 말하는 것과 다르다
 *
 * 레이어를 합치는 것이 아니라 **합친 결과 한 장만** 복제본에 넣는다. 원본은
 * 건드리지 않는다. 실제 동작은 결과의 `layers` 로 확인한다 — 요청값을 되풀이하지
 * 않는다.
 *
 * ## 활성 문서가 바뀐다
 *
 * Photoshop 이 복제본을 활성으로 삼는지 확인하고 **실제로 무엇이 활성인지**를
 * `active` 에 담는다. 이후 편집 Command 는 대상을 생략하면 활성 문서를 쓰므로
 * 이것을 모르면 결과를 예측할 수 없다 — `document.create` 와 같은 자리다.
 */

export interface DocumentDuplicateResult {
  /** 복제본. */
  document: DocumentInfo;
  /** 복제 후 실제로 활성인 문서의 id. 복제본과 다를 수 있다. */
  activeDocumentId: number | null;
  /** 복제본의 레이어 수. `mergeLayersOnly` 가 먹었는지 여기서 드러난다. */
  layers: number | null;
  /** 복제 전 문서 수 → 복제 후 문서 수. */
  openDocuments: number;
}

/** 레이어 수. 못 읽으면 `null` — 0 으로 채우면 "빈 문서" 라는 틀린 사실이 된다. */
function layerCount(document: PhotoshopDocument): number | null {
  try {
    const layers = toArray<unknown>(document.layers);
    return layers.length;
  } catch {
    return null;
  }
}

export async function documentDuplicate(params: {
  name?: string;
  mergeLayersOnly?: boolean;
}): Promise<DocumentDuplicateResult> {
  return runModal("Duplicate document", async () => {
    const original = requireActiveDocument();

    const duplicate = (original as unknown as Record<string, unknown>)["duplicate"];
    if (typeof duplicate !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.duplicate 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const beforeIds = toArray<{ id: number }>(app.documents).map((entry) => entry.id);

    let returned: unknown;
    try {
      returned = await (duplicate as (...args: unknown[]) => Promise<unknown>).call(
        original,
        params.name,
        params.mergeLayersOnly,
      );
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `문서를 복제하지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { name: params.name } },
      );
    }

    const open = toArray<PhotoshopDocument>(app.documents);
    const copyId = resolveDuplicatedDocumentId(
      beforeIds,
      (returned as { id?: unknown } | null | undefined)?.id,
      open.map((entry) => entry.id),
    );
    const copy = open.find((entry) => entry.id === copyId);

    if (copy === undefined) {
      /* **어느 것이 복제본인지 모른다.** 추측해서 원본을 복제본이라고 말하면
       * 호출자가 그 문서에 되돌릴 수 없는 작업을 건다 — 이 Command 를 만든
       * 이유가 바로 그것을 막는 것이다. 복제본이 열려 있을 수 있다는 것까지
       * 말한다. */
      throw new DispatchError(
        "COMMAND_FAILED",
        "복제는 되었을 수 있으나 어느 것이 복제본인지 확인하지 못했습니다. " +
          "photoshop.document.list 로 확인하고, 이름 없는 문서가 있으면 저장하지 말고 닫으십시오.",
        {
          recoverable: true,
          details: {
            before: beforeIds,
            after: open.map((entry) => entry.id),
            returnedId: (returned as { id?: unknown } | null | undefined)?.id ?? null,
          },
        },
      );
    }

    /* **무엇이 활성인지 읽어서 답한다.** 복제본이 반드시 활성이 된다고
     * 적어 두면, 그렇지 않은 날 호출자가 원본을 편집하게 된다. */
    const activeId = (() => {
      try {
        const active = app.activeDocument;
        return typeof active?.id === "number" ? active.id : null;
      } catch {
        return null;
      }
    })();

    return {
      document: toDocumentInfo(copy),
      activeDocumentId: activeId,
      layers: layerCount(copy),
      openDocuments: open.length,
    };
  });
}
