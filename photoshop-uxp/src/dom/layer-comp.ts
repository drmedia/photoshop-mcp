import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * 레이어 컴프. (ROADMAP §57)
 *
 * 레이어의 **표시 여부 · 위치 · 모양(레이어 스타일)** 을 한 벌로 저장해 두고
 * 오갈 수 있게 한다. 같은 문서로 여러 안을 비교할 때 쓴다.
 *
 * ## 전부 DOM 이다
 *
 * `document.layerComps`(24.0+) 컬렉션에 `add` · `getAllByName` · `length` ·
 * 색인이 있고, `LayerComp` 에 `apply` · `recapture` · `remove` · `duplicate` ·
 * `resetLayerComp` 와 R/W 속성들이 있다. batchPlay 를 쓰지 않는다.
 *
 * ## `add` 의 옵션 모양을 짐작하지 않는다
 *
 * 레퍼런스가 `add(options: LayerCompCreateOptions)` 라고만 적고 **그 인터페이스
 * 페이지가 없다.** 그래서 **`add({})` 로 만든 뒤 R/W 속성에 직접 넣는다** —
 * `name` · `comment` · `appearance` · `position` · `visibility` · `childComp`
 * 가 전부 읽기/쓰기다. 그리고 **넣은 뒤 읽어서 확인한다.**
 *
 * 레퍼런스는 옵션 없이 만들면 "only visibility will be recorded" 라고 적는다.
 * 그 말대로인지도 결과로 드러난다.
 *
 * ## 이름이 유일하지 않다
 *
 * `getAllByName` 이 **배열**을 돌려준다 — 액션과 같다(§17.34). 이름으로 고를
 * 때 여럿이면 거절하고 색인을 쓰라고 말한다. 조용히 첫 번째를 고르면 호출자가
 * 무엇에 걸었는지 모른다.
 */

export interface LayerCompInfo {
  /** `document.layerComps` 에서의 위치. */
  index: number;
  /** batchPlay 용 id. 못 읽으면 `null`. */
  id: number | null;
  name: string;
  comment: string | null;
  /** 레이어 스타일을 기억하는지. */
  appearance: boolean | null;
  /** 레이어 위치를 기억하는지. */
  position: boolean | null;
  /** 레이어 표시 여부를 기억하는지. */
  visibility: boolean | null;
  /** 스마트 오브젝트 안의 컴프 선택을 기억하는지. */
  childComp: boolean | null;
  /** 지금 패널에서 선택되어 있는지. 읽기 전용이다. */
  selected: boolean | null;
}

type CompLike = Record<string, unknown>;

/** 못 읽으면 `null` 이다. 지어내지 않는다. */
function read<T>(comp: CompLike, key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const value = comp[key];
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";

function collection(document: ReturnType<typeof requireActiveDocument>): CompLike {
  const comps = (document as unknown as CompLike)["layerComps"] as CompLike | undefined;
  if (comps === undefined || comps === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 document.layerComps 가 없습니다(24.0 이상이 필요합니다).",
      { recoverable: false },
    );
  }
  return comps;
}

function allComps(document: ReturnType<typeof requireActiveDocument>): CompLike[] {
  const comps = collection(document);
  const length = comps["length"];
  if (typeof length !== "number") {
    throw new DispatchError("COMMAND_FAILED", "레이어 컴프 개수를 읽지 못했습니다.", {
      recoverable: true,
    });
  }
  const out: CompLike[] = [];
  for (let i = 0; i < length; i += 1) {
    const entry = (comps as unknown as Record<number, CompLike>)[i];
    if (entry !== undefined && entry !== null) {
      out.push(entry);
    }
  }
  return out;
}

function describe(comp: CompLike, index: number): LayerCompInfo {
  return {
    index,
    id: read(comp, "id", isNumber),
    name: read(comp, "name", isString) ?? `컴프 ${index}`,
    comment: read(comp, "comment", isString),
    appearance: read(comp, "appearance", isBoolean),
    position: read(comp, "position", isBoolean),
    visibility: read(comp, "visibility", isBoolean),
    childComp: read(comp, "childComp", isBoolean),
    selected: read(comp, "selected", isBoolean),
  };
}

export function layerCompList(): { comps: LayerCompInfo[] } {
  const document = requireActiveDocument();
  return { comps: allComps(document).map((entry, index) => describe(entry, index)) };
}

/**
 * 이름 또는 색인으로 하나를 찾는다.
 *
 * **이름이 여럿이면 거절한다.** 조용히 첫 번째를 고르면 호출자가 무엇에
 * 걸었는지 모른다 — 레이어 컴프 이름은 유일하지 않다.
 */
function locate(
  document: ReturnType<typeof requireActiveDocument>,
  params: { name?: string; index?: number },
): { comp: CompLike; index: number } {
  const comps = allComps(document);
  if (params.index !== undefined) {
    const found = comps[params.index];
    if (found === undefined) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 컴프 색인 ${params.index} 가 범위를 벗어납니다. 컴프는 ${comps.length}개입니다.`,
        { recoverable: true, details: { index: params.index, count: comps.length } },
      );
    }
    return { comp: found, index: params.index };
  }

  const matches: number[] = [];
  comps.forEach((entry, index) => {
    if (read(entry, "name", isString) === params.name) {
      matches.push(index);
    }
  });

  if (matches.length === 0) {
    throw new DispatchError(
      "INVALID_PARAMETER",
      `레이어 컴프 '${String(params.name)}' 이 없습니다.`,
      {
        recoverable: true,
        details: {
          name: params.name,
          available: comps.map((entry, index) => read(entry, "name", isString) ?? `#${index}`),
        },
      },
    );
  }
  if (matches.length > 1) {
    throw new DispatchError(
      "INVALID_PARAMETER",
      `레이어 컴프 '${String(params.name)}' 이 ${matches.length}개입니다. index 로 고르세요.`,
      { recoverable: true, details: { name: params.name, indexes: matches } },
    );
  }
  const at = matches[0] as number;
  return { comp: comps[at] as CompLike, index: at };
}

export function layerCompGet(params: { name?: string; index?: number }): LayerCompInfo {
  const document = requireActiveDocument();
  const { comp, index } = locate(document, params);
  return describe(comp, index);
}

/** R/W 속성에 직접 넣는다. `add` 의 옵션 모양이 문서에 없기 때문이다. */
function assign(comp: CompLike, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  try {
    comp[key] = value;
  } catch {
    /* 못 넣으면 결과를 읽을 때 드러난다. 여기서 던지면 이미 만들어진 컴프가
     * 남은 채 실패로 보고된다. */
  }
}

export async function layerCompCreate(params: {
  name?: string;
  comment?: string;
  appearance?: boolean;
  position?: boolean;
  visibility?: boolean;
  childComp?: boolean;
}): Promise<LayerCompInfo> {
  return runModal("Create layer comp", async () => {
    const document = requireActiveDocument();
    const comps = collection(document);
    const add = comps["add"];
    if (typeof add !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.layerComps.add 가 없습니다(24.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const before = allComps(document).length;
    /* **옵션을 짐작하지 않는다.** 레퍼런스에 `LayerCompCreateOptions` 의
     * 인터페이스 페이지가 없다 — 빈 객체로 만들고 R/W 속성에 직접 넣는다. */
    const created = (await (add as (options: Record<string, unknown>) => Promise<unknown>).call(
      comps,
      {},
    )) as CompLike | undefined;

    const after = allComps(document);
    if (after.length !== before + 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `레이어 컴프가 늘지 않았습니다(${before} → ${after.length}). layer_comp.list 로 확인하세요.`,
        { recoverable: true },
      );
    }
    const index = after.length - 1;
    const comp = created ?? (after[index] as CompLike);

    assign(comp, "name", params.name);
    assign(comp, "comment", params.comment);
    assign(comp, "appearance", params.appearance);
    assign(comp, "position", params.position);
    assign(comp, "visibility", params.visibility);
    assign(comp, "childComp", params.childComp);

    /* **넣은 값을 다시 읽어 돌려준다.** 요청값을 그대로 되돌려주면 안 들어간
     * 것을 호출자가 알 수 없다. */
    return describe(comp, index);
  });
}

async function call(comp: CompLike, method: string, label: string): Promise<void> {
  const fn = comp[method];
  if (typeof fn !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 의 LayerComp 에 ${method} 가 없습니다(24.0 이상이 필요합니다).`,
      { recoverable: false, details: { method } },
    );
  }
  try {
    await (fn as () => Promise<void>).call(comp);
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `${label} 하지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { method } },
    );
  }
}

/** 저장해 둔 상태를 문서에 건다. */
export async function layerCompApply(params: {
  name?: string;
  index?: number;
}): Promise<LayerCompInfo> {
  return runModal("Apply layer comp", async () => {
    const document = requireActiveDocument();
    const { comp, index } = locate(document, params);
    await call(comp, "apply", "레이어 컴프를 적용");
    return describe(comp, index);
  });
}

/**
 * 지금 문서 상태로 **덮어쓴다.**
 *
 * 저장해 둔 배치가 사라지고 History 말고 되돌릴 길이 없다. 그래서
 * `destructive` 다 — `mask.delete` · `channel.delete` 와 같은 자리다.
 */
export async function layerCompRecapture(params: {
  name?: string;
  index?: number;
}): Promise<LayerCompInfo> {
  return runModal("Recapture layer comp", async () => {
    const document = requireActiveDocument();
    const { comp, index } = locate(document, params);
    await call(comp, "recapture", "레이어 컴프를 다시 기록");
    return describe(comp, index);
  });
}

export async function layerCompDelete(params: { name?: string; index?: number }): Promise<{
  deleted: string;
  remaining: number;
}> {
  return runModal("Delete layer comp", async () => {
    const document = requireActiveDocument();
    const { comp, index } = locate(document, params);
    const info = describe(comp, index);
    const before = allComps(document).length;

    await call(comp, "remove", "레이어 컴프를 삭제");

    /* **지운 뒤 다시 읽어 확인한다.** */
    const after = allComps(document);
    if (after.length !== before - 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `'${info.name}' 이 지워지지 않았습니다(${before} → ${after.length}). layer_comp.list 로 확인하세요.`,
        { recoverable: true, details: { name: info.name } },
      );
    }
    return { deleted: info.name, remaining: after.length };
  });
}
