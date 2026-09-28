import { constants } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";
import { solidColor } from "./text.js";

/**
 * 패스. (ROADMAP §58)
 *
 * ## 전부 DOM 이다
 *
 * `document.pathItems`(23.3+) 컬렉션과 `PathItem` 클래스(`makeSelection` ·
 * `fillPath` · `strokePath` · `select` · `deselect` · `remove` · `duplicate`)
 * 로 다 된다. batchPlay 를 쓰지 않는다.
 *
 * ## `create` 는 선택 영역에서 만든다
 *
 * `pathItems.add(name, entirePath: SubPathInfo[])` 는 **베지어 기하를
 * 요구하고 `SubPathInfo` 의 인터페이스 문서가 없다.** 좌표를 지어내 넘기면
 * 무엇이 만들어질지 모른다.
 *
 * 대신 `Selection.makeWorkPath(tolerance)` 로 **현재 선택에서** 만든다 —
 * 이 저장소에는 `selection.sky` · `subject` · `polygon` · `color_range` 처럼
 * 좋은 선택을 만드는 길이 이미 많다. 그쪽에서 받아 오는 것이 자연스럽다.
 *
 * `to_selection` 이 반대 방향이라 둘이 왕복한다.
 */

export interface PathInfo {
  /** `document.pathItems` 에서의 위치. */
  index: number;
  /** batchPlay 용 id. 못 읽으면 `null`. */
  id: number | null;
  name: string;
  /** `PathKind`. 문자열로 읽히지 않으면 `null` 이고 `rawKind` 에 원본이 있다. */
  kind: string | null;
  rawKind?: string;
  /** 하위 패스 개수. 못 읽으면 `null`. */
  subPathCount: number | null;
}

type PathLike = Record<string, unknown>;

function read<T>(item: PathLike, key: string, guard: (value: unknown) => value is T): T | null {
  try {
    const value = item[key];
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";

function collection(document: ReturnType<typeof requireActiveDocument>): PathLike {
  const items = (document as unknown as PathLike)["pathItems"] as PathLike | undefined;
  if (items === undefined || items === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 document.pathItems 가 없습니다(23.3 이상이 필요합니다).",
      { recoverable: false },
    );
  }
  return items;
}

function allPaths(document: ReturnType<typeof requireActiveDocument>): PathLike[] {
  const items = collection(document);
  const length = items["length"];
  if (typeof length !== "number") {
    throw new DispatchError("COMMAND_FAILED", "패스 개수를 읽지 못했습니다.", {
      recoverable: true,
    });
  }
  const out: PathLike[] = [];
  for (let i = 0; i < length; i += 1) {
    const entry = (items as unknown as Record<number, PathLike>)[i];
    if (entry !== undefined && entry !== null) {
      out.push(entry);
    }
  }
  return out;
}

function describe(item: PathLike, index: number): PathInfo {
  const kindRaw = (() => {
    try {
      return item["kind"];
    } catch {
      return undefined;
    }
  })();
  const subPaths = (() => {
    try {
      const value = item["subPathItems"] as PathLike | undefined;
      const length = value?.["length"];
      return typeof length === "number" ? length : null;
    } catch {
      return null;
    }
  })();

  const info: PathInfo = {
    index,
    id: read(item, "id", isNumber),
    name: read(item, "name", isString) ?? `패스 ${index}`,
    kind: typeof kindRaw === "string" ? kindRaw : null,
    subPathCount: subPaths,
  };
  if (info.kind === null && kindRaw !== undefined && kindRaw !== null) {
    info.rawKind = String(kindRaw);
  }
  return info;
}

export function pathList(): { paths: PathInfo[] } {
  const document = requireActiveDocument();
  return { paths: allPaths(document).map((entry, index) => describe(entry, index)) };
}

/**
 * 이름 또는 색인으로 하나를 찾는다.
 *
 * **이름이 유일하지 않다.** `getByName` 이 "the **first** PathItem matching"
 * 이라고 적혀 있다 — 여럿이면 거절하고 색인을 쓰라고 말한다. (레이어 컴프와
 * 같은 규칙, §57)
 */
function locate(
  document: ReturnType<typeof requireActiveDocument>,
  params: { name?: string; index?: number },
): { item: PathLike; index: number } {
  const items = allPaths(document);
  if (params.index !== undefined) {
    const found = items[params.index];
    if (found === undefined) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `패스 색인 ${params.index} 가 범위를 벗어납니다. 패스는 ${items.length}개입니다.`,
        { recoverable: true, details: { index: params.index, count: items.length } },
      );
    }
    return { item: found, index: params.index };
  }

  const matches: number[] = [];
  items.forEach((entry, index) => {
    if (read(entry, "name", isString) === params.name) {
      matches.push(index);
    }
  });
  if (matches.length === 0) {
    throw new DispatchError("INVALID_PARAMETER", `패스 '${String(params.name)}' 이 없습니다.`, {
      recoverable: true,
      details: {
        name: params.name,
        available: items.map((entry, index) => read(entry, "name", isString) ?? `#${index}`),
      },
    });
  }
  if (matches.length > 1) {
    throw new DispatchError(
      "INVALID_PARAMETER",
      `패스 '${String(params.name)}' 이 ${matches.length}개입니다. index 로 고르세요.`,
      { recoverable: true, details: { name: params.name, indexes: matches } },
    );
  }
  const at = matches[0] as number;
  return { item: items[at] as PathLike, index: at };
}

export function pathGet(params: { name?: string; index?: number }): PathInfo {
  const document = requireActiveDocument();
  const { item, index } = locate(document, params);
  return describe(item, index);
}

/** 상수 표에서 값을 꺼낸다. 없으면 **무엇이 있는지 함께** 담아 거절한다. */
function fromTable(table: unknown, key: string, label: string): unknown {
  const bag = table as Record<string, unknown> | undefined;
  const value = bag?.[key];
  if (value === undefined) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 에서 ${label} ${key} 를 찾을 수 없습니다.`,
      {
        recoverable: true,
        details: {
          key,
          hasTable: bag !== undefined,
          available: bag === undefined ? [] : Object.keys(bag),
        },
      },
    );
  }
  return value;
}

/**
 * 현재 선택 영역에서 패스를 만든다.
 *
 * `Selection.makeWorkPath(tolerance)` 다. **작업 패스(Work Path)가 만들어지고**
 * `name` 을 주면 그 이름으로 바꾼다 — Photoshop 에서 작업 패스에 이름을 주면
 * 저장된 패스가 된다.
 *
 * `tolerance` 는 곡선을 얼마나 단순화할지다. 작을수록 원본 선택에 가깝고
 * 점이 많아진다. 레퍼런스 기본값은 2 다.
 */
export async function pathCreate(params: { name?: string; tolerance?: number }): Promise<PathInfo> {
  return runModal("Make work path", async () => {
    const document = requireActiveDocument();

    /* **선택이 없으면 할 일이 없다.** Photoshop 이 무엇을 만들지 알 수 없다. */
    if (!hasSelection()) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "선택 영역이 없습니다. photoshop.selection.* 로 먼저 선택하세요.",
        { recoverable: true },
      );
    }

    const selection = (document as unknown as PathLike)["selection"] as PathLike | undefined;
    const make = selection?.["makeWorkPath"];
    if (typeof make !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 의 Selection 에 makeWorkPath 가 없습니다(25.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const before = allPaths(document).length;
    await (make as (tolerance: number) => Promise<unknown>).call(selection, params.tolerance ?? 2);

    const after = allPaths(document);
    if (after.length !== before + 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `패스가 늘지 않았습니다(${before} → ${after.length}). path.list 로 확인하세요.`,
        { recoverable: true },
      );
    }
    const index = after.length - 1;
    const item = after[index] as PathLike;
    if (params.name !== undefined) {
      try {
        item["name"] = params.name;
      } catch {
        /* 못 넣으면 결과를 읽을 때 드러난다. */
      }
    }
    return describe(item, index);
  });
}

async function call(
  item: PathLike,
  method: string,
  label: string,
  args: readonly unknown[] = [],
): Promise<void> {
  const fn = item[method];
  if (typeof fn !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 의 PathItem 에 ${method} 가 없습니다(23.3 이상이 필요합니다).`,
      { recoverable: false, details: { method } },
    );
  }
  try {
    await (fn as (...a: unknown[]) => Promise<void>).call(item, ...args);
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `${label} 하지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { method } },
    );
  }
}

export async function pathSelect(params: {
  name?: string;
  index?: number;
  selected?: boolean;
}): Promise<PathInfo> {
  return runModal("Select path", async () => {
    const document = requireActiveDocument();
    const { item, index } = locate(document, params);
    const wanted = params.selected ?? true;
    await call(item, wanted ? "select" : "deselect", wanted ? "패스를 선택" : "패스 선택을 해제");
    return describe(item, index);
  });
}

/** `SelectionType` 네 가지. `selection.polygon` 과 같은 이름을 쓴다. */
const MODE_KEYS = {
  replace: "REPLACE",
  add: "EXTEND",
  subtract: "DIMINISH",
  intersect: "INTERSECT",
} as const;

export type PathSelectionMode = keyof typeof MODE_KEYS;

export async function pathToSelection(params: {
  name?: string;
  index?: number;
  feather?: number;
  antiAlias?: boolean;
  mode?: PathSelectionMode;
}): Promise<{ path: PathInfo; hasSelection: boolean }> {
  return runModal("Path to selection", async () => {
    const document = requireActiveDocument();
    const { item, index } = locate(document, params);
    const mode =
      params.mode === undefined
        ? undefined
        : fromTable(constants.SelectionType, MODE_KEYS[params.mode], "선택 모드");

    await call(item, "makeSelection", "패스를 선택 영역으로", [
      params.feather ?? 0,
      params.antiAlias ?? true,
      ...(mode === undefined ? [] : [mode]),
    ]);
    return { path: describe(item, index), hasSelection: hasSelection() };
  });
}

/**
 * 패스 안을 색으로 채운다.
 *
 * `fillPath(fillColor, mode, opacity, preserveTransparency, feather,
 * wholePath, antiAlias)` 다. **혼합 모드(`mode`)는 열지 않았다** — 색과
 * 불투명도로 충분하고, 모드까지 열면 `constants.BlendMode` 매핑이 하나 더
 * 필요해진다. 필요해지면 그때 더한다.
 *
 * **활성 레이어에 칠해진다.** 조정 레이어나 그룹이 활성이면 Photoshop 이
 * 거절한다 — 픽셀 레이어를 먼저 고른다.
 */
export async function pathFill(params: {
  name?: string;
  index?: number;
  color: { red: number; green: number; blue: number };
  opacity?: number;
  feather?: number;
  antiAlias?: boolean;
  wholePath?: boolean;
  preserveTransparency?: boolean;
}): Promise<PathInfo> {
  return runModal("Fill path", async () => {
    const document = requireActiveDocument();
    const { item, index } = locate(document, params);
    await call(item, "fillPath", "패스를 채우기", [
      solidColor(params.color),
      undefined,
      params.opacity ?? 100,
      params.preserveTransparency ?? false,
      params.feather ?? 0,
      params.wholePath ?? true,
      params.antiAlias ?? true,
    ]);
    return describe(item, index);
  });
}

/** `ToolType` — 레퍼런스에 있는 열여섯 중 선을 그리는 데 쓰는 것들. */
const TOOL_KEYS = {
  brush: "BRUSH",
  pencil: "PENCIL",
  eraser: "ERASER",
  cloneStamp: "CLONESTAMP",
  healingBrush: "HEALINGBRUSH",
  historyBrush: "HISTORYBRUSH",
  artHistoryBrush: "ARTHISTORYBRUSH",
  patternStamp: "PATTERNSTAMP",
  backgroundEraser: "BACKGROUNDERASER",
  blur: "BLUR",
  sharpen: "SHARPEN",
  smudge: "SMUDGE",
  dodge: "DODGE",
  burn: "BURN",
  sponge: "SPONGE",
  colorReplacement: "COLORREPLACEMENTTOOL",
} as const;

export type PathStrokeTool = keyof typeof TOOL_KEYS;

/**
 * 패스를 따라 선을 긋는다.
 *
 * **굵기와 색은 그 도구의 현재 설정을 따른다.** `strokePath` 에 그것을 주는
 * 인자가 없다 — Photoshop 의 브러시 패널 값이 쓰인다. 호출자가 굵기를 정할 수
 * 없다는 뜻이고, 그래서 결과를 재서 확인해야 한다.
 */
export async function pathStroke(params: {
  name?: string;
  index?: number;
  tool?: PathStrokeTool;
  simulatePressure?: boolean;
}): Promise<PathInfo> {
  return runModal("Stroke path", async () => {
    const document = requireActiveDocument();
    const { item, index } = locate(document, params);
    const tool = fromTable(constants.ToolType, TOOL_KEYS[params.tool ?? "brush"], "도구");
    await call(item, "strokePath", "패스를 따라 긋기", [tool, params.simulatePressure ?? false]);
    return describe(item, index);
  });
}

export async function pathDelete(params: { name?: string; index?: number }): Promise<{
  deleted: string;
  remaining: number;
}> {
  return runModal("Delete path", async () => {
    const document = requireActiveDocument();
    const { item, index } = locate(document, params);
    const info = describe(item, index);
    const before = allPaths(document).length;

    await call(item, "remove", "패스를 삭제");

    const after = allPaths(document);
    if (after.length !== before - 1) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `'${info.name}' 이 지워지지 않았습니다(${before} → ${after.length}). path.list 로 확인하세요.`,
        { recoverable: true, details: { name: info.name } },
      );
    }
    return { deleted: info.name, remaining: after.length };
  });
}
