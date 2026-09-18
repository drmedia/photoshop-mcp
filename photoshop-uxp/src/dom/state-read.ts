import { app } from "photoshop";
import { requireActiveDocument } from "./document.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";

/**
 * 읽기 전용 상태 조회. (ROADMAP §16)
 *
 * MCP Resource 를 뒷받침한다. 선택 영역과 History 는 바꾸는 Command 만 있고
 * 읽는 Command 가 없었다.
 */

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 선택 영역 경계. 모양을 확신할 수 없으면 `null`. */
function selectionBounds(): Bounds | null {
  const raw = app.activeDocument?.selection?.bounds as Record<string, unknown> | undefined;
  if (raw === undefined || raw === null) {
    return null;
  }
  const pick = (key: string): number | null => {
    const value = raw[key];
    if (typeof value === "number") {
      return Math.round(value);
    }
    // UXP 는 단위 객체(`{_value, _unit}`)로 줄 때가 있다.
    const nested = (value as { _value?: unknown } | undefined)?._value;
    return typeof nested === "number" ? Math.round(nested) : null;
  };

  const left = pick("left");
  const top = pick("top");
  const right = pick("right");
  const bottom = pick("bottom");
  if (left === null || top === null || right === null || bottom === null) {
    // 일부만 읽히면 통째로 버린다. 반쪽 경계는 틀린 값보다 나을 게 없다.
    return null;
  }
  return { left, top, right, bottom };
}

/** `SELECTION_GET` — 선택 영역 상태. */
export async function selectionGet(): Promise<{
  hasSelection: boolean;
  bounds: Bounds | null;
}> {
  return runModal("Get selection", () => {
    requireActiveDocument();
    const has = hasSelection();
    return { hasSelection: has, bounds: has ? selectionBounds() : null };
  });
}

/** `HISTORY_LIST` — History 항목과 현재 지점. */
export async function historyList(): Promise<{
  states: string[];
  currentIndex: number;
  currentState: string;
}> {
  return runModal("List history", () => {
    const document = requireActiveDocument();
    const states = [...document.historyStates].map((state) => state.name);
    const current = document.activeHistoryState;

    // Photoshop 은 되돌려도 목록이 줄지 않고 현재 지점만 움직인다.
    // 마지막 항목이 현재라고 가정하면 undo 후에 틀린다. (Phase 3 실기에서 확인)
    const currentIndex = [...document.historyStates].findIndex(
      (state) => state.name === current.name,
    );

    return {
      states,
      currentIndex: currentIndex < 0 ? states.length - 1 : currentIndex,
      currentState: current.name,
    };
  });
}
