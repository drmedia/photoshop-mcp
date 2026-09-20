import { app } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { runModal } from "./modal.js";
import { isAllowed, readAllowed } from "./action-allowlist.js";

/**
 * 액션 실행. (ROADMAP §17.35)
 *
 * ## DOM 의 `play()` 를 쓴다
 *
 * `app.actionTree` 의 `Action` 객체마다 `play()` 가 있다 — §17.34 에서 확인했다.
 * batchPlay 로 `play` descriptor 를 조립하지 않는다. DOM 이 있으면 DOM 을 쓴다.
 *
 * ## **대화상자를 끈다**
 *
 * 액션은 단계마다 대화상자 토글을 갖는다. 켜진 채로 돌면 **플러그인이 멈추고
 * Bridge 가 15초에 타임아웃한다** — 이 프로젝트에서 네 번 반복된 실패다
 * (§17.11 · §17.25 · §17.26 · §17.17).
 *
 * `app.displayDialogs` 가 있으면 끄고 **반드시 되돌린다.** 없으면 끄지 못하며,
 * 그 사실을 결과에 담는다 — 껐다고 말하고 안 끄는 것이 가장 나쁘다.
 *
 * ## **허용 검사가 여기 있다**
 *
 * 서버의 Tool 이 아니라 플러그인에서 막는다. Extension 은 Tool 을 거치지 않고
 * Command 를 직접 부를 수 있으므로(ARCHITECTURE §3.2), 위쪽에서만 막으면
 * 그 길이 열려 있다. 허용 목록도 여기 있으니 검사도 여기가 맞다.
 */

/** `displayDialogs` 를 끄고 되돌린다. 끄지 못했으면 `false`. */
async function withoutDialogs<T>(
  run: () => Promise<T>,
): Promise<{ value: T; suppressed: boolean }> {
  const anyApp = app as unknown as Record<string, unknown>;
  const had = "displayDialogs" in anyApp;
  const previous = anyApp["displayDialogs"];
  let suppressed = false;
  if (had) {
    try {
      anyApp["displayDialogs"] = "dontDisplayDialogs";
      suppressed = anyApp["displayDialogs"] !== previous;
    } catch {
      suppressed = false;
    }
  }
  try {
    return { value: await run(), suppressed };
  } finally {
    if (suppressed) {
      try {
        anyApp["displayDialogs"] = previous;
      } catch {
        // 되돌리기 실패는 삼킨다. 원래 오류를 덮지 않는다.
      }
    }
  }
}

export async function actionPlay(params: { set: string; action: string }): Promise<{
  set: string;
  action: string;
  dialogsSuppressed: boolean;
  durationMs: number;
}> {
  return runModal("Play action", async () => {
    // **고르지 않은 것은 부를 수 없다.** 목록은 사용자가 패널에서 정한다.
    if (!isAllowed(params.set, params.action)) {
      const allowed = readAllowed();
      throw new DispatchError(
        "INVALID_PARAMETER",
        allowed.length === 0
          ? "실행이 허용된 액션이 없습니다. Photoshop MCP 패널의 '액션 선택…' 버튼으로 " +
              "사용할 액션을 골라야 부를 수 있습니다."
          : `'${params.set} > ${params.action}' 은 허용되지 않았습니다. ` +
              "Photoshop MCP 패널의 '액션 선택…' 에서 고른 것만 부를 수 있습니다.",
        {
          recoverable: true,
          details: { set: params.set, action: params.action, allowed },
        },
      );
    }

    const tree = (app as unknown as Record<string, unknown>)["actionTree"] as
      { length: number; [index: number]: Record<string, unknown> } | undefined;
    if (tree === undefined || typeof tree.length !== "number") {
      throw new DispatchError("COMMAND_FAILED", "액션 목록을 얻지 못했습니다.");
    }

    // **이름으로 찾는다.** 순번은 사용자가 액션을 옮기면 바뀐다(§17.34).
    let target: Record<string, unknown> | null = null;
    for (let i = 0; i < tree.length && target === null; i += 1) {
      if (tree[i]?.["name"] !== params.set) {
        continue;
      }
      const actions = tree[i]?.["actions"] as
        { length: number; [index: number]: Record<string, unknown> } | undefined;
      if (actions === undefined || typeof actions.length !== "number") {
        break;
      }
      for (let j = 0; j < actions.length; j += 1) {
        if (actions[j]?.["name"] === params.action) {
          target = actions[j] as Record<string, unknown>;
          break;
        }
      }
    }

    if (target === null) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `'${params.set}' 세트에 '${params.action}' 액션이 없습니다. ` +
          "photoshop.action.list 로 확인하세요. 사용자가 이름을 바꿨을 수 있습니다.",
        { recoverable: true, details: { set: params.set, action: params.action } },
      );
    }

    const play = target["play"] as (() => Promise<void>) | undefined;
    if (typeof play !== "function") {
      throw new DispatchError("COMMAND_FAILED", "이 액션에 play() 가 없습니다.");
    }

    const started = Date.now();
    const { suppressed } = await withoutDialogs(async () => play.call(target));
    return {
      set: params.set,
      action: params.action,
      dialogsSuppressed: suppressed,
      durationMs: Date.now() - started,
    };
  });
}
