import { imaging } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { toLayerType } from "./mappings.js";
import { findLayerById } from "./layer-edit.js";
import { hasSelection } from "./mask-selection.js";
import { selectionBounds } from "./state-read.js";
import type { Rgb8 } from "./image-compare.js";

/**
 * 재는 도구가 공유하는 픽셀 읽기. (ROADMAP §90 · §91)
 *
 * `document.statistics` · `document.analyze` · `document.compare` 가 **같은 규칙으로 같은 곳을
 * 읽어야** 한다 — 한쪽은 조정 레이어를 막고 다른 쪽은 안 막으면 같은 영역을 재고도 숫자가 달라지거나,
 * 막지 않은 쪽이 마스크 영역을 재서 "이 레이어는 순백" 같은 값을 돌려준다(MEASUREMENT.md §6.3).
 * 그래서 두 번 쓰지 않고 여기 한 곳에 둔다.
 *
 * **수치를 위한 읽기는 전체 해상도다.** `targetSize` 를 주지 않는다 — 축소하면 단일 픽셀 클리핑이
 * 평균에 묻힌다(MEASUREMENT.md §6.5). 축소해서 읽는 `readPreviewRgb8` 은 **그림을 위한 것**이다.
 */

export interface PixelSourceParams {
  region?: "document" | "selection";
  layerId?: number;
  target?: "layer" | "mask";
}

export interface PixelData {
  /** 무엇을 쟀는지. `document` · `selection:l,t,r,b` · `layer:<id>` · `mask:<id>` */
  source: string;
  /** 가로 픽셀 수. 모르면 0 이다 — 그때는 이웃을 알 수 없다. */
  width: number;
  /** 세로 픽셀 수. 폭을 모르면 0 이다. */
  height: number;
  components: number;
  /** 8 또는 16. */
  componentSize: number;
  /** 원래 심도에서의 최대값. 16비트는 65535 가 아니라 **32768** 이다. */
  maxValue: number;
  /** 청키(RGBRGB…) 버퍼. */
  data: { length: number; [index: number]: number };
  /** 실제로 센 픽셀 수. */
  pixels: number;
  /** 버퍼를 놓는다. 반드시 `finally` 에서 부른다. */
  dispose(): void;
}

type ImagingApi = NonNullable<typeof imaging>;

/** 대상을 해석한다: 문서 · 레이어 · 마스크 · 선택. 읽기 전의 모든 검증이 여기 있다. */
function resolveRequest(params: PixelSourceParams): {
  api: ImagingApi;
  request: Record<string, unknown>;
  source: string;
} {
  const api = imaging;
  if (api === undefined || typeof api.getPixels !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 버전에는 Imaging API 가 없어 통계를 낼 수 없습니다.",
      { recoverable: false },
    );
  }

  const document = requireActiveDocument();
  const request: Record<string, unknown> = { documentID: document.id };
  let source = "document";

  if (params.layerId !== undefined) {
    const layer = findLayerById(document.layers, params.layerId);
    if (layer === undefined || layer === null) {
      throw new DispatchError("LAYER_NOT_FOUND", `레이어 ${params.layerId} 를 찾을 수 없습니다.`, {
        recoverable: true,
        details: { layerId: params.layerId },
      });
    }
    /* **마스크를 잴 때는 조정 레이어를 막지 않는다.** 조정 레이어는 자기
     * 픽셀이 없어 막아 둔 것인데, 마스크는 있다. 광도 마스크가 의도한
     * 구조를 담았는지 확인하는 유일한 길이다. */
    if (params.target === "mask") {
      if (typeof api.getLayerMask !== "function") {
        throw new DispatchError(
          "COMMAND_NOT_SUPPORTED",
          "이 Photoshop 의 Imaging API 에 getLayerMask 가 없어 마스크를 읽을 수 없습니다.",
          { recoverable: false },
        );
      }
      request["layerID"] = layer.id;
      source = `mask:${String(layer.id)}`;
    } else {
      // **조정 레이어와 그룹은 막는다.**
      //
      // 실기에서 조정 레이어를 재 보니 모든 채널 평균이 255 로 나왔다. 픽셀이
      // 아니라 마스크 영역을 잰 것이다. 숫자 자체는 돌아오므로 호출자는 "이
      // 레이어는 순백" 이라고 읽는다 — 아무 값도 안 주는 것보다 나쁘다.
      const kind = toLayerType(layer.kind).type;
      if (kind === "adjustment" || kind === "group") {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `${kind === "group" ? "그룹" : "조정 레이어"}에는 잴 픽셀이 없습니다. ` +
            "layerId 를 빼면 조정이 반영된 합성 결과를 잽니다.",
          { recoverable: true, details: { layerId: layer.id, type: kind } },
        );
      }

      request["layerID"] = layer.id;
      source = `layer:${layer.id}`;
    }
  }

  if (params.region === "selection") {
    if (!hasSelection()) {
      throw new DispatchError("INVALID_PARAMETER", "잴 선택 영역이 없습니다.", {
        recoverable: true,
      });
    }
    const bounds = selectionBounds();
    if (bounds === null) {
      throw new DispatchError("COMMAND_FAILED", "선택 영역의 경계를 읽지 못했습니다.", {
        recoverable: true,
      });
    }
    request["sourceBounds"] = bounds;
    source = `selection:${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
  }

  return { api, request, source };
}

/** 요청을 해석해 픽셀을 읽는다. 호출자는 `runModal` 안에서 부르고 `dispose()` 를 맡는다. */
export async function readPixels(params: PixelSourceParams): Promise<PixelData> {
  const { api, request, source } = resolveRequest(params);

  // **targetSize 를 주지 않는다.** 축소하면 클리핑이 사라진다.
  let pixelData;
  try {
    pixelData =
      params.target === "mask"
        ? await (api.getLayerMask as NonNullable<typeof api.getLayerMask>)(request)
        : await api.getPixels(request);
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `픽셀을 읽지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { source } },
    );
  }

  const dispose = (): void => {
    pixelData.imageData?.dispose?.();
  };

  try {
    const raw = pixelData.imageData as {
      componentSize?: number;
      components?: number;
      width?: number;
      height?: number;
      getData?: (options?: unknown) => Promise<ArrayBufferView>;
    };
    if (typeof raw.getData !== "function") {
      throw new DispatchError("COMMAND_NOT_SUPPORTED", "픽셀 버퍼를 읽을 수 없습니다.", {
        recoverable: false,
      });
    }

    const componentSize = raw.componentSize ?? 8;
    const components = raw.components ?? 3;
    // 16비트 문서의 최대값은 32768 이다. 65535 로 두면 모든 값이 절반으로 보인다.
    const maxValue = componentSize > 8 ? 32768 : 255;

    const data = (await raw.getData({ chunky: true })) as unknown as {
      length: number;
      [index: number]: number;
    };
    const pixels = Math.floor(data.length / components);
    const width = raw.width ?? 0;
    return {
      source,
      width,
      // 폭을 모르면 이웃이 누구인지 알 수 없다 — 높이도 모른다.
      height: width > 0 ? Math.floor(pixels / width) : 0,
      components,
      componentSize,
      maxValue,
      data,
      pixels,
      dispose,
    };
  } catch (error) {
    // 읽기에 실패하면 호출자가 `dispose` 를 받을 수 없으므로 여기서 놓는다.
    dispose();
    throw error;
  }
}

/**
 * **그림을 위한** 읽기. 목표 크기로 축소해 8비트 RGB 로 돌려준다.
 *
 * 수치를 내는 데 쓰지 않는다 — 축소한 미리보기라 단일 픽셀 클리핑이 묻힌다.
 * 16비트는 직접 8비트로 낮춘다(`capture.ts` 와 같은 이유: `componentSize: 8` 을 주는 길은
 * 16비트 문서에서 `-32005` 로 막혀 있고, 인코더는 8비트만 받는다).
 */
export async function readPreviewRgb8(
  params: PixelSourceParams,
  size: { width: number; height: number },
): Promise<{ rgb: Rgb8; source: string }> {
  const { api, request, source } = resolveRequest(params);
  let pixelData;
  try {
    pixelData = await api.getPixels({ ...request, targetSize: size });
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `미리보기를 읽지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { source } },
    );
  }
  try {
    const raw = pixelData.imageData as {
      componentSize?: number;
      components?: number;
      width?: number;
      height?: number;
      getData?: (options?: unknown) => Promise<ArrayBufferView>;
    };
    if (typeof raw.getData !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 의 Imaging API 에 getData 가 없어 미리보기를 8비트로 바꿀 수 없습니다.",
        { recoverable: false },
      );
    }
    const wideBits = raw.componentSize ?? 8;
    const components = raw.components ?? 3;
    const wide = (await raw.getData({ chunky: true })) as unknown as {
      length: number;
      [index: number]: number;
    };
    const width = raw.width ?? size.width;
    const height = raw.height ?? size.height;
    const pixels = Math.floor(wide.length / components);
    const data = new Uint8Array(pixels * 3);
    // Photoshop 의 16비트는 0–65535 가 아니라 0–32768 이다.
    const scale = wideBits > 8 ? 255 / 32768 : 1;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = Math.round((wide[pixel * components + channel] as number) * scale);
        data[pixel * 3 + channel] = value > 255 ? 255 : value < 0 ? 0 : value;
      }
    }
    return { rgb: { data, width, height }, source };
  } finally {
    pixelData.imageData?.dispose?.();
  }
}
