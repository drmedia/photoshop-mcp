/**
 * 액션 허용 목록. (ROADMAP §17.36)
 *
 * ## 왜 파일이 아니라 여기인가
 *
 * 처음에는 서버가 읽는 `actions.json` 으로 만들었다(§17.35). **한 커밋 만에
 * 틀린 것이 드러났다** — 이 기기에만 액션이 91개인데 쓰고 싶은 것마다 세트
 * 이름과 액션 이름을 손으로 적게 했다. 오타는 조용히 안 걸리고, 사용자가
 * 액션 이름을 바꾸면 설정이 소리 없이 깨진다.
 *
 * 그리고 **플러그인은 서버의 작업 디렉터리에 파일을 쓸 수 없다** — UXP
 * 샌드박스는 승인된 폴더와 플러그인 데이터 폴더만 허용한다. 파일로 가면
 * 경로 문제가 하나 더 생긴다.
 *
 * 액션은 Photoshop 안에 있고 **고를 수 있는 것은 사용자뿐이다.** 작업 폴더
 * 승인(§8.5)이 패널 버튼에서만 되는 것과 같은 자리다 — 선택은 패널에서 하고
 * 플러그인이 보관하며 서버는 Bridge 로 물어본다.
 *
 * ## 평탄한 목록으로 둔다
 *
 * "세트 전체 허용" 으로 저장하지 않는다. 그러면 사용자가 나중에 그 세트에
 * 액션을 추가했을 때 **고른 적 없는 것이 조용히 열린다.** 모달의 세트
 * 체크박스는 화면에서만 전체를 토글하고, 저장되는 것은 고른 액션 목록이다.
 */

export interface AllowedAction {
  set: string;
  action: string;
}

const KEY = "photoshop-mcp:actions";

/**
 * `localStorage` 가 없는 UXP 환경이 있다. 없으면 메모리로 물러난다 —
 * 그 경우 Photoshop 재시작 후 다시 골라야 하지만 이번 세션에서는 동작한다.
 * (`workspace.ts` 와 같은 규칙)
 */
let memory: AllowedAction[] = [];

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 모양이 맞는 것만 남긴다. 깨진 항목 하나가 전체를 버리게 하지 않는다. */
function sanitize(value: unknown): AllowedAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: AllowedAction[] = [];
  for (const entry of value) {
    const set = (entry as { set?: unknown })?.set;
    const action = (entry as { action?: unknown })?.action;
    if (typeof set === "string" && typeof action === "string" && set !== "" && action !== "") {
      out.push({ set, action });
    }
  }
  return out;
}

export function readAllowed(): AllowedAction[] {
  const storage = store();
  if (storage === null) {
    return memory;
  }
  try {
    const raw = storage.getItem(KEY);
    return raw === null ? [] : sanitize(JSON.parse(raw) as unknown);
  } catch {
    // 깨진 값이면 빈 목록이다. 아무것도 못 부르는 편이 엉뚱한 것을 부르는 것보다 낫다.
    return [];
  }
}

export function writeAllowed(entries: AllowedAction[]): void {
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

/** 서버가 Bridge 로 묻는 조회. */
export async function actionAllowlist(): Promise<{
  actions: AllowedAction[];
  total: number;
  /** `localStorage` 에 남았는지. `false` 면 Photoshop 재시작 때 사라진다. */
  persisted: boolean;
}> {
  const actions = readAllowed();
  return { actions, total: actions.length, persisted: store() !== null };
}

/** 허용된 것인지. 세트와 액션 **둘 다** 맞아야 한다 — 이름이 유일하지 않다(§17.34). */
export function isAllowed(set: string, action: string): boolean {
  return readAllowed().some((entry) => entry.set === set && entry.action === action);
}
