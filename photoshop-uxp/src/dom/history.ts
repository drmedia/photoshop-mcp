import { app, type PhotoshopHistoryState } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * Phase 3 History. (ROADMAP §7.3)
 *
 * Undo 1단계만 지원한다. 임의 지점 복원은 이후 Phase 에서 검토한다.
 */

export interface HistoryUndoResult {
  currentState: string;
}

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

    // 현재 지점을 기준으로 한 칸 뒤로 간다.
    //
    // `historyStates` 는 되돌려도 줄어들지 않고 `activeHistoryState` 포인터만 움직인다.
    // 그래서 `states[length - 2]` 같은 절대 위치를 쓰면 첫 undo 이후에는
    // 같은 지점에 머문다. 실기에서 반복 undo 가 움직이지 않는 것으로 확인했다.
    const current = document.activeHistoryState;
    const currentIndex = states.findIndex((state) => state.id === current?.id);
    const fromIndex = currentIndex >= 0 ? currentIndex : states.length - 1;
    const target = states[fromIndex - 1];

    if (target === undefined) {
      throw new DispatchError("HISTORY_EMPTY", "되돌릴 작업이 없습니다.", { recoverable: true });
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
