import { app, type PhotoshopDocument } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { toArray } from "./layers.js";
import { toBitDepth, toColorMode } from "./mappings.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_GET` — 활성 문서 정보. (PROTOCOL.md §4)
 *
 * Photoshop DOM API 를 사용한다. batchPlay 를 쓰지 않는다. (ARCHITECTURE §13)
 */
export async function documentGet(): Promise<DocumentInfo> {
  return runModal("Get document info", () => toDocumentInfo(requireActiveDocument()));
}

/** 활성 문서를 반환한다. 없으면 `DOCUMENT_NOT_FOUND`. */
export function requireActiveDocument(): PhotoshopDocument {
  const document = app.activeDocument;
  if (document === null || document === undefined) {
    throw new DispatchError("DOCUMENT_NOT_FOUND", "열려 있는 문서가 없습니다.", {
      recoverable: true,
    });
  }
  return document;
}

/**
 * `DOCUMENT_LIST` — 열려 있는 문서 전부. (CORE_API §5 P1)
 *
 * **`active` 를 함께 준다.** 편집 Command 는 `layerId` 를 생략하면 활성
 * 문서를 대상으로 삼는다 — 어느 것인지 모르면 결과를 예측할 수 없다.
 * `layer.get_active` 가 "편집 Tool 이 실제로 무엇을 건드리는지" 를 알려주는
 * 것과 같은 자리다.
 *
 * 문서가 하나도 없으면 **빈 배열이다. 오류가 아니다** — Photoshop 을 켜 두고
 * 아무것도 안 연 상태는 정상이다. `document.get` 이 `DOCUMENT_NOT_FOUND` 를
 * 던지는 것과 다르다. 그쪽은 활성 문서를 요구하고 이쪽은 세어 보는 것이다.
 */
export async function documentList(): Promise<{
  documents: (DocumentInfo & { active: boolean })[];
}> {
  return runModal("List documents", () => {
    const activeId = app.activeDocument?.id;
    /* `app.documents` 는 배열이 아니라 배열 유사 컬렉션이다. 그대로 map 하면
     * 조용히 빈 결과가 나온다 — `document.close` 에서 같은 자리를 겪었다. */
    const open = toArray<PhotoshopDocument>(app.documents);
    return {
      documents: open.map((entry) => ({
        ...toDocumentInfo(entry),
        active: activeId !== undefined && entry.id === activeId,
      })),
    };
  });
}

export function toDocumentInfo(document: PhotoshopDocument): DocumentInfo {
  const depth = toBitDepth(document.bitsPerChannel);
  return {
    id: document.id,
    name: document.name,
    width: Math.round(document.width),
    height: Math.round(document.height),
    bitDepth: depth.bitDepth,
    ...(depth.raw === undefined ? {} : { rawBitDepth: depth.raw }),
    colorMode: toColorMode(document.mode),
  };
}
