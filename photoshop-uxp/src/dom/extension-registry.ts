import { fileSystem } from "./workspace.js";
import { DispatchError } from "../dispatcher/dispatcher.js";

/**
 * 등록된 Extension. (ROADMAP §18.3)
 *
 * ## 왜 패널이 보관하는가
 *
 * **기본은 "아무 패널도 안 깔려 있다" 다.** 저장소에 Extension 을 넣어 두면
 * 그것을 안 쓰는 사람에게도 Tool 목록에 보이고, 무엇이 이 서버의 능력인지
 * 흐려진다.
 *
 * 그래서 사용자가 설치한 것만 붙인다. 문제는 **서버가 그 위치를 알 수 없다**는
 * 것이다 — 서버의 cwd 는 MCP 클라이언트가 정하고 우리가 통제할 수 없다.
 * 플러그인이 알려 주면 그 문제가 사라진다.
 *
 * 작업 폴더 승인(§8.5) · 액션 허용 목록(§17.36) 과 같은 자리다.
 *
 * ## 안전장치
 *
 * `getFolder()` 가 **사용자 제스처를 요구한다.** 서버가 대신 부를 수 없으므로
 * **LLM 이 임의 폴더의 코드를 적재시킬 수 없다.** 사람이 고른 폴더만 돈다.
 * 이것이 §23 의 "임의 JavaScript 실행 금지" 를 Extension 까지 넓히는 지점이다.
 *
 * ## 경로를 함께 보관한다
 *
 * 토큰만으로는 서버가 쓸 수 없다 — 서버는 UXP 토큰을 모르고 파일 시스템
 * 경로가 필요하다. `folder.nativePath` 를 함께 저장한다. 토큰은 폴더가
 * 아직 살아 있는지 확인하는 데 쓴다.
 */

const KEY = "photoshop-mcp:extensions";

export interface RegisteredExtension {
  /** 서버가 적재할 디렉터리. `extension.json` 이 이 안에 있어야 한다. */
  path: string;
  /** 사용자가 고른 시점. 목록을 보여줄 때 쓴다. */
  addedAt: number;
}

/**
 * `localStorage` 가 없는 UXP 환경이 있다. 없으면 메모리로 물러난다 —
 * 그 경우 Photoshop 재시작 후 다시 등록해야 하지만 이번 세션에서는 동작한다.
 * (`workspace.ts` · `action-allowlist.ts` 와 같은 규칙)
 */
let memory: RegisteredExtension[] = [];

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 모양이 맞는 것만 남긴다. 깨진 항목 하나가 전체를 버리게 하지 않는다. */
function sanitize(value: unknown): RegisteredExtension[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: RegisteredExtension[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const path = (entry as { path?: unknown })?.path;
    if (typeof path !== "string" || path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const addedAt = (entry as { addedAt?: unknown })?.addedAt;
    out.push({ path, addedAt: typeof addedAt === "number" ? addedAt : 0 });
  }
  return out;
}

export function readRegistered(): RegisteredExtension[] {
  const storage = store();
  if (storage === null) {
    return memory;
  }
  try {
    const raw = storage.getItem(KEY);
    return raw === null ? [] : sanitize(JSON.parse(raw) as unknown);
  } catch {
    // 깨진 값이면 빈 목록이다. 아무것도 안 붙는 편이 엉뚱한 것을 붙이는 것보다 낫다.
    return [];
  }
}

export function writeRegistered(entries: RegisteredExtension[]): void {
  const clean = sanitize(entries);
  memory = clean;
  const storage = store();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // 저장 실패는 메모리로만 남는다. 이번 세션에서는 동작한다.
  }
}

/**
 * 폴더를 고르게 하고 목록에 더한다. **패널 버튼에서만 부를 수 있다.**
 *
 * 이미 있는 경로면 더하지 않고 그대로 돌려준다 — 두 번 등록하면 namespace
 * 충돌로 두 번째가 거부되고, 그 이유가 사용자에게 보이지 않는다.
 */
export async function addRegisteredFolder(): Promise<{
  added: RegisteredExtension | null;
  duplicate: boolean;
  entries: RegisteredExtension[];
}> {
  const folder = await fileSystem().getFolder();
  if (folder === null || folder === undefined) {
    // 사용자가 취소했다. 오류가 아니다.
    return { added: null, duplicate: false, entries: readRegistered() };
  }

  const path = folder.nativePath;
  const registered = readRegistered();
  if (registered.some((entry) => entry.path === path)) {
    return { added: null, duplicate: true, entries: registered };
  }

  /* **`extension.json` 이 있는지 여기서 본다.**
   *
   * 없는 폴더를 등록해 두면 서버가 적재하려다 조용히 건너뛴다(`discover` 가
   * manifest 없는 디렉터리를 무시한다). 사용자는 등록했는데 Tool 이 안 붙는
   * 이유를 알 수 없다. 고르는 자리에서 막는 것이 맞다. */
  const entries = await folder.getEntries();
  if (!entries.some((entry) => entry.name === "extension.json")) {
    throw new DispatchError(
      "INVALID_PARAMETER",
      `There is no extension.json in this folder: ${path}`,
      {
        recoverable: true,
        details: { path },
      },
    );
  }

  const added: RegisteredExtension = { path, addedAt: Date.now() };
  const next = [...registered, added];
  writeRegistered(next);
  return { added, duplicate: false, entries: next };
}

/** 서버가 Bridge 로 묻는 조회. */
export async function extensionRegistry(): Promise<{
  extensions: RegisteredExtension[];
  total: number;
  /** `localStorage` 에 남았는지. `false` 면 Photoshop 재시작 때 사라진다. */
  persisted: boolean;
}> {
  const extensions = readRegistered();
  return { extensions, total: extensions.length, persisted: store() !== null };
}
