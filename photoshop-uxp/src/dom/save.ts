import type { PhotoshopDocument } from "photoshop";
import type { Folder } from "uxp";
import type { SaveResult } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";
import { exportTiff } from "./export-tiff.js";
import { entryExists, requireWorkspace } from "./workspace.js";

/**
 * Phase 9 파일 저장. (ROADMAP §8.5)
 *
 * UXP DOM 의 `document.saveAs.*` 를 쓴다. batchPlay 를 쓰지 않는다. (ARCHITECTURE §13)
 * 이 API 는 경로 문자열이 아니라 storage API 로 얻은 File entry 를 받으므로,
 * 승인된 폴더 안에서만 파일을 만들 수 있다는 성질이 그대로 유지된다.
 *
 * `filename` 은 서버가 확장자까지 맞춰서 보낸다. 플러그인은 그대로 쓴다.
 * 플러그인은 contracts 를 **타입으로만** 참조하므로 공용 함수를 호출할 수 없다 —
 * 값으로 import 하면 컴파일 결과에 `require("@photoshop-mcp/...")` 가 남고
 * UXP 샌드박스에는 node_modules 가 없어 **플러그인 전체가 로드에 실패한다.**
 * (CLAUDE.md 의존 방향 규칙 6, ARCHITECTURE §11)
 */

/** 승인된 폴더에 새 파일을 만든다. 같은 이름이 있으면 실패한다. */
async function createTarget(
  folder: Folder,
  filename: string,
): Promise<{ file: unknown; path: string }> {
  if (await entryExists(folder, filename)) {
    throw new DispatchError(
      "FILE_ALREADY_EXISTS",
      `같은 이름의 파일이 이미 있습니다: ${filename}. 덮어쓰지 않습니다.`,
      { recoverable: true, details: { filename } },
    );
  }

  try {
    const file = await folder.createFile(filename, { overwrite: false });
    return { file, path: file.nativePath };
  } catch (error) {
    throw new DispatchError("FILE_WRITE_FAILED", `파일을 만들 수 없습니다: ${filename}`, {
      details: { filename, cause: describe(error) },
    });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `DOCUMENT_SAVE_AS` — 레이어를 유지해서 저장한다. */
export async function documentSaveAs(params: {
  filename: string;
  format?: "psd" | "psb";
}): Promise<SaveResult> {
  const format = params.format ?? "psd";
  const filename = params.filename;

  return runModal("Save as", async () => {
    const document = requireActiveDocument();
    const folder = await requireWorkspace();
    const { file, path } = await createTarget(folder, filename);

    try {
      // asCopy 를 주지 않는다. save_as 는 문서를 새 파일에 붙인다 —
      // 그래야 이후의 document.save 가 원본이 아니라 이 파일을 덮어쓴다.
      if (format === "psb") {
        await document.saveAs.psb(file, { maximizeCompatibility: true });
      } else {
        await document.saveAs.psd(file, { maximizeCompatibility: true });
      }
    } catch (error) {
      throw new DispatchError("FILE_WRITE_FAILED", `저장에 실패했습니다: ${filename}`, {
        details: { filename, format, cause: describe(error) },
      });
    }

    return { path, filename, format };
  });
}

/** `DOCUMENT_EXPORT` — 합쳐서 내보낸다. 열려 있는 문서는 바뀌지 않는다. */
export async function documentExport(params: {
  filename: string;
  format?: "png" | "jpg" | "tiff";
  quality?: number;
  bitDepth?: 8 | 16;
}): Promise<SaveResult> {
  const format = params.format ?? "png";
  const filename = params.filename;

  // TIFF 는 DOM 에 API 가 없어 경로가 완전히 다르다. 복제본을 만들어 처리한다.
  if (format === "tiff") {
    const folder = await requireWorkspace();
    const { file, path } = await createTarget(folder, filename);
    return exportTiff(file, path, {
      filename,
      ...(params.bitDepth === undefined ? {} : { bitDepth: params.bitDepth }),
    });
  }

  return runModal("Export", async () => {
    const document = requireActiveDocument();
    const folder = await requireWorkspace();
    const { file, path } = await createTarget(folder, filename);

    try {
      // asCopy: true — 열려 있는 문서의 경로와 제목이 바뀌지 않는다.
      if (format === "jpg") {
        await document.saveAs.jpg(file, { quality: params.quality ?? 10 }, true);
      } else {
        await document.saveAs.png(file, {}, true);
      }
    } catch (error) {
      throw new DispatchError("FILE_WRITE_FAILED", `내보내기에 실패했습니다: ${filename}`, {
        details: { filename, format, cause: describe(error) },
      });
    }

    return { path, filename, format };
  });
}

/**
 * `DOCUMENT_SAVE` — 원본을 덮어쓴다. destructive.
 *
 * 작업 폴더 승인과 무관하다. 문서가 이미 가진 경로에만 쓰며, 그 경로는 사용자가
 * 문서를 열거나 저장할 때 이미 승인한 것이다.
 */
export async function documentSave(): Promise<SaveResult> {
  return runModal("Save", async () => {
    const document = requireActiveDocument();
    const path = documentPath(document);
    if (path === null) {
      throw new DispatchError(
        "DOCUMENT_NOT_SAVED",
        "한 번도 저장한 적 없는 문서입니다. save_as 를 사용하세요.",
        { recoverable: true, details: { name: document.name } },
      );
    }

    try {
      await document.save();
    } catch (error) {
      throw new DispatchError("FILE_WRITE_FAILED", `저장에 실패했습니다: ${document.name}`, {
        details: { path, cause: describe(error) },
      });
    }

    return { path, filename: document.name, format: extensionOf(path) };
  });
}

/** 문서 경로. 한 번도 저장하지 않았으면 `null`. 접근 자체가 실패할 수 있다. */
function documentPath(document: PhotoshopDocument): string | null {
  try {
    const path = document.path;
    return path === undefined || path.length === 0 ? null : path;
  } catch {
    return null;
  }
}

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/u).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "unknown" : name.slice(dot + 1).toLowerCase();
}
