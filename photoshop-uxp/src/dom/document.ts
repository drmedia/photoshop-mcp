import { app, core, type PhotoshopDocument } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { toBitDepth, toColorMode } from "./mappings.js";

/**
 * `DOCUMENT_GET` — 활성 문서 정보. (PROTOCOL.md §4)
 *
 * Photoshop DOM API 를 사용한다. batchPlay 를 쓰지 않는다. (ARCHITECTURE §13)
 */
export async function documentGet(): Promise<DocumentInfo> {
  return core.executeAsModal(async () => toDocumentInfo(requireActiveDocument()), {
    commandName: "Get document info",
  });
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

export function toDocumentInfo(document: PhotoshopDocument): DocumentInfo {
  return {
    id: document.id,
    name: document.name,
    width: Math.round(document.width),
    height: Math.round(document.height),
    bitDepth: toBitDepth(document.bitsPerChannel),
    colorMode: toColorMode(document.mode),
  };
}
