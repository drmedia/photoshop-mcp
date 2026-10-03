import { action } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * History 스냅샷. (ROADMAP §101)
 *
 * ## 진짜 스냅샷이다
 *
 * `document.activeHistoryState` 를 기억해 두는 방법은 쓰지 않는다. Photoshop 은 History 를 50개
 * (기본)만 들고 있어서 편집이 쌓이면 기억해 둔 지점이 사라진다. 스냅샷은 그 한도와 무관하다.
 *
 * UXP DOM 에는 스냅샷을 만드는 API 가 없어 `batchPlay` 다. 키는 Photoshop 이 사람이 스냅샷을
 * 만들 때 쓰는 것이다(`Mk  ` + `SnpS` + `HstS/CrnH` + `FllD`).
 *
 * ## 이름은 우리가 만든 것만 안다
 *
 * Photoshop 에는 `MCP · <이름>` 으로 붙인다. 사용자가 패널에서 만든 스냅샷과 이름이 겹치면 어느
 * 쪽으로 돌아갈지 알 수 없기 때문이다. 기록은 문서 id 별로 이 모듈이 들고 있고, 플러그인을 다시
 * 띄우면 사라진다 — Photoshop 에는 남아 있어도 여기서는 모른다.
 *
 * ## 돌아온 뒤 확인한다
 *
 * `select` 가 오류 없이 끝났다고 돌아온 것은 아니다. 만들 때 기록해 둔 **레이어 id 구성**과
 * 지금을 견주어 `layerIdsMatch` 로 돌려준다. 이 프로젝트가 `opacityApplied` 와 `mutate()` 에서
 * 지켜 온 것과 같은 원칙이다 — 안 했는데 했다고 말하지 않는다.
 */

/** Photoshop 에 붙는 이름의 접두사. 사용자가 만든 스냅샷과 겹치지 않게 한다. */
const PREFIX = "MCP · ";

interface SnapshotRecord {
  name: string;
  photoshopName: string;
  /** 만들 때의 History 상태 이름. */
  historyState: string;
  /** 만들 때의 레이어 id. 돌아온 뒤 견주는 기준이다. */
  layerIds: number[];
}

/** 문서 id → 이름 → 기록. */
const registry = new Map<number, Map<string, SnapshotRecord>>();

function recordsOf(documentId: number): Map<string, SnapshotRecord> {
  let records = registry.get(documentId);
  if (records === undefined) {
    records = new Map();
    registry.set(documentId, records);
  }
  return records;
}

/** batchPlay 가 오류를 던지지 않고 결과에 `message` 로 담아 돌려주는 경우를 잡는다. */
function failureOf(results: readonly Record<string, unknown>[]): string | null {
  const failure = results.find((result) => result["message"] !== undefined);
  return failure === undefined ? null : String(failure["message"]);
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((id, index) => id === sortedB[index]);
}

export async function historyCreateSnapshot(params: { name: string }): Promise<{
  name: string;
  documentId: number;
  photoshopName: string;
  historyState: string;
  layerCount: number;
}> {
  return runModal("Create snapshot", async () => {
    const document = requireActiveDocument();
    const records = recordsOf(document.id);

    // **덮어쓰지 않는다.** 같은 이름을 다시 만들면 어디로 돌아가는지 알 수 없게 된다.
    if (records.has(params.name)) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `스냅샷 "${params.name}" 이 이미 있습니다. 다른 이름을 쓰세요.`,
        { recoverable: true, details: { existing: [...records.keys()] } },
      );
    }

    const layerIds = flattenLayers(document.layers).map((entry) => entry.id);
    const photoshopName = `${PREFIX}${params.name}`;

    const results = await action.batchPlay(
      [
        {
          _obj: "make",
          _target: [{ _ref: "snapshotClass" }],
          from: { _ref: "historyState", _property: "currentHistoryState" },
          name: photoshopName,
          using: { _enum: "historyState", _value: "fullDocument" },
        },
      ],
      {},
    );
    const message = failureOf(results);
    if (message !== null) {
      throw new DispatchError("COMMAND_FAILED", `스냅샷을 만들지 못했습니다: ${message}`, {
        recoverable: true,
        details: { name: params.name },
      });
    }

    const historyState = String(document.activeHistoryState?.name ?? "");
    records.set(params.name, {
      name: params.name,
      photoshopName,
      historyState,
      layerIds,
    });
    return {
      name: params.name,
      documentId: document.id,
      photoshopName,
      historyState,
      layerCount: layerIds.length,
    };
  });
}

export async function historyRestoreSnapshot(params: { name: string }): Promise<{
  name: string;
  documentId: number;
  currentState: string;
  layerIdsMatch: boolean;
}> {
  return runModal("Restore snapshot", async () => {
    const document = requireActiveDocument();
    const records = recordsOf(document.id);
    const record = records.get(params.name);

    // **모르는 이름이면 아는 이름을 말해 준다.** 사용자가 만든 스냅샷으로는 가지 않는다.
    if (record === undefined) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `이 서버가 만든 스냅샷 "${params.name}" 이 활성 문서에 없습니다.`,
        { recoverable: true, details: { known: [...records.keys()], documentId: document.id } },
      );
    }

    const results = await action.batchPlay(
      [
        {
          _obj: "select",
          _target: [{ _ref: "snapshotClass", _name: record.photoshopName }],
        },
      ],
      {},
    );
    const message = failureOf(results);
    if (message !== null) {
      throw new DispatchError("COMMAND_FAILED", `스냅샷으로 돌아가지 못했습니다: ${message}`, {
        recoverable: true,
        details: { name: params.name, photoshopName: record.photoshopName },
      });
    }

    // **요청이 아니라 결과를 읽는다.**
    const after = requireActiveDocument();
    const nowIds = flattenLayers(after.layers).map((entry) => entry.id);
    return {
      name: params.name,
      documentId: after.id,
      currentState: String(after.activeHistoryState?.name ?? ""),
      layerIdsMatch: after.id === document.id && sameIds(record.layerIds, nowIds),
    };
  });
}

export async function historyListSnapshots(): Promise<{
  documentId: number;
  snapshots: { name: string; historyState: string; layerCount: number }[];
}> {
  return runModal("List snapshots", () => {
    const document = requireActiveDocument();
    const records = recordsOf(document.id);
    return {
      documentId: document.id,
      snapshots: [...records.values()].map((record) => ({
        name: record.name,
        historyState: record.historyState,
        layerCount: record.layerIds.length,
      })),
    };
  });
}
