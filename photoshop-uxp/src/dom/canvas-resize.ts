import { constants } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument, toDocumentInfo } from "./document.js";
import { runModal } from "./modal.js";

/**
 * `CANVAS_RESIZE` — 캔버스 크기를 바꾼다. (CORE_API §5 P2)
 *
 * ## `image.resize` 와 다르다
 *
 * `image.resize` 는 **픽셀을 다시 표본화한다** — 그림이 통째로 커지거나 작아진다.
 * 이쪽은 그림은 그대로 두고 **종이 크기만** 바꾼다. 늘리면 빈 자리가 생기고
 * 줄이면 바깥이 캔버스 밖으로 나간다.
 *
 * 생략한 쪽은 **지금 값을 그대로 쓴다.** `image.resize` 에서 한쪽을 생략하면
 * 비율을 맞추는 것과 다르다 — 캔버스에는 맞출 비율이 없다.
 *
 * ## `document.crop` 과도 다르다 — 재서 갈랐다
 *
 * 둘 다 캔버스를 줄이지만 배경 레이어에서 갈린다. 실기에서 빨간 얼룩을 구운
 * 배경으로 같은 왕복(800×600 → 300×200 → 800×600)을 돌렸다.
 *
 * ```text
 * document.crop     배경을 일반 레이어로 승격(id 1→3)  →  green 142.18 그대로
 * canvas.resize     배경을 그대로 자름                 →  green 142.18 → 248.41
 * ```
 *
 * `crop` 의 `delete: false` 가 하는 일이 그 승격이다. 이쪽은 승격시키지 않아
 * **배경의 바깥 픽셀이 사라진다.** 그래서 `crop` 은 `edit` 이고 이쪽은
 * `destructive` 다. 일반 레이어는 양쪽 모두 바깥 픽셀을 유지한다.
 *
 * ## 모르는 기준점은 거절한다
 *
 * `constants.AnchorPosition` 에 없으면 조용히 가운데로 떨어뜨리지 않는다 —
 * `mask.gradient` 가 모르는 `type` 을 `linear` 로 떨어뜨리지 않는 것과 같다.
 * 기준점이 다르면 **어느 쪽이 잘리는지가 달라진다.**
 */

/** Tool 이름 → `constants.AnchorPosition` 의 키. */
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

export type AnchorName = keyof typeof ANCHOR_KEYS;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasResizeResult {
  document: DocumentInfo;
  before: CanvasSize;
  after: CanvasSize;
  /** 요청한 값이 실제로 들어갔는지. 요청하지 않은 것은 담기지 않는다. */
  applied: { width?: boolean; height?: boolean };
  /** 실제로 쓴 기준점. 생략하면 Photoshop 기본값이라 `null` 이다. */
  anchor: AnchorName | null;
}

export async function canvasResize(params: {
  width?: number;
  height?: number;
  anchor?: AnchorName;
}): Promise<CanvasResizeResult> {
  return runModal("Resize canvas", async () => {
    const document = requireActiveDocument();

    const resize = (document as unknown as Record<string, unknown>)["resizeCanvas"];
    if (typeof resize !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.resizeCanvas 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    let anchor: unknown;
    if (params.anchor !== undefined) {
      const key = ANCHOR_KEYS[params.anchor];
      anchor = (constants.AnchorPosition as unknown as Record<string, unknown> | undefined)?.[key];
      if (anchor === undefined) {
        throw new DispatchError(
          "COMMAND_NOT_SUPPORTED",
          `이 Photoshop 에서 기준점 ${params.anchor}(${key}) 를 찾을 수 없습니다.`,
          { recoverable: true, details: { anchor: params.anchor, key } },
        );
      }
    }

    const before: CanvasSize = {
      width: Math.round(document.width),
      height: Math.round(document.height),
    };

    /* **생략한 쪽은 지금 값이다.** `resizeCanvas` 는 둘 다 요구하므로 여기서
     * 채운다 — Photoshop 에게 `undefined` 를 넘겨 무엇이 될지 맡기지 않는다. */
    const width = params.width === undefined ? before.width : Math.round(params.width);
    const height = params.height === undefined ? before.height : Math.round(params.height);

    try {
      await (resize as (...args: unknown[]) => Promise<void>).call(document, width, height, anchor);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `캔버스 크기를 바꾸지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { before, requested: { width, height } } },
      );
    }

    const after: CanvasSize = {
      width: Math.round(document.width),
      height: Math.round(document.height),
    };

    return {
      document: toDocumentInfo(document),
      before,
      after,
      applied: {
        ...(params.width === undefined ? {} : { width: after.width === width }),
        ...(params.height === undefined ? {} : { height: after.height === height }),
      },
      anchor: params.anchor ?? null,
    };
  });
}
