import { app } from "photoshop";
import type { CommandDispatcher, CommandPayload } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * 이 세션이 만든 레이어. (ROADMAP §101)
 *
 * ## 어떻게 아는가
 *
 * 레이어를 만드는 Command 를 **실행 전후의 id 목록 차이**로 감시한다. 모든 Command 를 감시하지
 * 않는 것은 UXP 가 속성 하나마다 Photoshop 으로 왕복하기 때문이다 — 레이어가 많은 문서에서 매
 * Command 마다 두 번 훑으면 느려진다. 그래서 **만드는 Command 의 목록**이 이 파일에 있고,
 * 목록에 없는 Command 가 만든 레이어는 모른다(= 지울 수 없다. 잘못 지우는 쪽이 아니다).
 *
 * 기록은 메모리에만 있다. 플러그인을 다시 띄우면 잊는다.
 */

/** 레이어를 새로 만들 수 있는 Command. 서버의 Command 이름과 같아야 한다. */
export const LAYER_CREATING_COMMANDS: readonly string[] = [
  "LAYER_CREATE",
  "LAYER_DUPLICATE",
  "LAYER_STAMP_VISIBLE",
  "LAYER_PLACE",
  "LAYER_FROM_BACKGROUND",
  "GROUP_CREATE",
  "TEXT_CREATE",
  "DOCUMENT_PASTE",
  "SMART_OBJECT_NEW_VIA_COPY",
  "SMART_OBJECT_CONVERT",
  "ADJUSTMENT_CURVES",
  "ADJUSTMENT_LEVELS",
  "ADJUSTMENT_BRIGHTNESS_CONTRAST",
  "ADJUSTMENT_HUE_SATURATION",
  "ADJUSTMENT_VIBRANCE",
  "ADJUSTMENT_COLOR_BALANCE",
  "ADJUSTMENT_EXPOSURE",
  "ADJUSTMENT_BLACK_WHITE",
  "ADJUSTMENT_PHOTO_FILTER",
  "ADJUSTMENT_CHANNEL_MIXER",
  "RETOUCH_REMOVE_SPOTS",
];

/** 문서 id → 이 세션이 만든 레이어 id. */
const created = new Map<number, Set<number>>();

function snapshotIds(): { documentId: number; ids: number[] } | null {
  const document = app.activeDocument;
  if (document === null || document === undefined) {
    return null;
  }
  return { documentId: document.id, ids: flattenLayers(document.layers).map((entry) => entry.id) };
}

/** 만드는 Command 를 감시하도록 이미 등록된 핸들러를 감싼다. */
export function trackCreatedLayers(dispatcher: CommandDispatcher): void {
  for (const command of LAYER_CREATING_COMMANDS) {
    if (!dispatcher.has(command)) {
      continue;
    }
    dispatcher.wrap(command, (inner) => async (payload: CommandPayload) => {
      const before = snapshotIds();
      const result = await inner(payload);
      const after = snapshotIds();
      if (before !== null && after !== null && before.documentId === after.documentId) {
        const known = new Set(before.ids);
        let set = created.get(after.documentId);
        if (set === undefined) {
          set = new Set();
          created.set(after.documentId, set);
        }
        for (const id of after.ids) {
          if (!known.has(id)) {
            set.add(id);
          }
        }
      }
      return result;
    });
  }
}

function currentCreated(): { documentId: number; layers: { id: number; name: string }[] } {
  const document = requireActiveDocument();
  const set = created.get(document.id) ?? new Set<number>();
  const layers = flattenLayers(document.layers)
    .filter((entry) => set.has(entry.id))
    .map((entry) => ({ id: entry.id, name: String(entry.name ?? "") }));
  return { documentId: document.id, layers };
}

export async function layerListCreated(): Promise<{
  documentId: number;
  layers: { id: number; name: string }[];
}> {
  return runModal("List created layers", () => currentCreated());
}

export async function layerDeleteCreated(params: { layerIds?: number[] }): Promise<{
  deleted: number[];
  failed: { id: number; reason: string }[];
  notCreated: number[];
  remaining: number;
}> {
  return runModal("Delete created layers", async () => {
    const document = requireActiveDocument();
    const mine = currentCreated().layers.map((entry) => entry.id);
    const requested = params.layerIds === undefined ? mine : [...new Set(params.layerIds)];
    const targets = requested.filter((id) => mine.includes(id));
    const notCreated = requested.filter((id) => !mine.includes(id));

    const failed: { id: number; reason: string }[] = [];
    for (const id of targets) {
      // 그룹을 지우면 자식이 올라오므로 이미 사라진 id 일 수 있다.
      const layer = findLayerById(document.layers, id);
      if (layer === undefined || layer === null) {
        continue;
      }
      try {
        await layer.delete();
      } catch (error) {
        failed.push({
          id,
          reason: String((error as { message?: unknown })?.message ?? error).slice(0, 160),
        });
      }
    }

    // **요청이 아니라 결과를 읽는다.**
    const after = requireActiveDocument();
    const remainingIds = flattenLayers(after.layers).map((entry) => entry.id);
    const deleted = targets.filter((id) => !remainingIds.includes(id));
    for (const id of targets) {
      if (!deleted.includes(id) && !failed.some((entry) => entry.id === id)) {
        failed.push({ id, reason: "오류 없이 끝났지만 레이어가 그대로 남아 있습니다." });
      }
    }
    return { deleted, failed, notCreated, remaining: remainingIds.length };
  });
}
