import { constants } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";
import { selectionBounds } from "./state-read.js";

/**
 * DOM `Selection` 을 쓰는 선택 조작. (CORE_API §5)
 *
 * ## 이 저장소에서 처음으로 DOM Selection 을 쓴다
 *
 * 기존 선택 Command 는 전부 batchPlay 다(`selection-ops.ts` · `gap-tools.ts`).
 * 그때는 DOM 에 없었기 때문이 아니라 **확인하지 않았기 때문**이다 — Adobe
 * 레퍼런스에 `Selection` 클래스가 있고 스물두 개 멤버가 적혀 있다.
 *
 * **클래스 전체가 25.0 부터다.** `document.selection` 이 없거나 메서드가 없으면
 * 거절한다 — 짐작해서 batchPlay 로 우회하지 않는다.
 *
 * ## 이름을 레퍼런스에 맞춘다
 *
 * `scaleBoundary` 가 아니라 **`resizeBoundary`** 다. Tool 이름은 `scale_boundary`
 * 로 두되(호출자에게는 `layer.scale` 과 짝이 맞는 쪽이 읽기 쉽다) **무엇을
 * 부르는지는 주석에 남긴다.**
 *
 * ## 경계 변형은 픽셀을 건드리지 않는다
 *
 * "Does not affect the active layer" — 레퍼런스가 그렇게 적는다. 선택 자체만
 * 움직이므로 `edit` 이고, `layer.scale` 이 `destructive` 인 것과 갈린다.
 */

export interface SelectionResult {
  hasSelection: boolean;
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

export interface SelectionBoundaryResult extends SelectionResult {
  /** 변형 전 경계. 무엇이 얼마나 움직였는지 견줄 수 있어야 한다. */
  before: { left: number; top: number; right: number; bottom: number } | null;
  /** 실제로 쓴 기준점. 생략했으면 `null`. */
  anchor: AnchorName | null;
}

/** `canvas.resize` · `layer.scale` 과 같은 아홉 가지. */
const ANCHOR_KEYS = {
  topLeft: "TOPLEFT",
  topCenter: "TOPCENTER",
  topRight: "TOPRIGHT",
  middleLeft: "MIDDLELEFT",
  middleCenter: "MIDDLECENTER",
  middleRight: "MIDDLERIGHT",
  bottomLeft: "BOTTOMLEFT",
  bottomCenter: "BOTTOMCENTER",
  bottomRight: "BOTTOMRIGHT",
} as const;

/** `layer.scale` · `layer.rotate` 와 같은 여섯 가지. */
const INTERPOLATION_KEYS = {
  automatic: "AUTOMATIC",
  bicubic: "BICUBIC",
  bicubicSharper: "BICUBICSHARPER",
  bicubicSmoother: "BICUBICSMOOTHER",
  bilinear: "BILINEAR",
  nearestNeighbor: "NEARESTNEIGHBOR",
} as const;

export type AnchorName = keyof typeof ANCHOR_KEYS;
export type InterpolationName = keyof typeof INTERPOLATION_KEYS;

/** `mode` 는 새 선택·더하기·빼기·교집합. */
const MODE_KEYS = {
  replace: "REPLACE",
  add: "EXTEND",
  subtract: "DIMINISH",
  intersect: "INTERSECT",
} as const;

export type SelectionModeName = keyof typeof MODE_KEYS;

/**
 * 상수 표에서 값을 꺼낸다. 없으면 **무엇이 있는지 함께** 담아 거절한다.
 *
 * `constants.FlipAxis` 는 레퍼런스에 있는데 27.8 런타임에 표 자체가 없었다
 * (ROADMAP §44). 없다는 말만으로는 "상수가 없는 것" 과 "이름이 다른 것" 을
 * 가를 수 없다.
 */
function fromTable(
  table: Record<string, unknown> | undefined,
  key: string,
  label: string,
  name: string,
): unknown {
  const value = table?.[key];
  if (value === undefined) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 에서 ${label} ${name}(${key}) 를 찾을 수 없습니다.`,
      {
        recoverable: true,
        details: {
          name,
          key,
          hasTable: table !== undefined,
          available: table === undefined ? [] : Object.keys(table),
        },
      },
    );
  }
  return value;
}

const anchorOf = (name: AnchorName | undefined): unknown =>
  name === undefined
    ? undefined
    : fromTable(
        constants.AnchorPosition as unknown as Record<string, unknown> | undefined,
        ANCHOR_KEYS[name],
        "기준점",
        name,
      );

const interpolationOf = (name: InterpolationName | undefined): unknown =>
  name === undefined
    ? undefined
    : fromTable(
        constants.InterpolationMethod as unknown as Record<string, unknown> | undefined,
        INTERPOLATION_KEYS[name],
        "보간 방식",
        name,
      );

const modeOf = (name: SelectionModeName | undefined): unknown =>
  name === undefined
    ? undefined
    : fromTable(
        constants.SelectionType as unknown as Record<string, unknown> | undefined,
        MODE_KEYS[name],
        "선택 모드",
        name,
      );

/** `document.selection` 과 그 메서드를 확인하고 돌려준다. */
function requireSelectionApi(method: string): Record<string, unknown> {
  const document = requireActiveDocument();
  const selection = (document as unknown as Record<string, unknown>)["selection"] as
    Record<string, unknown> | undefined;
  if (selection === undefined || selection === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 document.selection 이 없습니다(25.0 이상이 필요합니다).",
      { recoverable: false },
    );
  }
  if (typeof selection[method] !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 의 Selection 에 ${method} 가 없습니다(25.0 이상이 필요합니다).`,
      { recoverable: false, details: { available: Object.keys(selection) } },
    );
  }
  return selection;
}

function describe(): SelectionResult {
  const has = hasSelection();
  return { hasSelection: has, bounds: has ? selectionBounds() : null };
}

/** 경계 변형 셋이 같은 준비와 같은 결과를 쓴다. */
async function withBoundary(
  label: string,
  method: string,
  anchor: AnchorName | undefined,
  call: (
    selection: Record<string, unknown>,
    fn: (...args: unknown[]) => Promise<void>,
  ) => Promise<void>,
): Promise<SelectionBoundaryResult> {
  return runModal(label, async () => {
    const selection = requireSelectionApi(method);

    /* **선택이 없으면 할 일이 없다.** Photoshop 이 무엇을 하는지 알 수 없고,
     * 되든 안 되든 호출자가 얻는 것이 없다. */
    if (!hasSelection()) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "선택 영역이 없습니다. photoshop.selection.* 로 먼저 선택하세요.",
        { recoverable: true },
      );
    }

    const before = selectionBounds();

    try {
      await call(selection, selection[method] as (...args: unknown[]) => Promise<void>);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `선택 경계를 바꾸지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { method, before } },
      );
    }

    return { ...describe(), before, anchor: anchor ?? null };
  });
}

/** 선택 경계를 옮긴다. 단위는 픽셀이다. */
export async function selectionTranslateBoundary(params: {
  deltaX?: number;
  deltaY?: number;
}): Promise<SelectionBoundaryResult> {
  return withBoundary(
    "Translate selection boundary",
    "translateBoundary",
    undefined,
    async (s, fn) => {
      await fn.call(s, params.deltaX ?? 0, params.deltaY ?? 0);
    },
  );
}

/**
 * 선택 경계 크기를 바꾼다. **DOM 이름은 `resizeBoundary` 다.**
 *
 * `horizontal` · `vertical` 은 퍼센트이고 기본값이 100 이다 — `layer.scale` 과
 * 같은 단위다.
 */
export async function selectionScaleBoundary(params: {
  horizontal?: number;
  vertical?: number;
  anchor?: AnchorName;
  interpolation?: InterpolationName;
}): Promise<SelectionBoundaryResult> {
  const anchor = anchorOf(params.anchor);
  const interpolation = interpolationOf(params.interpolation);
  return withBoundary(
    "Resize selection boundary",
    "resizeBoundary",
    params.anchor,
    async (s, fn) => {
      /* **인자를 뒤에서부터 빼지 않는다.** 자리가 밀리면 엉뚱한 값이 기준점으로
       * 간다 — `layer.scale` 에서 같은 자리를 이미 다뤘다. */
      const h = params.horizontal ?? 100;
      const v = params.vertical ?? 100;
      if (interpolation !== undefined) {
        await fn.call(s, h, v, anchor, interpolation);
      } else if (anchor !== undefined) {
        await fn.call(s, h, v, anchor);
      } else {
        await fn.call(s, h, v);
      }
    },
  );
}

/** 선택 경계를 돌린다. **레퍼런스가 "clockwise" 라고 명시한다.** */
export async function selectionRotateBoundary(params: {
  angle: number;
  anchor?: AnchorName;
  interpolation?: InterpolationName;
}): Promise<SelectionBoundaryResult> {
  const anchor = anchorOf(params.anchor);
  const interpolation = interpolationOf(params.interpolation);
  return withBoundary(
    "Rotate selection boundary",
    "rotateBoundary",
    params.anchor,
    async (s, fn) => {
      if (interpolation !== undefined) {
        await fn.call(s, params.angle, anchor, interpolation);
      } else if (anchor !== undefined) {
        await fn.call(s, params.angle, anchor);
      } else {
        await fn.call(s, params.angle);
      }
    },
  );
}

/**
 * 다각형으로 선택한다.
 *
 * **`selection.set` 의 사각형·타원으로는 만들 수 없는 모양**이다. 하늘과
 * 지상의 경계처럼 꺾인 선을 따라가야 할 때 쓴다.
 *
 * 점이 셋 미만이면 면적이 없다 — 미리 막는다. Photoshop 은 이유를 말해 주지
 * 않는다.
 */
export async function selectionPolygon(params: {
  points: { x: number; y: number }[];
  mode?: SelectionModeName;
  feather?: number;
  antiAlias?: boolean;
}): Promise<SelectionResult> {
  const mode = modeOf(params.mode);
  return runModal("Select polygon", async () => {
    const selection = requireSelectionApi("selectPolygon");

    if (params.points.length < 3) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `점이 ${String(params.points.length)}개라 면적이 없습니다. 셋 이상이 필요합니다.`,
        { recoverable: true, details: { points: params.points.length } },
      );
    }

    const fn = selection["selectPolygon"] as (...args: unknown[]) => Promise<void>;
    try {
      await fn.call(selection, params.points, mode, params.feather ?? 0, params.antiAlias ?? true);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `다각형을 선택하지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { points: params.points.length } },
      );
    }

    return describe();
  });
}
