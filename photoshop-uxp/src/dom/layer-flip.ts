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
 * `LAYER_FLIP` — 레이어를 뒤집는다. (CORE_API §5 P2)
 *
 * ## Tool 이 하나인 이유
 *
 * DOM 이 `flip(axis: FlipAxis)` 하나이고 축이 셋이다(`HORIZONTAL` ·
 * `VERTICAL` · `BOTH`). `flip_horizontal` / `flip_vertical` 둘로 나누면
 * **`both` 를 쓸 수 없고**, `mask.select` · `document.trim` 이 잡아 둔
 * "한 Tool + 축 파라미터" 관례와도 어긋난다.
 *
 * ## 레이어 자기 경계 기준이다 — 재서 알았다
 *
 * 캔버스가 아니라 **레이어의 경계 상자** 안에서 뒤집힌다. 그래서 경계가
 * 그대로다(실기: 40–335 유지). `before` · `after` 를 담되 **"바뀌었으니 성공"
 * 이라고 말하지 않는다** — 경계로는 뒤집혔는지 알 수 없다.
 *
 * 대칭인 원 하나로는 확인이 안 됐다. 빨강 큰 얼룩과 파랑 작은 얼룩을 대각선
 * 으로 두고 `layer.capture` 로 봐서 확인했다.
 *
 * ## 되돌리기는 한 번 더 부르는 것이다
 *
 * 같은 축으로 두 번 뒤집으면 제자리다. 잃는 것이 없어 `edit` 이다.
 */

/** Tool 이름 → `constants.FlipAxis` 의 키. */
const AXIS_KEYS = {
  horizontal: "HORIZONTAL",
  vertical: "VERTICAL",
  both: "BOTH",
} as const;

export type FlipAxisName = keyof typeof AXIS_KEYS;

export interface LayerFlipResult {
  layer: LayerInfo;
  /** 실제로 쓴 축. */
  axis: FlipAxisName;
  /** 뒤집기 전 경계. 못 읽으면 `null`. */
  before: LayerBounds | null;
  /** 뒤집은 뒤 경계. 못 읽으면 `null`. */
  after: LayerBounds | null;
}

function boundsOf(layer: PhotoshopLayer): LayerBounds | null {
  try {
    return toBounds((layer as unknown as Record<string, unknown>)["bounds"]);
  } catch {
    return null;
  }
}

export async function layerFlip(params: {
  layerId?: number;
  axis: FlipAxisName;
}): Promise<LayerFlipResult> {
  return runModal("Flip layer", async () => {
    const document = requireActiveDocument();
    const found =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);

    if (found === undefined || found === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${String(params.layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const layer = found as PhotoshopLayer;
    const flip = (layer as unknown as Record<string, unknown>)["flip"];
    if (typeof flip !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 Layer.flip 이 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    /* **`constants.FlipAxis` 가 없는 호스트가 있다.** Photoshop 27.8 이
     * 그렇다 — 레퍼런스에는 있는데 런타임에 `constants.FlipAxis` 자체가
     * `undefined` 다(ROADMAP §44).
     *
     * 그래서 상수가 있으면 그것을, 없으면 **소문자 축 이름**을 넘긴다.
     * 짐작이 아니라 실기에서 그림으로 확인한 경로다 — `layer.capture` 로
     * 얼룩이 반대편으로 간 것을 봤다. */
    const key = AXIS_KEYS[params.axis];
    const table = constants.FlipAxis as unknown as Record<string, unknown> | undefined;
    const axis = table?.[key] ?? params.axis;

    const before = boundsOf(layer);

    try {
      await (flip as (...args: unknown[]) => Promise<void>).call(layer, axis);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `레이어를 뒤집지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )} 잠긴 레이어일 수 있습니다 — photoshop.layer.get 의 locked 로 확인하세요.`,
        { recoverable: true, details: { axis: params.axis, before } },
      );
    }

    const info = (await withMaskStateAsync([toLayerInfo(layer)]))[0] as LayerInfo;
    return { layer: info, axis: params.axis, before, after: boundsOf(layer) };
  });
}
