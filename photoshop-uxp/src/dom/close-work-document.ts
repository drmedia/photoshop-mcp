import { constants } from "photoshop";

/**
 * 복제본을 **저장하지 않고** 닫는다.
 *
 * ## `?? "no"` 로 짐작하지 않는다
 *
 * `document.close` 는 `SaveOptions.DONOTSAVECHANGES` 를 얻지 못하면 **부르지
 * 않고 실패한다** — 인자 없는 `close()` 는 저장 여부를 묻는 창을 띄우고
 * 플러그인이 멈추기 때문이다. 내보내기 쪽 두 곳은 같은 자리에서 `?? "no"` 로
 * 짐작하고 있었다. **`try/catch` 는 도움이 안 된다 — 대화상자는 던지지 않고
 * 멈춘다.** (ROADMAP §30)
 *
 * 상수가 없으면 닫지 않고 **남겨 둔 채로 알린다.** 내보내기 결과는 이미
 * 유효하므로 실패로 만들지 않는다. 사용자가 직접 닫으면 된다.
 *
 * @returns 닫혔으면 `null`, 닫지 못했으면 그 이유
 */
export async function closeWorkDocument(work: {
  close: (options?: unknown) => Promise<unknown>;
}): Promise<string | null> {
  const doNotSave = constants.SaveOptions?.DONOTSAVECHANGES;
  if (doNotSave === undefined) {
    return (
      "이 Photoshop 에서 SaveOptions.DONOTSAVECHANGES 를 찾을 수 없어 임시 복제본을 " +
      "닫지 않았습니다. 인자 없이 닫으면 저장 여부를 묻는 창이 떠 플러그인이 멈춥니다 — " +
      "이름 없는 문서가 열려 있으면 저장하지 말고 닫으십시오."
    );
  }
  try {
    await work.close(doNotSave);
    return null;
  } catch (error) {
    return `임시 복제본을 닫지 못했습니다: ${String(
      (error as { message?: unknown })?.message ?? error,
    )}`;
  }
}
