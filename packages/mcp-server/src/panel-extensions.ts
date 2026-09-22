/**
 * 패널 등록 목록과 실제 적재 상태를 맞춘다. (ROADMAP §18.3)
 *
 * ## 왜 필요한가
 *
 * 처음에는 **추가만** 있었다. `connected` 마다 목록을 다시 묻되 이미 적재한
 * 것은 건너뛰기만 했다 — 재적재하면 namespace 충돌로 거부되기 때문이다.
 *
 * 그래서 **패널에서 제거해도 돌고 있는 서버에는 그대로 남았다.** 실기에서
 * `starnet` 을 빼고 Bridge 를 다시 붙였는데 `starnet.remove_stars` 가 계속
 * 보였다. ROADMAP 에는 "패널 제거 → Tool 도 함께 사라진다 — 짝이 맞는다" 고
 * 적혀 있었으니, 문서와 동작이 어긋나 있었다.
 *
 * ## 왜 따로 떼어 두는가
 *
 * 이 판단은 Bridge 연결 · 파일 시스템 · 로거가 없어도 시험할 수 있다.
 * `start.ts` 안에 두면 실기에서만 확인되고, 그러면 **제거 경로는 사용자가
 * 패널에서 버튼을 누를 때 처음 실행된다.**
 */

/**
 * 경로를 비교 가능한 형태로 만든다.
 *
 * 끝의 구분자만 떼어낸다. `...\starnet` 과 `...\starnet\` 이 다른 것으로
 * 읽히면 **매 연결마다 해제하고 다시 적재하는 왕복**이 생긴다 — Tool 목록이
 * 깜빡이고 그 사이 호출은 실패한다.
 *
 * 대소문자는 건드리지 않는다. Windows 만 대소문자를 구분하지 않고, 여기서
 * 그것을 가정하면 다른 곳에서 틀린다.
 */
export function normalizeExtensionPath(path: string): string {
  const trimmed = path.trim();
  return trimmed.length > 1 ? trimmed.replace(/[\\/]+$/u, "") : trimmed;
}

export interface PanelExtensionPlan {
  /** 새로 적재할 디렉터리. */
  load: string[];
  /** 해제할 것. 패널 목록에서 빠진 것들이다. */
  unload: { path: string; namespace: string }[];
}

/**
 * 무엇을 적재하고 무엇을 해제할지 정한다.
 *
 * @param registered 패널이 보고한 디렉터리 목록
 * @param loaded 이 서버가 패널을 통해 적재한 것. `경로 → namespace`
 */
export function planPanelExtensionSync(
  registered: readonly string[],
  loaded: ReadonlyMap<string, string>,
): PanelExtensionPlan {
  const wanted = new Set(registered.map(normalizeExtensionPath));

  const load = [...wanted].filter((path) => !loaded.has(path));

  /* **패널을 거쳐 적재한 것만 해제 대상이다.** `PHOTOSHOP_MCP_EXTENSIONS` 로
   * 자동 적재된 것은 패널 목록에 없는 것이 당연하다 — 그것까지 해제하면
   * 설정으로 켠 Extension 이 Photoshop 이 붙는 순간 사라진다. */
  const unload = [...loaded.entries()]
    .filter(([path]) => !wanted.has(path))
    .map(([path, namespace]) => ({ path, namespace }));

  return { load, unload };
}
