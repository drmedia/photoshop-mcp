/**
 * 복제로 생긴 문서를 고른다.
 *
 * ## 왜 필요한가
 *
 * **`Document.duplicate()` 가 돌려준 객체의 `id` 가 `undefined` 일 때가 있다.**
 * 그 객체에 대고 무엇을 하면 Photoshop 이 이렇게 던진다.
 *
 * ```text
 * The 문서 with an id of undefined does not exist.
 * ```
 *
 * 실기에서 잡았다 — 보정 레이어가 쌓인 16비트 문서를 TIFF 로 내보내려다
 * `document.export` 가 `COMMAND_FAILED` 로 끝났다. PNG 는 복제를 하지 않아
 * 멀쩡했고, 그래서 **TIFF 경로만** 실패했다. 그 비대칭이 단서였다.
 *
 * 이 프로젝트가 레이어에서 이미 겪은 것과 같은 실패다
 * ([[resolveMutatedLayer]] 참조) — **Photoshop 이 돌려준 객체를 믿지 않는다.**
 * 한 층 위, 문서에서 다시 나왔을 뿐이다.
 *
 * ## 어떻게 고르는가
 *
 * 돌려받은 id 가 쓸 만하면 그것을 쓴다. 아니면 **복제 전후 목록의 차이**를 본다 —
 * `duplicate()` 는 문서를 정확히 하나 만들므로 새로 생긴 id 가 하나면 그것이다.
 *
 * `app.activeDocument` 로 추정하지 않는다. 복제본이 반드시 활성이 된다는 보장이
 * 없고, 틀리면 **사용자의 원본을 평탄화하고 심도를 바꾼다.** 되돌릴 수 없는 쪽으로
 * 틀리는 추정은 하지 않는다.
 *
 * @param beforeIds 복제 **전** 열려 있던 문서 id
 * @param returnedId `duplicate()` 가 돌려준 객체의 `id`. 무엇이든 올 수 있다
 * @param afterIds 복제 **후** 열려 있는 문서 id
 * @returns 복제본의 id. 근거가 없으면 `null`
 */
export function resolveDuplicatedDocumentId(
  beforeIds: readonly number[],
  returnedId: unknown,
  afterIds: readonly number[],
): number | null {
  if (typeof returnedId === "number" && Number.isInteger(returnedId)) {
    // 돌려받은 id 라도 실제로 열려 있는지는 확인한다.
    if (afterIds.includes(returnedId)) {
      return returnedId;
    }
  }

  const before = new Set(beforeIds);
  const appeared = afterIds.filter((id) => !before.has(id));
  if (appeared.length === 1) {
    return appeared[0] as number;
  }

  // 하나로 좁혀지지 않았다. 추측해서 엉뚱한 문서를 평탄화하느니 모른다고 한다.
  return null;
}
