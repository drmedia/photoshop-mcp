/**
 * 서버에 자동으로 접속할지. (ROADMAP §100)
 *
 * **기본은 꺼짐이다.** 플러그인은 로드되어 있는 동안 서버를 계속 찾는다(최대 30초에 한 번 포트 범위를 훑는다).
 * Photoshop 을 평소처럼 쓸 때는 그것이 필요 없고, 두 가지 원치 않는 일이 있다.
 *
 * - 8765–8774 를 다른 프로그램의 WebSocket 서버가 쓰고 있으면 그쪽에 `hello` 를 보낸다.
 * - 클라이언트가 서버를 띄우면 알아서 붙어서, 그 순간부터 허용된 Tool 로 열린 문서를 건드릴 수 있다.
 *
 * 켜 두면 서버가 언제 켜지든 붙는다. 끄면 접속을 시도하지 않는다.
 *
 * 저장은 `localStorage` 에 하고, 없거나 읽을 수 없으면 **꺼짐**으로 본다 — 기본이 꺼짐이므로 저장소를 못
 * 읽는 환경에서도 같은 쪽으로 물러난다. `preferred-url.ts` 와 같은 방어다.
 */

const KEY = "photoshop-mcp.autoConnect";

/** 저장된 문자열 → 켜짐 여부. **`"1"` 만 켜짐**이다 — 모르는 값은 꺼짐으로 읽는다. */
export function parseAutoConnect(stored: string | null | undefined): boolean {
  return stored === "1";
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readAutoConnect(): boolean {
  try {
    return parseAutoConnect(storage()?.getItem(KEY));
  } catch {
    return false;
  }
}

export function writeAutoConnect(enabled: boolean): void {
  try {
    storage()?.setItem(KEY, enabled ? "1" : "0");
  } catch {
    // 저장하지 못해도 이번 실행에서는 바뀐다. 다음 실행에서 기본(꺼짐)으로 돌아갈 뿐이다.
  }
}
