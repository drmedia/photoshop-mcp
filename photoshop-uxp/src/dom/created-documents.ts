import { app, constants } from "photoshop";
import type { CommandDispatcher, CommandPayload } from "../dispatcher/dispatcher.js";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * 이 세션이 만든 문서. (ROADMAP §101)
 *
 * `created-layers.ts` 와 같은 규칙이다 — **만드는 Command 의 결과에서 id 를 받아 적고**, 모르는 문서는
 * 닫지 않는다. 기록은 메모리에만 있다.
 *
 * `document.open` 은 적지 않는다. 디스크의 파일을 연 것이라 사용자의 문서다.
 */

/** 새 문서를 만드는 Command. 결과의 `document.id` 를 적는다. */
const DOCUMENT_CREATING_COMMANDS: readonly string[] = ["DOCUMENT_CREATE", "DOCUMENT_DUPLICATE"];

const created = new Set<number>();

export function trackCreatedDocuments(dispatcher: CommandDispatcher): void {
  for (const command of DOCUMENT_CREATING_COMMANDS) {
    if (!dispatcher.has(command)) {
      continue;
    }
    dispatcher.wrap(command, (inner) => async (payload: CommandPayload) => {
      const result = (await inner(payload)) as { document?: { id?: unknown } } | null;
      const id = result?.document?.id;
      if (typeof id === "number") {
        created.add(id);
      }
      return result;
    });
  }
}

function openMine(): { id: number; name: string }[] {
  return toArray<{ id: number; name: string }>(app.documents)
    .filter((entry) => created.has(entry.id))
    .map((entry) => ({ id: entry.id, name: String(entry.name) }));
}

export async function documentListCreated(): Promise<{
  documents: { id: number; name: string }[];
}> {
  return runModal("List created documents", () => ({ documents: openMine() }));
}

export async function documentCloseCreated(params: {
  documentIds?: number[];
  discardChanges: true;
}): Promise<{
  closed: number[];
  failed: { id: number; reason: string }[];
  notCreated: number[];
  remainingDocuments: number;
  activeDocumentId: number | null;
}> {
  return runModal("Close created documents", async () => {
    // 스키마가 리터럴 `true` 를 강제하지만 Extension 이 직접 부를 수 있다.
    if (params.discardChanges !== true) {
      throw new DispatchError("INVALID_PARAMETER", "discardChanges 에 true 를 명시해야 합니다.", {
        recoverable: true,
      });
    }
    // **대화상자를 띄우지 않는다.** 상수가 없으면 인자 없이 부르지 않고 실패한다.
    const doNotSave = constants.SaveOptions?.DONOTSAVECHANGES;
    if (doNotSave === undefined) {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에서 SaveOptions.DONOTSAVECHANGES 를 찾을 수 없습니다. 인자 없이 닫으면 " +
          "저장 여부를 묻는 창이 떠 플러그인이 멈추므로 실행하지 않았습니다.",
        { recoverable: false },
      );
    }

    const mine = openMine().map((entry) => entry.id);
    const requested = params.documentIds === undefined ? mine : [...new Set(params.documentIds)];
    const targets = requested.filter((id) => mine.includes(id));
    const notCreated = requested.filter((id) => !mine.includes(id));

    const failed: { id: number; reason: string }[] = [];
    for (const id of targets) {
      const document = toArray<{ id: number; close: (options: unknown) => Promise<void> }>(
        app.documents,
      ).find((entry) => entry.id === id);
      if (document === undefined) {
        continue;
      }
      try {
        await document.close(doNotSave);
      } catch (error) {
        failed.push({
          id,
          reason: String((error as { message?: unknown })?.message ?? error).slice(0, 160),
        });
      }
    }

    // **요청이 아니라 결과를 읽는다.**
    const open = toArray<{ id: number }>(app.documents);
    const closed = targets.filter((id) => !open.some((entry) => entry.id === id));
    for (const id of closed) {
      created.delete(id);
    }
    for (const id of targets) {
      if (!closed.includes(id) && !failed.some((entry) => entry.id === id)) {
        failed.push({ id, reason: "오류 없이 끝났지만 문서가 그대로 열려 있습니다." });
      }
    }
    return {
      closed,
      failed,
      notCreated,
      remainingDocuments: open.length,
      activeDocumentId: app.activeDocument?.id ?? null,
    };
  });
}
