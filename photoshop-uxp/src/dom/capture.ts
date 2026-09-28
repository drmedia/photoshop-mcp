import { imaging } from "photoshop";
import type { CapturedImage } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { hasSelection } from "./mask-selection.js";
import { runModal } from "./modal.js";
import { selectionBounds } from "./state-read.js";

/**
 * 화면 캡처. (ROADMAP §17.10)
 *
 * ## 왜 필요한가
 *
 * 호출자가 **자기 편집 결과를 볼 수 없었다.** 보정 열 단계를 다 쌓은 뒤 내보내기로
 * 확인하고 나서야 하늘이 보라색이 된 것을 발견한 적이 있다. 중간에 한 번만 봤으면
 * 두 번째 단계에서 잡았을 일이다.
 *
 * `document.export` 로도 볼 수는 있지만 무겁다 — 6000×4000 원본을 디스크에 쓰고,
 * `external` 권한과 승인된 작업 폴더가 필요하다. 확인하려고 파일을 만드는 것은
 * 본말이 뒤집힌 것이다.
 *
 * ## `imaging` 을 쓴다
 *
 * UXP 의 Imaging API 는 **축소한 픽셀을 메모리로** 준다. 파일도, 폴더 승인도,
 * 쓰기 권한도 필요 없다. 그래서 권한이 `read` 다.
 *
 * ## `-32005` 는 modal 때문이 아니다
 *
 * `-32005 선택 영역을 저장할 수 없습니다` 를 처음 봤을 때 modal 충돌로 짐작했다.
 * 아니었다 — 원인은 `getPixels({componentSize: 8})` 이다. 다른 Command 와 똑같이
 * `runModal` 안에서 돌며 실기에서 확인했다.
 *
 * 짐작한 원인을 적어 두면 다음에 그 자리를 다시 보지 않게 된다.
 *
 * ## 크게 보내지 않는다
 *
 * 원본 해상도는 볼 필요가 없다. 구도·색·노출 판단에는 긴 변 1024px 이면 충분하고
 * 그보다 크면 토큰만 먹는다. 상한을 2048 로 둔다.
 */

const DEFAULT_LONG_EDGE = 1024;

/** `imaging` 이 없는 UXP 버전이 있을 수 있다. 없으면 무엇이 문제인지 말해 준다. */
function requireImaging(): NonNullable<typeof imaging> {
  if (imaging === undefined || typeof imaging.getPixels !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 버전에는 Imaging API 가 없어 캡처할 수 없습니다. " +
        "document.export 로 파일을 내보내 확인하세요.",
      { recoverable: false },
    );
  }
  return imaging;
}

/** 긴 변을 기준으로 목표 크기를 정한다. 비율은 유지한다. */
function fitLongEdge(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 };
  }
  const scale = longEdge / Math.max(width, height);
  if (scale >= 1) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

interface CaptureOptions {
  longEdge?: number;
  /** jpeg 는 작고 빠르다. png 는 정확하지만 크다. */
  format?: "jpeg" | "png";
  quality?: number;
  /** `mask` 면 레이어의 픽셀이 아니라 **레이어 마스크**를 읽는다. */
  target?: "layer" | "mask";
}

async function encode(
  options: CaptureOptions,
  source: string,
  request: Record<string, unknown>,
  targetSize: { width: number; height: number },
): Promise<CapturedImage> {
  const api = requireImaging();

  /* **마스크는 `getPixels` 가 주지 않는다.** 전용 함수가 따로 있고 UXP 버전에
   * 따라 없을 수 있다. 없으면 무엇이 없는지 말한다 — 짐작한 API 를 부르고
   * 원문 오류만 올리면 다음 사람이 같은 자리를 다시 판다. */
  const wantsMask = options.target === "mask";
  if (wantsMask && typeof api.getLayerMask !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 의 Imaging API 에 getLayerMask 가 없어 마스크를 읽을 수 없습니다.",
      { recoverable: false, details: { source } },
    );
  }

  let imageData;
  try {
    imageData = wantsMask
      ? await (api.getLayerMask as NonNullable<typeof api.getLayerMask>)({
          ...request,
          targetSize,
        })
      : await api.getPixels({ ...request, targetSize });
  } catch (error) {
    throw new DispatchError(
      "COMMAND_FAILED",
      `캡처하지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
      { recoverable: true, details: { source } },
    );
  }

  // **8비트로 낮춰서 인코딩한다.**
  //
  // `encodeImageData` 는 8비트만 받는다 (`Only 8 bit image data can be encoded as
  // jpeg`). `format: "png"` 을 줘도 같은 오류가 나므로 그 옵션은 무시되는 듯하다.
  //
  // `getPixels` 에 `componentSize: 8` 을 주는 길은 막혀 있다 — 16비트 문서에서
  // `-32005 선택 영역을 저장할 수 없습니다` 로 거부한다. targetSize 유무와 무관하다.
  //
  // 그래서 받은 픽셀을 **직접 8비트로 낮춘 뒤** 새 ImageData 로 감싼다.
  // 이 프로젝트는 천체사진을 다뤄 16비트가 기본이므로 이 경로가 흔한 쪽이다.
  let source8 = imageData.imageData;
  let converted: { dispose?: () => void } | undefined;
  try {
    const raw = imageData.imageData as {
      componentSize?: number;
      components?: number;
      width?: number;
      height?: number;
      colorSpace?: unknown;
      getData?: (options?: unknown) => Promise<ArrayBufferView>;
    };

    const wideBits = raw.componentSize ?? 8;
    const components = raw.components ?? 3;
    // jpeg 는 알파를 받지 않는다 (`Image data with alpha cannot be encoded as jpeg`).
    // 미리보기에 알파는 의미가 없으므로 RGB 세 채널만 남긴다.
    const dropAlpha = components > 3;

    /* **변환이 필요한데 읽을 수 없으면 실패한다.** 조용히 건너뛰면 16비트
     * 데이터가 그대로 인코더로 가고, 그때 나오는 것은 오류가 아니라 **절반
     * 밝기의 그림**이다 — 호출자는 그것을 보고 노출을 판단한다.
     *
     * `document.statistics` · `measure.tilt` 는 같은 자리에서 이미 실패한다.
     * 셋이 달랐던 것을 맞췄다. (ROADMAP §30) */
    const needsNarrowing = wideBits > 8 || dropAlpha;
    if (needsNarrowing && typeof raw.getData !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 의 Imaging API 에 getData 가 없어 ${String(wideBits)}비트 픽셀을 ` +
          "미리보기로 변환할 수 없습니다. 변환 없이 인코딩하면 밝기가 어긋난 그림이 나옵니다.",
        { recoverable: false, details: { componentSize: wideBits, components } },
      );
    }

    if (needsNarrowing && typeof raw.getData === "function") {
      const data = await raw.getData({ chunky: true });
      const wide = data as unknown as { length: number; [index: number]: number };
      const pixels = Math.floor(wide.length / components);
      const narrow = new Uint8Array(pixels * 3);
      // **Photoshop 의 16비트는 0–65535 가 아니라 0–32768 이다.**
      // `>> 8` 로 낮췄더니 최대 128 이 되어 딱 절반 밝기로 나왔다. 실기에서
      // 캡처가 원본보다 어두운 것을 보고 알았다.
      const scale = wideBits > 8 ? 255 / 32768 : 1;
      const narrowOf = (value: number): number => {
        const scaled = Math.round(value * scale);
        return scaled > 255 ? 255 : scaled < 0 ? 0 : scaled;
      };
      for (let pixel = 0; pixel < pixels; pixel += 1) {
        const from = pixel * components;
        const to = pixel * 3;
        narrow[to] = narrowOf(wide[from] as number);
        narrow[to + 1] = narrowOf(wide[from + 1] as number);
        narrow[to + 2] = narrowOf(wide[from + 2] as number);
      }
      converted = await api.createImageDataFromBuffer?.(narrow, {
        width: raw.width ?? targetSize.width,
        height: raw.height ?? targetSize.height,
        components: 3,
        componentSize: 8,
        chunky: true,
        colorSpace: "RGB",
      });
      if (converted !== undefined) {
        source8 = converted;
      }
    }

    const base64 = await api.encodeImageData({
      imageData: source8,
      base64: true,
      format: "jpeg",
      quality: options.quality ?? 80,
    });
    return {
      kind: "image",
      mimeType: "image/jpeg",
      base64: String(base64),
      width: targetSize.width,
      height: targetSize.height,
      source,
    };
  } finally {
    converted?.dispose?.();
    // 픽셀 버퍼는 직접 해제해야 한다. 안 하면 큰 문서에서 메모리가 쌓인다.
    imageData.imageData?.dispose?.();
  }
}

/** 문서 전체를 합성해서 캡처한다. 보이는 레이어가 모두 반영된다. */
export async function captureDocument(options: CaptureOptions = {}): Promise<CapturedImage> {
  return runModal("Capture document", async () => {
    const document = requireActiveDocument();
    const target = fitLongEdge(
      document.width,
      document.height,
      options.longEdge ?? DEFAULT_LONG_EDGE,
    );
    return encode(options, `document:${document.name}`, { documentID: document.id }, target);
  });
}

/** 레이어 하나만 캡처한다. 다른 레이어는 반영되지 않는다. */
export async function captureLayer(
  params: { layerId?: number; target?: "layer" | "mask" } & CaptureOptions,
): Promise<CapturedImage> {
  return runModal("Capture layer", async () => {
    const document = requireActiveDocument();
    const layer =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (layer === undefined || layer === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }
    const target = fitLongEdge(
      document.width,
      document.height,
      params.longEdge ?? DEFAULT_LONG_EDGE,
    );
    return encode(
      params,
      params.target === "mask" ? `mask:${layer.id}` : `layer:${layer.id}`,
      { documentID: document.id, layerID: layer.id },
      target,
    );
  });
}

/**
 * 선택 영역을 캡처한다.
 *
 * **경계 상자를 찍는다.** 선택의 정확한 모양이 아니라 그것을 감싸는 사각형이다 —
 * 하늘 선택처럼 모양이 복잡하면 전경 일부도 함께 들어온다.
 */
export async function captureSelection(options: CaptureOptions = {}): Promise<CapturedImage> {
  return runModal("Capture selection", async () => {
    const document = requireActiveDocument();
    if (!hasSelection()) {
      throw new DispatchError("INVALID_PARAMETER", "캡처할 선택 영역이 없습니다.", {
        recoverable: true,
      });
    }
    const bounds = selectionBounds();
    if (bounds === null) {
      throw new DispatchError("COMMAND_FAILED", "선택 영역의 경계를 읽지 못했습니다.", {
        recoverable: true,
      });
    }
    const target = fitLongEdge(
      bounds.right - bounds.left,
      bounds.bottom - bounds.top,
      options.longEdge ?? DEFAULT_LONG_EDGE,
    );
    return encode(
      options,
      `selection:${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`,
      { documentID: document.id, sourceBounds: bounds },
      target,
    );
  });
}
