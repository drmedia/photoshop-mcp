import { app } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { toDocumentInfo } from "./document.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";
import { requireWorkspace } from "./workspace.js";

/**
 * 문서 열기. (ROADMAP §17.26)
 *
 * 승인된 작업 폴더 안의 파일만 연다. 저장과 같은 규칙이다 — 호출자는 폴더를
 * 고를 수 없고 파일 이름만 준다. (ROADMAP §8.5)
 *
 * 형식 제한은 Command 스키마가 건다. 여기서는 **파일을 찾고 여는 일**만 한다.
 */

interface OpenableDocument {
  id: number;
  name: string;
}

export async function documentOpen(params: { filename: string }): Promise<{
  document: DocumentInfo;
  alreadyOpen: boolean;
  openDocuments: number;
}> {
  return runModal("Open document", async () => {
    const folder = await requireWorkspace();

    // **`getEntries` 로 찾는다.** UXP `Folder` 에 이름으로 한 항목을 집는 API 가
    // 있는지 확인하지 못했다. 목록을 훑는 것은 `entryExists` 가 이미 쓰는 길이라
    // 동작이 검증돼 있다.
    //
    // 대소문자를 무시한다 — Windows 파일 시스템이 그렇고, 여기서 엄격하게 굴면
    // 사용자가 보고 적은 이름이 틀렸다고 나온다.
    const target = params.filename.toLowerCase();
    const entry = (await folder.getEntries()).find(
      (candidate) => candidate.name.toLowerCase() === target,
    );
    if (entry === undefined) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `작업 폴더에 '${params.filename}' 이 없습니다. ` +
          "photoshop.workspace.usage 로 폴더 안의 파일을 확인할 수 있습니다.",
        { recoverable: true, details: { filename: params.filename, folder: folder.nativePath } },
      );
    }
    if (entry.isFolder) {
      throw new DispatchError("INVALID_PARAMETER", `'${params.filename}' 은 폴더입니다.`, {
        recoverable: true,
        details: { filename: params.filename },
      });
    }

    // **열기 전에 목록을 떠 둔다.** Photoshop 은 같은 파일을 두 번 열지 않고
    // 기존 창을 활성화한다. 그것을 그냥 성공으로 돌려주면 호출자는 방금
    // 디스크에서 읽었다고 믿는다 — 편집 중이면 디스크의 것과 다르다.
    const before = new Set(toArray<OpenableDocument>(app.documents).map((entry) => entry.id));

    let opened;
    try {
      opened = await app.open(entry);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `'${params.filename}' 을 열지 못했습니다: ` +
          String((error as { message?: unknown })?.message ?? error),
        { recoverable: true, details: { filename: params.filename } },
      );
    }

    if (opened === null || opened === undefined) {
      throw new DispatchError("COMMAND_FAILED", "열기가 문서를 돌려주지 않았습니다.", {
        details: { filename: params.filename },
      });
    }

    const open = toArray<OpenableDocument>(app.documents);
    return {
      document: toDocumentInfo(opened),
      alreadyOpen: before.has(opened.id),
      openDocuments: open.length,
    };
  });
}
