import { action, app } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { toDocumentInfo } from "./document.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * 활성 문서를 옮긴다. (ROADMAP §101)
 *
 * ## 두 길이 있고 어느 쪽이 되는지는 실기에서 갈린다
 *
 * UXP 레퍼런스는 `app.activeDocument` 를 대입할 수 있다고 하는 버전과 읽기 전용이라고 하는 버전이
 * 있다. 짐작으로 한쪽만 쓰지 않는다 — **대입을 시도하고, 활성이 바뀌었는지 읽어서 확인하고, 안
 * 바뀌었으면 batchPlay `select` 로 넘어간다.** 어느 쪽으로 됐는지는 `method` 가 말한다. 한 번도
 * 쓰이지 않은 길은 실기에서 몇 번 돌아 보고 지운다(`rotate` 때와 같은 방식).
 *
 * 어느 쪽이든 **오류 없이 끝났다고 옮긴 것으로 치지 않는다.** 옮긴 뒤 `app.activeDocument.id` 를 다시
 * 읽는다.
 */

export async function documentActivate(params: { documentId?: number; name?: string }): Promise<{
  document: DocumentInfo;
  previousId: number | null;
  changed: boolean;
  method: "already" | "setter" | "batchPlay";
}> {
  return runModal("Activate document", async () => {
    const open = toArray<{ id: number; name: string }>(app.documents);
    if (open.length === 0) {
      throw new DispatchError("DOCUMENT_NOT_FOUND", "열려 있는 문서가 없습니다.", {
        recoverable: true,
      });
    }

    let target: { id: number; name: string } | undefined;
    if (params.documentId !== undefined) {
      target = open.find((entry) => entry.id === params.documentId);
    } else {
      const matches = open.filter((entry) => entry.name === params.name);
      if (matches.length > 1) {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `이름이 "${String(params.name)}" 인 문서가 ${matches.length}개입니다. documentId 로 고르세요.`,
          { recoverable: true, details: { ids: matches.map((entry) => entry.id) } },
        );
      }
      target = matches[0];
    }
    if (target === undefined) {
      throw new DispatchError("DOCUMENT_NOT_FOUND", "그 문서가 열려 있지 않습니다.", {
        recoverable: true,
        details: { open: open.map((entry) => ({ id: entry.id, name: entry.name })) },
      });
    }

    const previousId: number | null = app.activeDocument?.id ?? null;
    if (previousId === target.id) {
      return {
        document: toDocumentInfo(app.activeDocument as never),
        previousId,
        changed: false,
        method: "already" as const,
      };
    }

    let method: "setter" | "batchPlay" = "setter";
    try {
      (app as unknown as { activeDocument: unknown }).activeDocument = target;
    } catch {
      // 읽기 전용이면 던진다. 다음 길로 간다.
    }
    if (app.activeDocument?.id !== target.id) {
      method = "batchPlay";
      const results = await action.batchPlay(
        [{ _obj: "select", _target: [{ _ref: "document", _id: target.id }] }],
        {},
      );
      const failure = results.find((result) => result["message"] !== undefined);
      if (failure !== undefined) {
        throw new DispatchError(
          "COMMAND_FAILED",
          `문서로 옮기지 못했습니다: ${String(failure["message"])}`,
          { recoverable: true, details: { documentId: target.id } },
        );
      }
    }

    // **요청이 아니라 결과를 읽는다.**
    const now = app.activeDocument;
    if (now === null || now === undefined || now.id !== target.id) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `문서 ${target.id} 로 옮기지 못했습니다. 지금 활성 문서는 ${String(now?.id ?? null)} 입니다.`,
        { recoverable: true, details: { requested: target.id, active: now?.id ?? null } },
      );
    }
    return { document: toDocumentInfo(now), previousId, changed: true, method };
  });
}
