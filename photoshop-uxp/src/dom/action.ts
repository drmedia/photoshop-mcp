import { app } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";

/**
 * 액션 조회. (ROADMAP §17.34)
 *
 * ## DOM 에 있는지 재 봤고, 있었다
 *
 * `app.actionTree` 가 `ActionSet` 배열을 주고, 각 세트의 `actions` 가
 * `Action` 배열이다. 둘 다 `name` · `id` 를 갖는다.
 * (`document.rotate` §17.19 와 같은 방식으로 확인했다)
 *
 * ## **속성 하나마다 Photoshop 으로 왕복한다**
 *
 * 전부 한 번에 읽으려다 두 번 타임아웃했다. 액션 91개인 기기에서
 * 속성 3개를 읽으면 300왕복, 2개로 줄여도 200왕복이고 둘 다 15초를 넘겼다.
 *
 * 그래서 **두 단계로 나눈다.**
 *
 * ```text
 * set 없음   세트 이름만            11 세트 × 2 = 22 왕복
 * set 있음   그 세트의 액션만        26 액션 × 2 = 52 왕복
 * ```
 *
 * 사용자가 탐색하는 순서와도 맞는다 — 세트를 보고 그 안을 본다.
 *
 * ## 조회만 한다
 *
 * 실행은 여기 없다. 액션은 **내용을 알 수 없고** 실기 목록에 이미
 * `내보내기 > PSD로 저장` 이 있었다 — 승인된 작업 폴더 밖으로 파일을 쓴다.
 * 무엇을 실행할 수 있는지는 사용자가 선언한다. (Capability §19 와 같은 규칙)
 */

export interface ActionInfo {
  name: string;
  id: number;
}

export interface ActionSetInfo extends ActionInfo {
  /** `set` 을 주지 않으면 비어 있다. 액션까지 읽으면 왕복이 너무 많다. */
  actions: ActionInfo[];
}

/**
 * `name` · `id` 를 안전하게 읽는다. 하나라도 없으면 담지 않는다.
 *
 * **`index` 는 읽지 않는다.** 왕복이 늘고, 순번은 사용자가 액션을 옮기면
 * 바뀌어 키로 쓸 수도 없다 — 값이 없다.
 */
function toInfo(raw: Record<string, unknown> | undefined): ActionInfo | null {
  if (raw === undefined) {
    return null;
  }
  const name = raw["name"];
  const id = raw["id"];
  if (typeof name !== "string" || typeof id !== "number") {
    return null;
  }
  return { name, id };
}

function requireTree(): { length: number; [index: number]: Record<string, unknown> } {
  const tree = (app as unknown as Record<string, unknown>)["actionTree"] as
    { length: number; [index: number]: Record<string, unknown> } | undefined;
  if (tree === undefined || typeof tree.length !== "number") {
    throw new DispatchError(
      "COMMAND_FAILED",
      "이 Photoshop 에서 액션 목록을 얻지 못했습니다(app.actionTree 없음).",
    );
  }
  return tree;
}

export async function actionList(params: { set?: string }): Promise<{
  sets: ActionSetInfo[];
  totalSets: number;
}> {
  const tree = requireTree();

  const sets: ActionSetInfo[] = [];
  for (let i = 0; i < tree.length; i += 1) {
    const info = toInfo(tree[i]);
    if (info === null) {
      continue;
    }
    // 세트를 지정하지 않으면 **액션은 읽지 않는다.** 왕복이 너무 많다.
    if (params.set === undefined || info.name !== params.set) {
      sets.push({ ...info, actions: [] });
      continue;
    }

    const rawActions = tree[i]?.["actions"] as
      { length: number; [index: number]: Record<string, unknown> } | undefined;
    const actions: ActionInfo[] = [];
    if (rawActions !== undefined && typeof rawActions.length === "number") {
      for (let j = 0; j < rawActions.length; j += 1) {
        const action = toInfo(rawActions[j]);
        if (action !== null) {
          actions.push(action);
        }
      }
    }
    sets.push({ ...info, actions });
  }

  // 지정한 세트가 없으면 조용히 빈 목록을 주지 않는다 — 이름을 틀린 것인지
  // 액션이 없는 것인지 호출자가 구분할 수 없다.
  if (params.set !== undefined && !sets.some((entry) => entry.name === params.set)) {
    throw new DispatchError(
      "INVALID_PARAMETER",
      `'${params.set}' 이라는 액션 세트가 없습니다. ` +
        "set 없이 photoshop.action.list 를 부르면 세트 이름을 볼 수 있습니다.",
      { recoverable: true, details: { set: params.set, available: sets.map((s) => s.name) } },
    );
  }

  return { sets, totalSets: sets.length };
}
