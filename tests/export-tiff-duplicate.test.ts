import { resolveDuplicatedDocumentId } from "../photoshop-uxp/src/dom/duplicated-document.js";
import { describe, expect, it } from "vitest";

/**
 * TIFF 내보내기가 복제본을 고르는 규칙.
 *
 * 실기에서 `document.export { format: "tiff" }` 가
 * `The 문서 with an id of undefined does not exist.` 로 실패했다.
 * `duplicate()` 가 `id` 없는 객체를 돌려준 것이 원인이다.
 *
 * **틀리면 사용자의 원본을 평탄화하고 심도를 바꾼다.** 되돌릴 수 없으므로
 * 근거가 없으면 고르지 않는 것이 규칙이다.
 */

describe("복제본 고르기", () => {
  it("돌려받은 id 가 열려 있으면 그것을 쓴다", () => {
    expect(resolveDuplicatedDocumentId([232], 233, [232, 233])).toBe(233);
  });

  it("**`undefined` 면 목록 차이로 찾는다** — 실기에서 난 경우다", () => {
    expect(resolveDuplicatedDocumentId([232], undefined, [232, 233])).toBe(233);
  });

  it("돌려받은 id 가 목록에 없으면 목록 차이로 찾는다", () => {
    // 낡은 id 를 그대로 믿으면 없는 문서에 대고 평탄화하게 된다.
    expect(resolveDuplicatedDocumentId([232], 999, [232, 233])).toBe(233);
  });

  it("정수가 아닌 id 는 쓰지 않는다", () => {
    for (const bad of [null, "233", 233.5, Number.NaN, {}]) {
      expect(resolveDuplicatedDocumentId([232], bad, [232, 233])).toBe(233);
    }
  });

  it("**새 문서가 없으면 `null` 이다** — 원본을 고르지 않는다", () => {
    expect(resolveDuplicatedDocumentId([232], undefined, [232])).toBeNull();
  });

  it("**새 문서가 둘이면 `null` 이다** — 추측하지 않는다", () => {
    /* 복제 도중 사용자가 다른 문서를 열면 이렇게 된다. 하나를 골라
     * 평탄화하느니 실패하는 쪽이 낫다. */
    expect(resolveDuplicatedDocumentId([232], undefined, [232, 233, 234])).toBeNull();
  });

  it("원본이 여럿이어도 새로 생긴 것만 고른다", () => {
    expect(resolveDuplicatedDocumentId([10, 20, 30], undefined, [10, 20, 30, 40])).toBe(40);
  });
});
