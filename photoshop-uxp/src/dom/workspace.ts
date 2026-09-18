import * as uxp from "uxp";
import type { Folder, LocalFileSystem } from "uxp";
import type { WorkspaceStatus } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";

/**
 * 승인된 작업 폴더. (ROADMAP §8.5)
 *
 * UXP 샌드박스는 임의 경로 쓰기를 막는다. 저장하려면 사용자가 고른 폴더의
 * persistent token 이 필요하다.
 *
 * `getFolder()` 는 **사용자 제스처를 요구한다.** 서버가 소켓으로 띄울 수 없고,
 * 패널의 버튼에서만 호출할 수 있다. 이것은 제약이자 안전장치다 — LLM 은 저장
 * 폴더를 고를 수 없고, 사람이 고른 폴더 안에서만 쓸 수 있다.
 */

const TOKEN_KEY = "photoshop-mcp.workspace-token";

/**
 * storage API 를 지연 조회한다.
 *
 * 모듈 최상위에서 `storage.localFileSystem` 을 잡으면, 그것이 없는 UXP 환경에서
 * **플러그인 전체가 로드에 실패한다.** Bridge 연결까지 같이 죽는다.
 * 저장은 부가 기능이고 Bridge 는 본체다. 부가 기능의 문제가 본체를 막으면 안 된다.
 */
export function fileSystem(): LocalFileSystem {
  const api = (uxp as { storage?: { localFileSystem?: LocalFileSystem } }).storage?.localFileSystem;
  if (api === undefined) {
    throw new DispatchError(
      "WORKSPACE_NOT_APPROVED",
      "이 Photoshop 의 UXP 에서 파일 시스템 API 를 쓸 수 없습니다.",
      { recoverable: false },
    );
  }
  return api;
}

/**
 * 토큰 보관소.
 *
 * `localStorage` 는 플러그인마다 격리되어 있고 Photoshop 재시작 후에도 남는다.
 *
 * `localStorage` 가 없는 UXP 환경이 있다. 없으면 메모리로 물러난다 —
 * 그 경우 Photoshop 재시작 후 다시 승인해야 하지만, 이번 세션에서는 저장이 동작한다.
 */
let memoryToken: string | null = null;

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readToken(): string | null {
  const storage = store();
  if (storage === null) {
    return memoryToken;
  }
  try {
    const value = storage.getItem(TOKEN_KEY);
    return value === null || value.length === 0 ? null : value;
  } catch {
    return memoryToken;
  }
}

function writeToken(token: string | null): void {
  memoryToken = token;
  const storage = store();
  if (storage === null) {
    return;
  }
  try {
    if (token === null) {
      storage.removeItem(TOKEN_KEY);
    } else {
      storage.setItem(TOKEN_KEY, token);
    }
  } catch {
    // 보관에 실패하면 이번 세션에만 유효하다. 저장 자체는 계속 동작한다.
  }
}

/**
 * 승인된 폴더를 되찾는다.
 *
 * 토큰이 없거나 폴더가 사라졌으면 `null`. 사라진 토큰은 지운다 —
 * 남겨두면 승인된 것처럼 보이면서 매번 실패한다.
 */
async function resolveFolder(): Promise<Folder | null> {
  const token = readToken();
  if (token === null) {
    return null;
  }
  try {
    const entry = await fileSystem().getEntryForPersistentToken(token);
    if (!entry.isFolder) {
      writeToken(null);
      return null;
    }
    return entry as Folder;
  } catch {
    writeToken(null);
    return null;
  }
}

/** `WORKSPACE_STATUS` — 승인 여부와 경로. */
export async function workspaceStatus(): Promise<WorkspaceStatus> {
  const folder = await resolveFolder();
  return folder === null
    ? { approved: false, path: null }
    : { approved: true, path: folder.nativePath };
}

/**
 * 폴더 선택 대화상자를 열고 승인한다.
 *
 * **패널 버튼에서만 호출한다.** 사용자 제스처가 필요하다.
 *
 * @returns 사용자가 취소하면 `null`.
 */
export async function approveFolder(): Promise<WorkspaceStatus | null> {
  const folder = await fileSystem().getFolder();
  if (folder === null || folder === undefined) {
    return null;
  }
  const token = await fileSystem().createPersistentToken(folder);
  writeToken(token);
  return { approved: true, path: folder.nativePath };
}

/** 승인을 취소한다. 패널 버튼에서 호출한다. */
export function revokeFolder(): WorkspaceStatus {
  writeToken(null);
  return { approved: false, path: null };
}

/**
 * 승인된 폴더를 돌려준다. 없으면 `WORKSPACE_NOT_APPROVED`.
 *
 * 저장 Command 가 이것을 쓴다.
 */
export async function requireWorkspace(): Promise<Folder> {
  const folder = await resolveFolder();
  if (folder === null) {
    throw new DispatchError(
      "WORKSPACE_NOT_APPROVED",
      "저장할 작업 폴더가 승인되지 않았습니다. " +
        "Photoshop 의 'Photoshop MCP' 패널에서 '폴더 승인' 을 눌러 주세요.",
      { recoverable: true },
    );
  }
  return folder;
}

/**
 * 폴더 안에 같은 이름의 항목이 있는지.
 *
 * `createFile` 은 `overwrite` 없이도 조용히 덮어쓰는 경우가 있어 먼저 확인한다.
 * `save_as` 와 `export` 는 덮어쓰지 않는 것이 계약이다.
 */
export async function entryExists(folder: Folder, name: string): Promise<boolean> {
  const entries = await folder.getEntries();
  const target = name.toLowerCase();
  return entries.some((entry) => entry.name.toLowerCase() === target);
}
