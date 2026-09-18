import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";

/**
 * 변경 뒤 결과 레이어를 고른다.
 *
 * ## 왜 필요한가
 *
 * Photoshop 은 편집 도중 **레이어 객체를 통째로 갈아치우는 경우가 있다.** 배경
 * 레이어에 불투명도를 주면 일반 레이어로 승격되고 id 가 바뀐다. 배경은 반투명할 수
 * 없으므로 Photoshop 으로서는 올바른 동작이다.
 *
 * 문제는 그다음이다. 변경은 이미 일어났는데 원래 참조로 결과를 읽으려 하면
 * `The 레이어 with an id of 1 does not exist.` 가 던져지고, 그 예외가
 * `COMMAND_FAILED` 로 올라간다. **호출자는 아무 일도 없었다고 믿는데 문서는 바뀌어
 * 있다.** 가장 나쁜 실패 형태다 — 안 했다고 말하고 뭔가를 한다.
 *
 * 실기에서 LLM 으로 테스트하다 잡았다.
 *
 * ```text
 * layer.list                        id=1 "배경" op=100
 * layer.set_opacity {opacity:80}    ❌ COMMAND_FAILED
 * layer.list                        id=2 "레이어 0" op=80   ← 적용되어 있다
 * ```
 *
 * ## 어떻게 고르는가
 *
 * 변경 전 id 집합을 들고 있다가, 변경 뒤 목록에서 **없던 id** 를 찾는다. 하나뿐이면
 * 그것이 교체된 레이어다. 새 id 가 없으면 평범한 변경이므로 원래 id 로 찾는다.
 *
 * 위치나 활성 레이어로 추정하지 않는다. 승격된 레이어가 반드시 활성이라는 보장이
 * 없고, 위치는 같은 편집에서 바뀔 수 있다. "이번 변경으로 생긴 id" 가 가장 직접적인
 * 근거다.
 *
 * @param beforeIds 변경 전 문서의 모든 레이어 id
 * @param after 변경 후 평탄화한 레이어 목록
 * @param originalId 변경 대상의 원래 id. 읽을 수 없었으면 `null`
 */
export function resolveMutatedLayer(
  beforeIds: readonly number[],
  after: readonly LayerInfo[],
  originalId: number | null,
): LayerInfo | null {
  if (originalId !== null) {
    const unchanged = after.find((entry) => entry.id === originalId);
    if (unchanged !== undefined) {
      return unchanged;
    }
  }

  // 원래 id 가 사라졌다 = Photoshop 이 갈아치웠다. 이번에 생긴 id 를 찾는다.
  const before = new Set(beforeIds);
  const appeared = after.filter((entry) => !before.has(entry.id));
  if (appeared.length === 1) {
    return appeared[0] as LayerInfo;
  }

  // 판단할 근거가 없다. 추측해서 엉뚱한 레이어를 돌려주느니 모른다고 한다.
  return null;
}

/**
 * 요청한 불투명도가 실제로 들어갔는지.
 *
 * ## 왜 확인하는가
 *
 * 배경 레이어는 조건에 따라 대입을 **조용히 무시한다** — 예외도 없고 값도 그대로다.
 * 실기에서 레이어가 둘 이상인 문서의 배경에 60 을 넣었더니 100 그대로였다.
 * 그런데도 성공으로 보고하면 호출자는 60 이 되었다고 믿는다. 반환값에 100 이 담겨
 * 있어도 성공/실패 신호를 먼저 읽는다.
 *
 * ## 왜 정확히 비교하지 않는가
 *
 * Photoshop 은 불투명도를 **0–255 로 저장한다.** 50 을 넣으면 50.196… 이 돌아오고,
 * `toLayerInfo` 가 0–100 정수로 반올림한다. 요청값은 정수가 아닐 수 있으므로
 * (`z.number().min(0).max(100)`) 정확히 비교하면 오탐이 난다 — 60.5 를 요청하면
 * 실제 60 이 돌아와 "적용 안 됨" 으로 잘못 판정한다.
 *
 * 한 단계가 100/255 ≈ 0.39 이고 양쪽 반올림 오차가 각각 0.5 를 넘지 않으므로
 * **1 까지는 같은 값으로 본다.** 무시된 경우는 차이가 훨씬 크다.
 */
export function opacityApplied(requested: number, actual: number): boolean {
  return Math.abs(actual - requested) <= 1;
}
