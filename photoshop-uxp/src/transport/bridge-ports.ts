/**
 * Plugin 이 서버를 찾는 포트 범위. (ROADMAP §93)
 *
 * 서버는 8765 부터 빈 포트를 찾아 열고, Plugin 은 같은 범위를 훑어 핸드셰이크가 맞는 서버에 붙는다.
 * 사용자가 아무것도 지정하지 않아도 다른 프로그램과 포트가 겹치지 않는다.
 *
 * ## 서버와 같은 값이어야 한다
 *
 * Plugin 은 contracts 를 **타입으로만** 참조한다(CLAUDE.md 의존 방향 6). 값으로 import 하면 UXP
 * 샌드박스에서 플러그인 전체가 로드에 실패하므로 서버의 `DEFAULT_PORT` · `PORT_CANDIDATES` 를 가져올
 * 수 없다. 그래서 같은 값을 여기에 따로 두고 `tests/bridge-port-sync.test.ts` 가 둘을 대조한다.
 *
 * `photoshop` 모듈을 import 하지 않는 순수 모듈이라 Photoshop 없이 시험한다.
 */

export const BRIDGE_HOST = "127.0.0.1";
export const BRIDGE_PORT_START = 8765;
export const BRIDGE_PORT_COUNT = 10;

/** 후보 URL 전체. 앞에서부터 시도한다. */
export function bridgeUrls(): string[] {
  return Array.from(
    { length: BRIDGE_PORT_COUNT },
    (_, index) => `ws://${BRIDGE_HOST}:${String(BRIDGE_PORT_START + index)}`,
  );
}

/**
 * 마지막으로 붙은 URL 을 맨 앞에 둔 후보 목록.
 *
 * **범위 밖이거나 모르는 값은 무시한다.** 저장소에 남은 옛 값이나 손으로 바꾼 값이 임의의 주소로
 * 접속하는 길이 되면 안 된다 — 후보는 언제나 위 범위의 루프백뿐이다.
 */
export function orderedBridgeUrls(preferred: string | null | undefined): string[] {
  const all = bridgeUrls();
  if (preferred === null || preferred === undefined || !all.includes(preferred)) {
    return all;
  }
  return [preferred, ...all.filter((url) => url !== preferred)];
}
