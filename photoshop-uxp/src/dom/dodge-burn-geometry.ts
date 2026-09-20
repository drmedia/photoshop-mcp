/**
 * 닷징 · 버닝의 순수 계산. (ROADMAP §17.31)
 *
 * **`photoshop` 을 import 하지 않는다.** 떼어 두어야 단위 테스트가 실기 없이
 * 이 규칙을 고정할 수 있다. (`camera-raw-keys.ts` · `active-order.ts` 와 같은 이유)
 */

/**
 * 페더 반지름을 정한다.
 *
 * `hardness` 가 100 이면 0 이 되는데, Photoshop 은 **반지름 0 의 페더를 거절한다.**
 * 그래서 그때는 0 을 돌려주고 호출자가 페더 단계를 건너뛴다.
 */
export function featherFor(radius: number, hardness: number): number {
  const value = radius * (1 - hardness / 100);
  // 0.1 미만은 Photoshop 이 받지 않는다. 경계값에서 조용히 실패하지 않도록 자른다.
  return value < 0.1 ? 0 : value;
}
