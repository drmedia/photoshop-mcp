import { core } from "photoshop";

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Photoshop 의 modal 실행 컨텍스트에서 작업을 수행한다. (ARCHITECTURE §13)
 *
 * `core.executeAsModal()` 안에서 던진 오류는 Photoshop 이 다시 감싸기 때문에
 * 원래 객체의 타입과 `code` 를 잃는다. 실기 확인 결과 `DispatchError` 가
 * `"DispatchError: <message>"` 문자열을 가진 일반 오류로 바뀌어,
 * Dispatcher 의 `instanceof` 검사가 실패하고 모든 오류가 `COMMAND_FAILED` 로
 * 뭉개졌다.
 *
 * 그래서 오류를 던지지 않고 **값으로** 돌려받은 뒤 modal 밖에서 다시 던진다.
 * 이렇게 하면 `DispatchError` 의 `code` 와 `recoverable` 이 그대로 보존된다.
 */
export async function runModal<T>(commandName: string, fn: () => T): Promise<T> {
  const outcome = await core.executeAsModal<Outcome<T>>(
    async () => {
      try {
        return { ok: true, value: fn() };
      } catch (error) {
        return { ok: false, error };
      }
    },
    { commandName },
  );

  if (outcome.ok) {
    return outcome.value;
  }
  throw outcome.error;
}
