import type { Entry } from "uxp";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireWorkspace } from "./workspace.js";

/**
 * 작업 폴더의 파일 관리. (ROADMAP §17 Temporary file cleanup)
 *
 * 외부 처리기를 한 번 돌릴 때마다 16비트 TIFF 가 여러 개 생긴다. 4032×6048 이면
 * 파일 하나가 140MB 다. 실기 검증만으로 1GB 가 넘게 쌓였는데 알 방법이 없었다.
 *
 * ## 자동으로 지우지 않는다
 *
 * 승인된 폴더는 **사용자의 폴더**다. 우리가 만든 파일만 있다는 보장이 없고,
 * 결과물을 다른 도구에 넘기려고 남겨둔 것일 수도 있다.
 *
 * 그래서 **알려주기만 한다.** 지우는 것은 파일 이름을 명시적으로 받았을 때만 한다.
 * 패턴이나 와일드카드를 받지 않는다 — `*.tif` 한 줄이 사용자의 원본을 지울 수 있다.
 */

export interface FileInfo {
  name: string;
  /** 바이트. 알 수 없으면 `null`. */
  size: number | null;
  /** 마지막 수정 시각 (epoch ms). 알 수 없으면 `null`. */
  modifiedAt: number | null;
}

export interface WorkspaceUsage {
  path: string;
  fileCount: number;
  /** 크기를 알아낸 파일들의 합계. */
  totalBytes: number;
  /** 큰 것부터. */
  files: FileInfo[];
}

/** 메타데이터 조회는 실패할 수 있다. 실패해도 목록 전체를 버리지 않는다. */
async function describe(entry: Entry): Promise<FileInfo> {
  try {
    const metadata = await entry.getMetadata();
    const modified = metadata.dateModified;
    return {
      name: entry.name,
      size: typeof metadata.size === "number" ? metadata.size : null,
      modifiedAt: modified instanceof Date ? modified.getTime() : null,
    };
  } catch {
    return { name: entry.name, size: null, modifiedAt: null };
  }
}

/** `WORKSPACE_USAGE` — 작업 폴더에 무엇이 얼마나 쌓였는지. */
export async function workspaceUsage(params: { limit?: number }): Promise<WorkspaceUsage> {
  const folder = await requireWorkspace();
  const entries = await folder.getEntries();
  const files = await Promise.all(entries.filter((entry) => entry.isFile).map(describe));

  files.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);

  return {
    path: folder.nativePath,
    fileCount: files.length,
    totalBytes,
    files: files.slice(0, params.limit ?? 20),
  };
}

export interface DeleteResult {
  deleted: string[];
  /** 지우지 못한 것과 이유. */
  failed: { name: string; reason: string }[];
}

/**
 * `WORKSPACE_DELETE` — 이름을 명시한 파일만 지운다.
 *
 * 패턴을 받지 않는 이유는 위에 적었다. 없는 파일은 조용히 넘기지 않고 이유를
 * 돌려준다 — 이름을 잘못 적었는지 이미 지워졌는지 알아야 한다.
 */
export async function workspaceDelete(params: { filenames: string[] }): Promise<DeleteResult> {
  const folder = await requireWorkspace();
  const entries = await folder.getEntries();
  const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));

  const deleted: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const filename of params.filenames) {
    const entry = byName.get(filename.toLowerCase());
    if (entry === undefined) {
      failed.push({ name: filename, reason: "파일이 없습니다." });
      continue;
    }
    if (!entry.isFile) {
      // 폴더를 지우면 안에 무엇이 있는지 모른 채 통째로 날린다.
      failed.push({ name: filename, reason: "파일이 아니라 폴더입니다." });
      continue;
    }
    try {
      await entry.delete();
      deleted.push(entry.name);
    } catch (error) {
      failed.push({
        name: filename,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (deleted.length === 0 && failed.length > 0) {
    throw new DispatchError("FILE_NOT_FOUND", "지운 파일이 없습니다.", {
      recoverable: true,
      details: { failed },
    });
  }

  return { deleted, failed };
}
