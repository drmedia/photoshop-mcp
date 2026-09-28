import { constants, type PhotoshopDocument } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument, toDocumentInfo } from "./document.js";
import { runModal } from "./modal.js";

/**
 * `IMAGE_RESIZE` — 이미지 크기를 바꾼다. (CORE_API §5 P1)
 *
 * ## `document.crop` 과 다르다
 *
 * `crop` 은 캔버스만 줄이고 **픽셀을 레이어에 남긴다** — 그래서 `edit` 이다.
 * 이쪽은 픽셀을 다시 표본화한다. 줄이면 버려진 해상도가 문서 어디에도 남지
 * 않는다. 그래서 **`destructive`** 다. `mask.apply` · `flatten` 과 같은 종류다.
 *
 * ## DOM 에 있다 — 짐작하지 않았다
 *
 * Adobe UXP 레퍼런스에 `resizeImage(width?, height?, resolution?, resampleMethod?,
 * amount?)` 가 있다(23.0+). batchPlay 를 쓰지 않는다. (ARCHITECTURE §13)
 *
 * ## 한쪽만 주면 어떻게 되는지 **지어내지 않았다 — 재 봤다**
 *
 * 비율을 유지하는지 레퍼런스가 말하지 않는다. 실기에서 확인했다.
 *
 * ```text
 * 4000×2500  width 2000            →  2000×1250   비율 유지
 * 1920×1200  width 800 height 800  →  800×800     비율 무시, 왜곡
 * 2000×1250 300ppi  resolution 72  →  480×300     픽셀도 함께 줄었다
 * ```
 *
 * **마지막 줄이 예상 밖이었다.** `resolution` 만 바꾸면 DPI 메타데이터만
 * 고쳐질 것 같지만, 인쇄 크기를 유지한 채 다시 표본화해서 픽셀이 0.24배가
 * 된다. 이 Command 가 `destructive` 인 이유를 가장 잘 보여주는 경우다.
 *
 * 그래도 `before` · `after` 를 함께 준다 — 호출자가 무엇이 일어났는지 스스로
 * 본다. `document.create` 의 `applied` 와 같은 방식이다.
 *
 * ## 모르는 리샘플 방식은 거절한다
 *
 * `constants.ResampleMethod` 에 없으면 조용히 기본값으로 떨어뜨리지 않는다 —
 * `mask.gradient` 가 모르는 `type` 을 `linear` 로 떨어뜨리지 않는 것과 같다.
 */

/** Tool 이름 → `constants.ResampleMethod` 의 키. */
const RESAMPLE_KEYS = {
  automatic: "AUTOMATIC",
  bicubic: "BICUBIC",
  bicubicSharper: "BICUBICSHARPER",
  bicubicSmoother: "BICUBICSMOOTHER",
  bilinear: "BILINEAR",
  nearestNeighbor: "NEARESTNEIGHBOR",
  preserveDetails: "PRESERVEDETAILS",
  deepUpscale: "DEEPUPSCALE",
} as const;

export type ResampleName = keyof typeof RESAMPLE_KEYS;

export interface ImageSize {
  width: number;
  height: number;
  /** 못 읽으면 `null`. 0 으로 채우지 않는다. */
  resolution: number | null;
}

export interface ImageResizeResult {
  document: DocumentInfo;
  before: ImageSize;
  after: ImageSize;
  /** 요청한 값이 실제로 들어갔는지. 요청하지 않은 것은 담기지 않는다. */
  applied: { width?: boolean; height?: boolean; resolution?: boolean };
}

function sizeOf(document: PhotoshopDocument): ImageSize {
  const raw = (document as unknown as Record<string, unknown>)["resolution"];
  return {
    width: Math.round(document.width),
    height: Math.round(document.height),
    resolution: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
  };
}

export async function imageResize(params: {
  width?: number;
  height?: number;
  resolution?: number;
  resample?: ResampleName;
}): Promise<ImageResizeResult> {
  return runModal("Resize image", async () => {
    const document = requireActiveDocument();

    const resize = (document as unknown as Record<string, unknown>)["resizeImage"];
    if (typeof resize !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.resizeImage 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    /* **모르는 값은 거절한다.** 조용히 기본 보간으로 떨어뜨리면 호출자가
     * preserveDetails 로 키운 줄 알고 결과를 받는다. */
    let method: unknown;
    if (params.resample !== undefined) {
      const key = RESAMPLE_KEYS[params.resample];
      method = (constants.ResampleMethod as unknown as Record<string, unknown> | undefined)?.[key];
      if (method === undefined) {
        throw new DispatchError(
          "COMMAND_NOT_SUPPORTED",
          `이 Photoshop 에서 리샘플 방식 ${params.resample}(${key}) 를 찾을 수 없습니다.`,
          { recoverable: true, details: { resample: params.resample, key } },
        );
      }
    }

    const before = sizeOf(document);

    try {
      await (resize as (...args: unknown[]) => Promise<void>).call(
        document,
        params.width,
        params.height,
        params.resolution,
        method,
      );
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `크기를 바꾸지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { before, requested: params } },
      );
    }

    const after = sizeOf(document);
    return {
      document: toDocumentInfo(document),
      before,
      after,
      applied: {
        ...(params.width === undefined ? {} : { width: after.width === Math.round(params.width) }),
        ...(params.height === undefined
          ? {}
          : { height: after.height === Math.round(params.height) }),
        /* 해상도는 소수로 저장될 수 있다. 정확히 비교하면 오탐이 난다 —
         * 배경 `set_opacity` 의 `opacityApplied` 와 같은 자리다. */
        ...(params.resolution === undefined
          ? {}
          : {
              resolution:
                after.resolution !== null && Math.abs(after.resolution - params.resolution) < 0.5,
            }),
      },
    };
  });
}
