import { constants, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toBounds, type LayerBounds } from "./layer-get.js";
import { toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_TRANSLATE` · `LAYER_SCALE` · `LAYER_ROTATE` — 레이어 변환. (CORE_API §5)
 *
 * ## 단위는 레퍼런스에 있다
 *
 * 타입 서명만 보면 `number | PercentValue | PixelValue` 라 맨 숫자가 무슨
 * 단위인지 모르겠는데, **레퍼런스의 예제 코드가 답을 준다**(ROADMAP §47).
 *
 * ```text
 * translate(-200, 0)   맨 숫자는 **픽셀**
 * scale(80, 80)        맨 숫자는 **퍼센트**
 * rotate(-90)          맨 숫자는 **도**
 * ```
 *
 * 셋 다 실기에서 경계로 확인했다. **회전 부호는 시계 방향 양수**이고
 * `document.rotate` 와 같다(§17.19).
 *
 * `PercentValue` 는 `{_unit: "percentUnit", _value: 100}` 으로 만든다고
 * 예제에 나오지만 **열지 않았다** — `translate` 를 퍼센트로 주는 쓰임이 이
 * 서버에 없다. 필요해지면 그때 더한다.
 *
 * ## 결과는 경계로 말한다
 *
 * 셋 다 **무엇이 얼마나 움직였는지**가 경계에 드러난다. `before` · `after` 를
 * 함께 주므로 호출자가 요청과 실제를 스스로 견준다 — `flip` 과 달리 여기서는
 * 경계가 실제로 바뀐다.
 *
 * ## 기준점과 보간
 *
 * `scale` · `rotate` 는 `anchor` 를 받는다. `canvas.resize` 가 쓰는 것과 같은
 * `constants.AnchorPosition` 이고 아홉 가지다. 생략하면 Photoshop 기본값이라
 * 결과의 `anchor` 가 `null` 이다.
 *
 * **`options.interpolation` 도 레퍼런스에 있다.** 처음에 "문서화되어 있지 않아
 * 열지 않았다" 고 적을 뻔했는데 **틀렸다** — `InterpolationMethod` 여섯 가지가
 * 적혀 있다. `image.resize` 의 `resample` 과 같은 자리라 열었다.
 */

/** Tool 이름 → `constants.InterpolationMethod` 의 키. */
const INTERPOLATION_KEYS = {
  automatic: "AUTOMATIC",
  bicubic: "BICUBIC",
  bicubicSharper: "BICUBICSHARPER",
  bicubicSmoother: "BICUBICSMOOTHER",
  bilinear: "BILINEAR",
  nearestNeighbor: "NEARESTNEIGHBOR",
} as const;

export type InterpolationName = keyof typeof INTERPOLATION_KEYS;

/** Tool 이름 → `constants.AnchorPosition` 의 키. `canvas.resize` 와 같다. */
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

export type TransformAnchorName = keyof typeof ANCHOR_KEYS;

export interface LayerTransformResult {
  layer: LayerInfo;
  /** 변환 전 경계. 못 읽으면 `null`. */
  before: LayerBounds | null;
  /** 변환 뒤 경계. 못 읽으면 `null`. */
  after: LayerBounds | null;
  /** 실제로 쓴 기준점. 생략했으면 `null`. */
  anchor: TransformAnchorName | null;
}

function boundsOf(layer: PhotoshopLayer): LayerBounds | null {
  try {
    return toBounds((layer as unknown as Record<string, unknown>)["bounds"]);
  } catch {
    return null;
  }
}

/**
 * 상수 표에서 값을 꺼낸다. 없으면 **무엇이 있는지 함께** 담아 거절한다.
 *
 * `FlipAxis` 는 표 자체가 없었다(§44) — 없다는 말만으로는 "상수가 없는 것" 과
 * "이름이 다른 것" 을 가를 수 없다.
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

/** `options.interpolation`. 주지 않으면 `undefined` 라 Photoshop 기본값이다. */
function resolveOptions(name: InterpolationName | undefined): Record<string, unknown> | undefined {
  if (name === undefined) {
    return undefined;
  }
  return {
    interpolation: fromTable(
      constants.InterpolationMethod as unknown as Record<string, unknown> | undefined,
      INTERPOLATION_KEYS[name],
      "보간 방식",
      name,
    ),
  };
}

function resolveAnchor(name: TransformAnchorName | undefined): unknown {
  if (name === undefined) {
    return undefined;
  }
  const key = ANCHOR_KEYS[name];
  const table = constants.AnchorPosition as unknown as Record<string, unknown> | undefined;
  const value = table?.[key];
  if (value === undefined) {
    /* **무엇이 있는지 함께 담는다.** `FlipAxis` 는 표 자체가 없었다(§44). */
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      `이 Photoshop 에서 기준점 ${name}(${key}) 를 찾을 수 없습니다.`,
      {
        recoverable: true,
        details: {
          anchor: name,
          key,
          hasTable: table !== undefined,
          available: table === undefined ? [] : Object.keys(table),
        },
      },
    );
  }
  return value;
}

/** 대상 레이어와 그 메서드를 찾는다. 셋이 같은 준비를 한다. */
async function withLayer(
  label: string,
  method: string,
  layerId: number | undefined,
  call: (layer: PhotoshopLayer, fn: (...args: unknown[]) => Promise<void>) => Promise<void>,
  anchor: TransformAnchorName | undefined,
): Promise<LayerTransformResult> {
  return runModal(label, async () => {
    const document = requireActiveDocument();
    const found =
      layerId === undefined ? document.activeLayers[0] : findLayerById(document.layers, layerId);

    if (found === undefined || found === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${String(layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId } },
      );
    }

    const layer = found as PhotoshopLayer;
    const fn = (layer as unknown as Record<string, unknown>)[method];
    if (typeof fn !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 에는 Layer.${method} 가 없습니다(23.0 이상이 필요합니다).`,
        { recoverable: false },
      );
    }

    const before = boundsOf(layer);

    try {
      await call(layer, fn as (...args: unknown[]) => Promise<void>);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `레이어를 변환하지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )} 잠긴 레이어이거나 배경 레이어일 수 있습니다 — ` +
          "photoshop.layer.get 의 locked · isBackground 로 확인하세요.",
        { recoverable: true, details: { method, before } },
      );
    }

    const info = (await withMaskStateAsync([toLayerInfo(layer)]))[0] as LayerInfo;
    return { layer: info, before, after: boundsOf(layer), anchor: anchor ?? null };
  });
}

/** 가로·세로로 옮긴다. 단위는 **픽셀**이다(실기 확인, ROADMAP §47). */
export async function layerTranslate(params: {
  layerId?: number;
  horizontal?: number;
  vertical?: number;
}): Promise<LayerTransformResult> {
  return withLayer(
    "Translate layer",
    "translate",
    params.layerId,
    async (layer, fn) => {
      await fn.call(layer, params.horizontal ?? 0, params.vertical ?? 0);
    },
    undefined,
  );
}

/** 크기를 바꾼다. 단위는 **퍼센트**다(실기 확인, ROADMAP §47). */
export async function layerScale(params: {
  layerId?: number;
  width: number;
  height: number;
  anchor?: TransformAnchorName;
  interpolation?: InterpolationName;
}): Promise<LayerTransformResult> {
  const anchor = resolveAnchor(params.anchor);
  const options = resolveOptions(params.interpolation);
  return withLayer(
    "Scale layer",
    "scale",
    params.layerId,
    async (layer, fn) => {
      /* **인자를 뒤에서부터 빼지 않는다.** `anchor` 없이 `options` 만 주면
       * 자리가 밀려 엉뚱한 값이 기준점으로 간다. */
      if (options !== undefined) {
        await fn.call(layer, params.width, params.height, anchor, options);
      } else if (anchor !== undefined) {
        await fn.call(layer, params.width, params.height, anchor);
      } else {
        await fn.call(layer, params.width, params.height);
      }
    },
    params.anchor,
  );
}

/** 돌린다. 단위는 **도**이고 부호는 실기에서 확인한다(ROADMAP §47). */
export async function layerRotate(params: {
  layerId?: number;
  angle: number;
  anchor?: TransformAnchorName;
  interpolation?: InterpolationName;
}): Promise<LayerTransformResult> {
  const anchor = resolveAnchor(params.anchor);
  const options = resolveOptions(params.interpolation);
  return withLayer(
    "Rotate layer",
    "rotate",
    params.layerId,
    async (layer, fn) => {
      if (options !== undefined) {
        await fn.call(layer, params.angle, anchor, options);
      } else if (anchor !== undefined) {
        await fn.call(layer, params.angle, anchor);
      } else {
        await fn.call(layer, params.angle);
      }
    },
    params.anchor,
  );
}
