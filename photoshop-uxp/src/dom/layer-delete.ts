import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * 레이어 삭제. (ROADMAP §17.18)
 *
 * ## 지웠다고 말하기 전에 확인한다
 *
 * `delete()` 가 던지지 않았다고 사라진 것은 아니다. 지운 뒤 **레이어 목록을 다시
 * 읽어** 정말 없는 id 만 `deleted` 에 담는다. 이 프로젝트가 `opacityApplied` 와
 * `mutate()` 에서 지켜 온 것과 같은 원칙이다 — 안 했는데 했다고 말하지 않는다.
 *
 * ## 문서를 비우지 않는다
 *
 * Photoshop 은 레이어가 하나도 없는 문서를 허용하지 않는다. 전부 지우라는 요청이
 * 오면 마지막 하나에서 알 수 없는 메시지로 실패한다. 미리 막고 이유를 말한다.
 */

export async function layerDelete(params: { layerIds: number[] }): Promise<{
  deleted: number[];
  failed: { id: number; reason: string }[];
  remaining: number;
}> {
  return runModal("Delete layers", async () => {
    const document = requireActiveDocument();
    const before = flattenLayers(document.layers).map((entry) => entry.id);
    const requested = [...new Set(params.layerIds)];

    // **문서를 비우지 않는다.** 전부 지우면 마지막에서 알 수 없는 오류가 난다.
    const survivors = before.filter((id) => !requested.includes(id));
    if (before.length > 0 && survivors.length === 0) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${before.length}개를 전부 지울 수는 없습니다. ` +
          "Photoshop 문서에는 레이어가 최소 하나 있어야 합니다.",
        { recoverable: true, details: { requested: requested.length, total: before.length } },
      );
    }

    const failed: { id: number; reason: string }[] = [];

    for (const id of requested) {
      const layer = findLayerById(document.layers, id);
      if (layer === undefined || layer === null) {
        failed.push({ id, reason: "레이어를 찾을 수 없습니다." });
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

    // **요청이 아니라 결과를 읽는다.** 던지지 않았다고 사라진 것은 아니다.
    const after = requireActiveDocument();
    const remainingIds = flattenLayers(after.layers).map((entry) => entry.id);
    const deleted = requested.filter((id) => !remainingIds.includes(id));

    for (const id of requested) {
      if (!deleted.includes(id) && !failed.some((entry) => entry.id === id)) {
        // 오류 없이 남아 있는 경우다. 성공으로 보고하면 호출자가 지워졌다고 믿는다.
        failed.push({ id, reason: "오류 없이 끝났지만 레이어가 그대로 남아 있습니다." });
      }
    }

    return { deleted, failed, remaining: remainingIds.length };
  });
}
