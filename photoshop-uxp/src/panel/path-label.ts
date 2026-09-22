/**
 * 좁은 패널에 넣을 경로 문자열.
 *
 * **앞을 자르고 뒤를 남긴다.** CSS `text-overflow:ellipsis` 는 뒤를 자르는데,
 * 경로에서 구분되는 정보는 끝이다 — `C:\\Users\\drmedia\\Documents\\Adobe\\Photo…`
 * 는 어느 폴더인지 말해주지 않는다.
 *
 * `direction:rtl` 로 뒤집는 수법은 쓸 수 없다. **UXP CSS 지원 목록에
 * `direction` 이 없다.** 그래서 JS 로 자른다.
 *
 * 픽셀 폭을 재지 않고 글자 수로 자른다 — 패널 폭을 알 수 없고, 잘린 뒤에도
 * CSS `ellipsis` 가 남아 더 좁으면 한 번 더 줄여준다.
 */

/** 경로 구분자. Windows 와 POSIX 를 함께 받는다. */
const SEPARATORS = ["\\", "/"];

/**
 * @param max 남길 최대 글자 수. 기본값은 260px 패널에서 11px 글꼴 기준이다.
 */
export function shortenPath(path: string, max = 34): string {
  if (path.length <= max) {
    return path;
  }

  // 자를 자리. 뒤에서 `max - 1` 글자를 남기고 `…` 한 글자를 붙인다.
  const tail = path.slice(path.length - (max - 1));

  /* **구분자에서 끊는다.** 세그먼트 중간에서 자르면 `ents\\Adobe` 처럼
   * 존재하지 않는 폴더 이름으로 읽힌다. 남길 글자 수 안에 구분자가 있으면
   * 거기서 끊고, 없으면 그대로 둔다 — 세그먼트 하나가 그보다 길 수 있다. */
  let cut = -1;
  for (const separator of SEPARATORS) {
    cut = Math.max(cut, tail.indexOf(separator));
  }

  return cut >= 0 ? `…${tail.slice(cut)}` : `…${tail}`;
}
