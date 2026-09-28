import { action, app } from "photoshop";
import type { PhotoshopDocument } from "photoshop";
import type { SaveResult } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { closeWorkDocument } from "./close-work-document.js";
import { resolveDuplicatedDocumentId } from "./duplicated-document.js";
import { tiffDescriptor } from "./export-tiff.js";
import { toArray } from "./layers.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";
import { fileSystem } from "./workspace.js";

/**
 * 선택 영역을 16비트 TIFF 마스크로 내보낸다.
 *
 * ## 왜 필요한가
 *
 * GraXpert 는 지상 풍경이 든 사진에서 **산·나무가 배경 모델을 끌어당긴다.**
 * 전체 이미지를 그냥 넣으면 하늘에서 뺄 것을 거의 못 찾는다 — 실기에서
 * 결과가 원본과 눈으로 구분되지 않았다.
 *
 * 피하는 방법은 **지상부를 하늘의 연장선으로 덮어서** 넣는 것이고
 * (`packages/mcp-core/src/capabilities/sky-fill.ts`), 그러려면 어디가
 * 하늘인지를 **전체 해상도로** 알려 줘야 한다.
 *
 * `selection.capture` 는 축소본이고 `selection.save_channel` 은 문서 안에만
 * 남는다. 파일로 나가는 길이 없었다.
 *
 * ## 왜 복제본에서 하는가
 *
 * 원본을 검게 칠할 수는 없다. `export-tiff.ts` 와 같은 이유이자 같은 방식이다.
 *
 * **선택은 복제본으로 따라가지 않을 수 있다.** 그래서 임시 알파 채널에 저장한
 * 뒤 복제한다 — 채널은 따라간다. 끝나면 원본에서 지운다.
 */

/** 임시 채널 이름. 사용자 채널과 겹치지 않게 접두사를 둔다. */
function temporaryChannelName(): string {
  return `__mcp_selection_${String(Date.now())}`;
}

async function play(what: string, descriptor: Record<string, unknown>): Promise<void> {
  const results = await action.batchPlay([descriptor], {});
  const failure = results.find((result) => result["message"] !== undefined);
  if (failure !== undefined) {
    throw new DispatchError("COMMAND_FAILED", String(failure["message"]), { details: { what } });
  }
}

/** 캔버스 전체를 고른다. */
const SELECT_ALL = {
  _obj: "set",
  _target: [{ _ref: "channel", _property: "selection" }],
  to: { _enum: "ordinal", _value: "allEnum" },
};

const DESELECT = {
  _obj: "set",
  _target: [{ _ref: "channel", _property: "selection" }],
  to: { _enum: "ordinal", _value: "none" },
};

function fill(color: "black" | "white"): Record<string, unknown> {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: color },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
  };
}

/** 저장해 둔 채널에서 선택을 되살린다. */
function loadChannel(name: string): Record<string, unknown> {
  return {
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: { _ref: "channel", _name: name },
  };
}

export interface MaskExportParams {
  filename: string;
}

export async function exportSelectionMask(
  file: unknown,
  path: string,
  params: MaskExportParams,
): Promise<SaveResult> {
  return runModal("Export selection mask", async () => {
    const original = requireActiveDocument();
    if (!hasSelection()) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "선택 영역 마스크를 내보내려면 선택 영역이 있어야 합니다.",
        { recoverable: true },
      );
    }

    /* **선택을 채널로 먼저 저장한다.** 복제본으로 선택이 따라간다는 보장이
     * 없다. 채널은 따라간다. */
    const channel = temporaryChannelName();
    await play("선택을 채널로 저장", {
      _obj: "duplicate",
      _target: [{ _ref: "channel", _property: "selection" }],
      name: channel,
    });

    const beforeIds = toArray<{ id: number }>(app.documents).map((entry) => entry.id);
    const returned = await original.duplicate();
    const open = toArray<PhotoshopDocument>(app.documents);
    const workId = resolveDuplicatedDocumentId(
      beforeIds,
      (returned as { id?: unknown } | null | undefined)?.id,
      open.map((entry) => entry.id),
    );
    const work = open.find((entry) => entry.id === workId);

    if (work === undefined) {
      await removeChannel(original, channel);
      throw new DispatchError(
        "COMMAND_FAILED",
        "복제본을 찾지 못해 마스크 내보내기를 중단했습니다. " +
          "이름 없는 문서가 열려 있으면 저장하지 말고 닫으십시오.",
        { details: { filename: params.filename } },
      );
    }

    try {
      await work.flatten();

      /* 전체를 검게 칠하고 선택 안만 희게 칠한다. 순서가 반대면 선택을
       * 잃는다 — `fill` 은 선택 범위에만 걸리기 때문이다. */
      await play("전체 선택", SELECT_ALL);
      await play("검정 채우기", fill("black"));
      await play("채널에서 선택 불러오기", loadChannel(channel));
      await play("흰색 채우기", fill("white"));
      await play("선택 해제", DESELECT);

      const token = fileSystem().createSessionToken(
        file as Parameters<ReturnType<typeof fileSystem>["createSessionToken"]>[0],
      );
      await play("TIFF 저장", tiffDescriptor(token));

      return { path, filename: params.filename, format: "tiff" };
    } finally {
      /* **짐작해서 닫지 않는다.** `?? "no"` 로 두면 상수가 없는 호스트에서
       * Photoshop 이 저장 여부를 묻는 창을 띄우고 플러그인이 멈춘다 —
       * `try/catch` 는 도움이 안 된다. 닫지 못하면 남겨 두고 알린다.
       * (ROADMAP §30) */
      const closeFailure = await closeWorkDocument(work);
      if (closeFailure !== null) {
        /* 내보내기 결과는 이미 유효하므로 실패로 만들지 않는다. 다만
         * **조용히 넘기지도 않는다** — 남은 복제본은 다음 Command 의
         * `activeDocument` 가 되어 사용자가 원본으로 착각한다. */
        console.error(`[photoshop-mcp] ${closeFailure}`);
      }
      await removeChannel(original, channel);
    }
  });
}

/**
 * 임시 채널을 지운다.
 *
 * **실패해도 던지지 않는다.** 마스크는 이미 나왔고, 남은 채널은 사용자가
 * 지울 수 있다 — 그것 때문에 성공한 작업을 실패로 보고하지 않는다.
 */
async function removeChannel(document: PhotoshopDocument, name: string): Promise<void> {
  try {
    void document;
    await action.batchPlay([{ _obj: "delete", _target: [{ _ref: "channel", _name: name }] }], {});
  } catch {
    // 삼킨다. 위 주석 참조.
  }
}
