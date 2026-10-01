/**
 * 마지막으로 붙은 서버 주소를 기억한다. (ROADMAP §93)
 *
 * 다음에 Photoshop 을 켜면 이 주소를 맨 앞에 두고 시도한다 — 서버가 8770 에 있었다면 8765 부터 일곱 번
 * 실패하지 않고 바로 붙는다. 없어도 동작한다: `localStorage` 가 없거나 막힌 환경이 있어(다른 저장소도
 * 같은 이유로 방어한다) 읽기·쓰기 모두 실패를 삼키고, 못 읽으면 기본 순서로 훑을 뿐이다.
 */

const KEY = "photoshop-mcp.lastServerUrl";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPreferredUrl(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

export function writePreferredUrl(url: string): void {
  try {
    storage()?.setItem(KEY, url);
  } catch {
    // 저장하지 못해도 다음에 처음부터 훑을 뿐이다.
  }
}
