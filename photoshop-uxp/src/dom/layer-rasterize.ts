import { constants, type PhotoshopLayer } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers, toLayerInfo } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";

/**
 * `LAYER_RASTERIZE` — 레이어를 픽셀로 굽는다. (CORE_API §5 P2)
 *
 * ## `smart_object.rasterize` 가 아니라 `layer.rasterize` 다
 *
 * CORE_API §5 에는 `photoshop.smart_object.rasterize` 로 올라 있었는데 실제
 * API 는 **`Layer.rasterize(target)`** 이고 스마트 오브젝트만의 일이 아니다 —
 * 텍스트 · 모양 · 레이어 스타일도 같은 메서드로 굽는다. 이름을 옮겼다.
 *
 * ## 되돌릴 수 없다
 *
 * 스마트 오브젝트를 구우면 안의 원본과 스마트 필터가 사라지고, 텍스트를 구우면
 * 글자를 고칠 수 없다. 문서 어디에도 원래 것이 남지 않으므로 `destructive` 다 —
 * History 로는 되돌아가지만 저장하면 끝이다.
 *
 * ## 열 가지 중 여섯만 연다
 *
 * `linkedLayers` · `placed` · `video` · `layerClippingPath` 는 이 서버의 쓰임과
 * 멀다. 안 쓰는 값이 스키마에 있으면 호출자가 무엇이 중요한지 모른다 —
 * `text` 가 자간·행간을 열지 않은 것과 같은 판단이다.
 *
 * ## id 는 바뀌지 않았다 — 그래도 짝짓는다
 *
 * `smart_object.convert` 는 id 를 바꿨는데(스마트 오브젝트로 감쌀 때) **굽기는
 * 바꾸지 않는다.** 실기에서 스마트 오브젝트와 텍스트 둘 다 id 가 유지됐다
 * (ROADMAP §45).
 *
 * 그래도 변경 **전** 목록을 떠 두고 뒤에 짝짓는다. 다른 대상·다른 버전에서
 * 바뀌면 그때 드러나야 하고, 위치나 활성 레이어로 추정하는 것보다 싸다.
 *
 * ## 할 일이 없어도 오류가 아니다
 *
 * 이미 픽셀인 레이어에 걸어도 Photoshop 이 조용히 성공한다. 실패로 만들지
 * 않는다 — `previousType` 이 `pixel` 이면 아무 일도 없었다는 뜻이고, 그것을
 * 호출자가 읽는다. 처음에는 "실패한다" 고 적었다가 재 보고 고쳤다.
 */

/** Tool 이름 → `constants.RasterizeType` 의 키. */
const TARGET_KEYS = {
  entireLayer: "ENTIRELAYER",
  layerStyle: "LAYERSTYLE",
  textContents: "TEXTCONTENTS",
  shape: "SHAPE",
  vectorMask: "VECTORMASK",
  fillContent: "FILLCONTENT",
} as const;

export type RasterizeTargetName = keyof typeof TARGET_KEYS;

export interface LayerRasterizeResult {
  layer: LayerInfo;
  /** 굽기 전 레이어 종류. 무엇이 사라졌는지 여기서 읽는다. */
  previousType: string;
  /** 굽기 전 id. **바뀌었으면 결과의 `layer.id` 를 이어 쓴다.** */
  previousId: number;
  /** 실제로 쓴 대상. */
  target: RasterizeTargetName;
}

export async function layerRasterize(params: {
  layerId?: number;
  target?: RasterizeTargetName;
}): Promise<LayerRasterizeResult> {
  const target = params.target ?? "entireLayer";
  return runModal("Rasterize layer", async () => {
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
    const rasterize = (layer as unknown as Record<string, unknown>)["rasterize"];
    if (typeof rasterize !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 Layer.rasterize 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const key = TARGET_KEYS[target];
    const table = constants.RasterizeType as unknown as Record<string, unknown> | undefined;
    const value = table?.[key];
    if (value === undefined) {
      /* **무엇이 있는지 함께 담는다.** `FlipAxis` 는 표 자체가 없었다
       * (ROADMAP §44) — 없다는 말만으로는 가릴 수 없다. */
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 에서 대상 ${target}(${key}) 를 찾을 수 없습니다.`,
        {
          recoverable: true,
          details: {
            target,
            key,
            hasTable: table !== undefined,
            available: table === undefined ? [] : Object.keys(table),
          },
        },
      );
    }

    const before = toLayerInfo(layer);
    const beforeIds = new Set(flattenLayers(document.layers).map((entry) => entry.id));

    try {
      await (rasterize as (...args: unknown[]) => Promise<void>).call(layer, value);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `레이어를 굽지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )} 이미 픽셀 레이어이거나 이 대상에 해당하는 내용이 없을 수 있습니다 — ` +
          "photoshop.layer.list 의 type 으로 확인하세요.",
        { recoverable: true, details: { target, layerId: before.id } },
      );
    }

    /* **id 가 바뀔 수 있다.** 원래 id 가 남아 있으면 그것을, 아니면 새로 생긴
     * 것을 쓴다. 하나로 좁혀지지 않으면 짐작하지 않는다. */
    const after = flattenLayers(document.layers);
    const same = after.find((entry) => entry.id === before.id);
    const appeared = after.filter((entry) => !beforeIds.has(entry.id));
    const resolved = same ?? (appeared.length === 1 ? appeared[0] : undefined);

    if (resolved === undefined) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "구웠지만 결과 레이어를 확인하지 못했습니다. photoshop.layer.list 로 확인하세요.",
        { recoverable: true, details: { previousId: before.id, target } },
      );
    }

    return {
      layer: (await withMaskStateAsync([resolved]))[0] as LayerInfo,
      previousType: before.type,
      previousId: before.id,
      target,
    };
  });
}
