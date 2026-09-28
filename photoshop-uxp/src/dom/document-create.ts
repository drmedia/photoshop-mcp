import { app, type PhotoshopDocument } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { toDocumentInfo } from "./document.js";
import { applyBitDepth, type BitDepthValue } from "./document-bit-depth.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_CREATE` — 새 문서. (CORE_API §5 P1)
 *
 * ## 인자 이름을 짐작하지 않는다
 *
 * `app.documents.add` 가 어떤 키를 받는지 확인된 적이 없다. 그래서 **만든 뒤
 * 읽어서 요청한 값이 실제로 들어갔는지 확인하고 그 결과를 함께 준다.**
 * 배경 레이어 `set_opacity` 가 조용히 무시되던 것을 `opacityApplied` 로
 * 드러낸 것과 같은 방식이다.
 *
 * 무시된 키를 성공으로 보고하면 호출자는 16비트 문서를 받은 줄 알고 8비트에
 * 외부 처리기를 돌린다. 이 프로젝트에서 "조용한 실패" 는 반복된 실패 유형이다.
 *
 * ## 새 문서가 활성이 된다
 *
 * Photoshop 이 만든 문서를 활성으로 삼는다. 그래서 이 Command 뒤의 편집은
 * 대상이 바뀐다 — 결과의 `document.id` 와 `photoshop.document.list` 의
 * `active` 로 확인할 수 있다.
 */

export interface DocumentCreateParams {
  width: number;
  height: number;
  resolution?: number;
  /** `RGB` 또는 `grayscale`. */
  mode?: "RGB" | "grayscale";
  bitDepth?: 8 | 16 | 32;
  /** `white` · `transparent` · `black`. */
  fill?: "white" | "transparent" | "black";
  name?: string;
}

/** 요청한 값이 실제로 들어갔는지. 확인할 수 없는 것은 담지 않는다. */
export interface DocumentCreateApplied {
  width: boolean;
  height: boolean;
  /** 요청하지 않았으면 담기지 않는다. */
  bitDepth?: boolean;
  colorMode?: boolean;
}

export interface DocumentCreateResult {
  document: DocumentInfo;
  applied: DocumentCreateApplied;
}

export async function documentCreate(params: DocumentCreateParams): Promise<DocumentCreateResult> {
  return runModal("Create document", async () => {
    const collection = app.documents as unknown as {
      add?: (options: Record<string, unknown>) => Promise<PhotoshopDocument> | PhotoshopDocument;
    };
    if (typeof collection.add !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 documents.add 가 없어 새 문서를 만들 수 없습니다.",
        { recoverable: false },
      );
    }

    /* **변경 전 id 를 떠 둔다.** `add` 가 문서를 돌려주지 않거나 id 없는
     * 객체를 돌려줄 수 있다 — `duplicate()` 에서 실제로 겪었다.
     * (`duplicated-document.ts`) */
    const before = new Set(toArray<{ id: number }>(app.documents).map((entry) => entry.id));

    const options: Record<string, unknown> = {
      width: params.width,
      height: params.height,
      ...(params.resolution === undefined ? {} : { resolution: params.resolution }),
      /* **`"RGB"` 가 아니라 `"RGBColorMode"` 다.** Adobe UXP 레퍼런스에
       * 그렇게 적혀 있고, 읽는 쪽 `toColorMode` 가 `"rgbcolormode"` 를
       * 받는 것과도 맞는다. 짧은 이름을 보내면 조용히 무시된다. */
      ...(params.mode === undefined
        ? {}
        : { mode: params.mode === "RGB" ? "RGBColorMode" : "GrayscaleMode" }),
      /* **`documents.add` 는 이 키를 조용히 무시한다.** 실기에서 확인했다
       * (ROADMAP §39) — `bitDepth: 16` 을 줘도 8비트 문서가 나오고
       * `applied.bitDepth` 가 `false` 였다. 그래도 함께 보낸다. 다른 버전에서
       * 먹을 수 있고, 먹으면 아래 보정이 그냥 건너뛴다. */
      ...(params.bitDepth === undefined
        ? {}
        : { bitsPerChannel: `bitDepth${String(params.bitDepth)}` }),
      ...(params.fill === undefined ? {} : { fill: params.fill }),
      ...(params.name === undefined ? {} : { name: params.name }),
    };

    let returned: unknown;
    try {
      returned = await collection.add(options);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `새 문서를 만들지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { width: params.width, height: params.height } },
      );
    }

    /* 돌려받은 객체를 믿지 않는다. 새로 생긴 id 로 찾는다. */
    const open = toArray<PhotoshopDocument>(app.documents);
    const returnedId = (returned as { id?: unknown } | null | undefined)?.id;
    const created =
      typeof returnedId === "number" && open.some((entry) => entry.id === returnedId)
        ? open.find((entry) => entry.id === returnedId)
        : open.find((entry) => !before.has(entry.id));

    if (created === undefined) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "문서를 만들었지만 어느 것인지 확인하지 못했습니다. photoshop.document.list 로 확인하세요.",
        { recoverable: true, details: { before: [...before] } },
      );
    }

    /* **만든 뒤에 심도를 맞춘다.** `add` 가 무시하므로 여기서 다시 건다 —
     * 검증된 경로는 `bitsPerChannel` 에 문자열 상수를 넣는 것이고, 그 지식은
     * `document-bit-depth.ts` 한 곳에만 둔다. */
    if (params.bitDepth !== undefined) {
      applyBitDepth(created, params.bitDepth as BitDepthValue);
    }

    const info = toDocumentInfo(created);
    return {
      document: info,
      applied: {
        width: Math.round(info.width) === Math.round(params.width),
        height: Math.round(info.height) === Math.round(params.height),
        ...(params.bitDepth === undefined ? {} : { bitDepth: info.bitDepth === params.bitDepth }),
        ...(params.mode === undefined
          ? {}
          : { colorMode: info.colorMode.toLowerCase() === params.mode.toLowerCase() }),
      },
    };
  });
}
