import { constants } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * 가이드. (ROADMAP §59)
 *
 * ## 전부 DOM 이다
 *
 * `document.guides`(23.0+) 컬렉션에 `add(direction, coordinate)` · `length` ·
 * 색인이 있고 `Guide` 에 `coordinate` · `direction`(둘 다 R/W) · `id` ·
 * `delete()` 가 있다. batchPlay 를 쓰지 않는다.
 *
 * **`delete()` 는 동기다** — 레퍼런스가 "Async: No" 라고 적는다. `await` 는
 * 둘 다 받으므로 그대로 기다린다(`layer.link` 와 같은 처리, §48).
 *
 * ## 좌표는 눈금자 원점 기준이다
 *
 * 레퍼런스가 "measured from the **ruler origin**" 이라고 적는다 — 사용자가
 * 원점을 옮겼으면 캔버스 좌표와 어긋난다. 우리가 그것을 읽을 방법은 없다.
 */

export interface GuideInfo {
  /** `document.guides` 에서의 위치. */
  index: number;
  /** batchPlay 용 id. 못 읽으면 `null`. */
  id: number | null;
  /** `horizontal` · `vertical`. 못 읽으면 `null` 이고 `rawDirection` 에 원본이 있다. */
  direction: string | null;
  rawDirection?: string;
  /** 눈금자 원점에서의 위치(픽셀). 소수가 올 수 있다. */
  coordinate: number | null;
}

type GuideLike = Record<string, unknown>;

function collection(document: ReturnType<typeof requireActiveDocument>): GuideLike {
  const guides = (document as unknown as GuideLike)["guides"] as GuideLike | undefined;
  if (guides === undefined || guides === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 document.guides 가 없습니다(23.0 이상이 필요합니다).",
      { recoverable: false },
    );
  }
  return guides;
}

function allGuides(document: ReturnType<typeof requireActiveDocument>): GuideLike[] {
  const guides = collection(document);
  const length = guides["length"];
  if (typeof length !== "number") {
    throw new DispatchError("COMMAND_FAILED", "가이드 개수를 읽지 못했습니다.", {
      recoverable: true,
    });
  }
  const out: GuideLike[] = [];
  for (let i = 0; i < length; i += 1) {
    const entry = (guides as unknown as Record<number, GuideLike>)[i];
    if (entry !== undefined && entry !== null) {
      out.push(entry);
    }
  }
  return out;
}

function describe(guide: GuideLike, index: number): GuideInfo {
  const pick = (key: string): unknown => {
    try {
      return guide[key];
    } catch {
      return undefined;
    }
  };
  const id = pick("id");
  const coordinate = pick("coordinate");
  const direction = pick("direction");

  const info: GuideInfo = {
    index,
    id: typeof id === "number" ? id : null,
    direction: typeof direction === "string" ? direction : null,
    coordinate: typeof coordinate === "number" ? coordinate : null,
  };
  /* 매핑에 실패했을 때만 원본을 담는다. (`rawKind` 와 같은 규칙) */
  if (info.direction === null && direction !== undefined && direction !== null) {
    info.rawDirection = String(direction);
  }
  return info;
}

export function guideList(): { guides: GuideInfo[] } {
  const document = requireActiveDocument();
  return { guides: allGuides(document).map((entry, index) => describe(entry, index)) };
}

const DIRECTION_KEYS = { horizontal: "HORIZONTAL", vertical: "VERTICAL" } as const;
export type GuideDirection = keyof typeof DIRECTION_KEYS;

/** 상수 표에서 값을 꺼낸다. 없으면 **무엇이 있는지 함께** 담아 거절한다. */
function directionOf(name: GuideDirection): unknown {
  const table = constants.Direction as unknown as Record<string, unknown> | undefined;
  const value = table?.[DIRECTION_KEYS[name]];
  if (value === undefined) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 에서 방향 ${name}(${DIRECTION_KEYS[name]}) 을 찾을 수 없습니다.`,
      {
        recoverable: true,
        details: {
          name,
          hasTable: table !== undefined,
          available: table === undefined ? [] : Object.keys(table),
        },
      },
    );
  }
  return value;
}

export async function guideCreate(params: {
  direction: GuideDirection;
  coordinate: number;
}): Promise<GuideInfo> {
  return runModal("Create guide", async () => {
    const document = requireActiveDocument();
    const guides = collection(document);
    const add = guides["add"];
    if (typeof add !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.guides.add 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const direction = directionOf(params.direction);
    const before = allGuides(document).length;
    await (add as (d: unknown, c: number) => unknown).call(guides, direction, params.coordinate);

    /* **정말 늘었는지 확인한다.** 오류 없이 아무 일도 안 하는 경로가 이
     * 프로젝트에 여럿 있었다. */
    const after = allGuides(document);
    if (after.length !== before + 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `가이드가 늘지 않았습니다(${before} → ${after.length}). guide.list 로 확인하세요.`,
        { recoverable: true },
      );
    }
    const index = after.length - 1;
    return describe(after[index] as GuideLike, index);
  });
}

/**
 * 가이드를 지운다.
 *
 * **`id` 로 고르는 길을 함께 둔다.** 실기에서 하나를 지우니 뒤의 색인이
 * 밀렸다(id 785 가 1 → 0). `id` 는 안정적이므로 여러 개를 지울 때 그것을
 * 쓰면 순서를 신경 쓰지 않아도 된다. (ROADMAP §59)
 */
export async function guideDelete(params: { index?: number; id?: number }): Promise<{
  deleted: GuideInfo;
  remaining: number;
}> {
  return runModal("Delete guide", async () => {
    const document = requireActiveDocument();
    const guides = allGuides(document);

    let at: number;
    if (params.id !== undefined) {
      at = guides.findIndex((entry) => describe(entry, 0).id === params.id);
      if (at < 0) {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `가이드 id ${params.id} 를 찾을 수 없습니다.`,
          {
            recoverable: true,
            details: {
              id: params.id,
              available: guides.map((entry, index) => describe(entry, index).id),
            },
          },
        );
      }
    } else {
      at = params.index as number;
    }

    const target = guides[at];
    if (target === undefined) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `가이드 색인 ${at} 가 범위를 벗어납니다. 가이드는 ${guides.length}개입니다.`,
        { recoverable: true, details: { index: at, count: guides.length } },
      );
    }
    const info = describe(target, at);

    const remove = target["delete"];
    if (typeof remove !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 의 Guide 에 delete 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }
    /* **레퍼런스가 "Async: No" 라고 적는다.** `await` 는 둘 다 받으므로 그대로
     * 기다린다 — 런타임이 문서와 달라도 깨지지 않는다. (§48 과 같은 처리) */
    await (remove as () => unknown).call(target);

    const after = allGuides(document);
    if (after.length !== guides.length - 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `가이드가 지워지지 않았습니다(${guides.length} → ${after.length}). guide.list 로 확인하세요.`,
        { recoverable: true, details: { index: at } },
      );
    }
    return { deleted: info, remaining: after.length };
  });
}
