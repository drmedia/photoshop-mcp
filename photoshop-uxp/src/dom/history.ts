import { app, type PhotoshopHistoryState } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * Phase 3 History. (ROADMAP §7.3)
 *
 * Undo · Redo 를 1단계씩 지원한다. 임의 지점 복원은 넣지 않았다 —
 * 이름으로 지점을 고르게 하면 같은 이름이 여러 개일 때 어디로 갈지 알 수 없다.
 */

export interface HistoryUndoResult {
  currentState: string;
}

/** `historyRedo` 의 결과. 모양은 undo 와 같다 — 둘을 따로 배우게 하지 않는다. */
export type HistoryRedoResult = HistoryUndoResult;

/**
 * 직전 작업을 한 단계 되돌린다.
 *
 * Photoshop 의 History 는 문서마다 있고, 열린 직후에는 항목이 하나뿐이라
 * 되돌릴 것이 없다. 그 경우 `HISTORY_EMPTY` 로 실패한다.
 */
export async function historyUndo(): Promise<HistoryUndoResult> {
  return runModal("Undo", async () => {
    const document = requireActiveDocument();

    const states = readStates(document.historyStates);
    // 현재 지점을 기준으로 한 칸 뒤로 간다. 규칙은 `currentIndexOf` 에 있다.
    const fromIndex = currentIndexOf(states, document.activeHistoryState);
    const target = states[fromIndex - 1];

    if (target === undefined) {
      throw new DispatchError("HISTORY_EMPTY", "되돌릴 작업이 없습니다.", { recoverable: true });
    }

    document.activeHistoryState = target;
    const moved = document.activeHistoryState;
    return { currentState: typeof moved?.name === "string" ? moved.name : target.name };
  });
}

/**
 * 지금 어디에 서 있는지. `historyStates` 의 인덱스.
 *
 * **`historyStates` 는 되돌려도 줄어들지 않는다.** `activeHistoryState` 포인터만
 * 움직인다. 그래서 `states[length - 2]` 같은 절대 위치를 쓰면 첫 undo 이후에는
 * 같은 지점에 머문다 — 실기에서 반복 undo 가 움직이지 않는 것으로 확인했다.
 *
 * 찾지 못하면 **가장 최근**으로 본다. undo 는 거기서 한 칸 뒤로 가면 되고,
 * redo 는 갈 곳이 없어 실패한다 — 어디 있는지 모를 때 임의의 지점으로
 * 뛰는 것보다 아무 데도 안 가는 쪽이 안전하다.
 */
function currentIndexOf(
  states: readonly PhotoshopHistoryState[],
  current: PhotoshopHistoryState | null | undefined,
): number {
  const found = states.findIndex((state) => state.id === current?.id);
  return found >= 0 ? found : states.length - 1;
}

/**
 * 한 단계 다시 실행한다. `historyUndo` 의 거울이다.
 *
 * **새 편집을 하면 다시 실행할 것이 사라진다.** Photoshop 이 앞쪽 가지를
 * 버리기 때문이고, 이 Command 가 아니라 Photoshop 의 동작이다.
 */
export async function historyRedo(): Promise<HistoryRedoResult> {
  return runModal("Redo", async () => {
    const document = requireActiveDocument();
    const states = readStates(document.historyStates);
    const fromIndex = currentIndexOf(states, document.activeHistoryState);
    const target = states[fromIndex + 1];

    if (target === undefined) {
      throw new DispatchError(
        "HISTORY_EMPTY",
        "다시 실행할 작업이 없습니다 — 이미 가장 최근 상태입니다. " +
          "되돌린 뒤 새로 편집했다면 Photoshop 이 앞쪽 이력을 버립니다.",
        { recoverable: true, details: { states: states.length, index: fromIndex } },
      );
    }

    document.activeHistoryState = target;
    const moved = document.activeHistoryState;
    return { currentState: typeof moved?.name === "string" ? moved.name : target.name };
  });
}

function readStates(value: unknown): PhotoshopHistoryState[] {
  if (Array.isArray(value)) {
    return value as PhotoshopHistoryState[];
  }
  if (value === null || value === undefined) {
    return [];
  }
  const collection = value as { length?: unknown; [index: number]: PhotoshopHistoryState };
  if (typeof collection.length !== "number") {
    return [];
  }
  const out: PhotoshopHistoryState[] = [];
  for (let i = 0; i < collection.length; i += 1) {
    const item = collection[i];
    if (item !== undefined) {
      out.push(item);
    }
  }
  return out;
}

/** 진단용. 현재 History 항목 수. */
export function historyDepth(): number {
  const document = app.activeDocument;
  return document === null || document === undefined
    ? 0
    : readStates(document.historyStates).length;
}
