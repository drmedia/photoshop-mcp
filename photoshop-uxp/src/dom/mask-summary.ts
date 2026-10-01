import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { summarizeMask, type MaskCoverage } from "./mask-coverage.js";
import { withMaskStateAsync } from "./mask-state.js";
import { runModal } from "./modal.js";
import { readPixels } from "./pixel-source.js";

/**
 * 마스크 요약. (ROADMAP §97)
 *
 * 마스크의 흑·백 비율, 효과가 닿는 경계 상자, 위치별 강도를 준다. 계산은 `mask-coverage.ts` 의 순수
 * 함수가 한다.
 *
 * ## 문서 좌표로 읽는다
 *
 * `getLayerMask` 에 범위를 주지 않으면 **마스크 자신의 범위**가 온다. §95 에서 레이어 5 의 마스크가
 * 문서(4024×6048)보다 큰 6510×6051 로 나왔다 — 그 좌표로 경계 상자를 내면 문서의 어디인지 알 수 없다.
 * `pixel-source.ts` 가 마스크를 캔버스 범위로 읽고(모든 마스크 분석이 같은 영역을 잰다), 여기서는
 * **돌아온 크기가 캔버스와 다르면 계산하지 않고 실패한다.** 크기가 다른 배열로 문서 좌표인 척 경계
 * 상자를 내는 것이 가장 나쁜 실패다.
 */
export interface MaskSummaryResult extends MaskCoverage {
  layer: LayerInfo;
  /** 무엇을 쟀는지. `mask:<id>` */
  source: string;
  elapsedMs: number;
}

export async function maskSummary(params: {
  layerId?: number;
  grid?: number;
}): Promise<MaskSummaryResult> {
  return runModal("Mask summary", async () => {
    const started = Date.now();
    const document = requireActiveDocument();
    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${String(params.layerId)} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const info = flattenLayers(document.layers).find((entry) => entry.id === target.id);
    if (info === undefined) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        `레이어 ${String(target.id)} 를 목록에서 찾지 못했습니다.`,
        { recoverable: true, details: { layerId: target.id } },
      );
    }
    const layer = (await withMaskStateAsync([info]))[0] as LayerInfo;

    /* 마스크가 없는 레이어는 거절한다. 없는 마스크를 "전부 보임" 으로 요약하면 호출자는 마스크가 있고
     * 효과가 전체에 걸린 것으로 읽는다. */
    if (layer.hasMask !== true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${String(layer.id)} 에는 마스크가 없습니다.`,
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    const pixels = await readPixels({ layerId: layer.id, target: "mask" });
    try {
      if (pixels.width !== document.width || pixels.height !== document.height) {
        throw new DispatchError(
          "COMMAND_FAILED",
          `마스크를 문서 크기(${String(document.width)}×${String(document.height)})로 읽지 못했습니다 ` +
            `(받은 크기 ${String(pixels.width)}×${String(pixels.height)}). ` +
            "다른 크기의 배열로는 문서 좌표의 경계 상자를 낼 수 없습니다.",
          {
            recoverable: false,
            details: {
              expected: { width: document.width, height: document.height },
              received: { width: pixels.width, height: pixels.height },
            },
          },
        );
      }
      const coverage = summarizeMask(
        {
          data: pixels.data,
          width: pixels.width,
          height: pixels.height,
          components: pixels.components,
          maxValue: pixels.maxValue,
        },
        params.grid ?? 8,
      );
      return { layer, source: pixels.source, elapsedMs: Date.now() - started, ...coverage };
    } finally {
      pixels.dispose();
    }
  });
}
