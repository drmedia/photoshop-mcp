import type { PhotoshopDocument } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument, toDocumentInfo } from "./document.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_BIT_DEPTH_CONVERT` — 채널당 비트 심도를 바꾼다. (CORE_API §5 P2)
 *
 * ## 메서드가 아니라 속성이다
 *
 * `bitsPerChannel` 은 읽기/쓰기 속성이고 **문자열 상수**를 받는다
 * (`"bitDepth16"`). 숫자를 그대로 대입하면 **조용히 무시된다** — `export_tiff`
 * 가 이미 그렇게 쓰고 있고 실기에서 검증된 경로다.
 *
 * 속성 대입이 조용히 무시되는 것은 이 프로젝트에서 반복된 실패 유형이다
 * (배경 `set_opacity` · Camera Raw 정수 · 파라메트릭 곡선). 그래서 **쓰고 나서
 * 읽어 확인하고**, 안 들어갔으면 실패로 답한다.
 *
 * ## 1비트는 열지 않았다
 *
 * `BitsPerChannelType.ONE` 은 Bitmap 색상 모드에서만 뜻이 있다. 그 모드는
 * 대화상자 위험 때문에 `document.mode_convert` 에서도 열지 않았다(§38).
 *
 * ## 내리면 되돌릴 수 없다
 *
 * 16 → 8 은 계조를 버린다. 문서 어디에도 원래 값이 남지 않으므로
 * `destructive` 다 — 천체사진에서 16비트를 지키는 것이 이 프로젝트의 관심사다.
 */

const DEPTH_VALUES = { 8: "bitDepth8", 16: "bitDepth16", 32: "bitDepth32" } as const;

export type BitDepthValue = keyof typeof DEPTH_VALUES;

export interface BitDepthConvertResult {
  document: DocumentInfo;
  /** 바꾸기 전 심도. 못 읽으면 `null`. */
  before: number | null;
  /** 바꾼 뒤 **읽은** 심도. 못 읽으면 `null`. */
  after: number | null;
  /** 요청한 심도가 실제로 들어갔는가. 요청값을 되풀이한 것이 아니다. */
  applied: boolean;
}

/** `bitsPerChannel` 문자열에서 숫자를 뽑는다. `export-tiff` 와 같은 규칙. */
export function depthOf(document: PhotoshopDocument): number | null {
  const match = /^bitDepth(\d+)$/u.exec(String(document.bitsPerChannel));
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

/**
 * 심도를 대입하고 **들어갔는지 읽어서** 돌려준다.
 *
 * `document.create` 와 공유한다. **문자열 상수를 쓴다는 지식이 한 곳에만
 * 있어야 한다** — `documents.add` 가 `bitsPerChannel` 을 조용히 무시한다는
 * 것을 실기에서 확인하고(ROADMAP §39) 생성 쪽도 이 경로로 보냈다.
 */
export function applyBitDepth(document: PhotoshopDocument, depth: BitDepthValue): boolean {
  if (depthOf(document) === depth) {
    return true;
  }
  try {
    document.bitsPerChannel = DEPTH_VALUES[depth] as PhotoshopDocument["bitsPerChannel"];
  } catch {
    return false;
  }
  return depthOf(document) === depth;
}

export async function documentBitDepthConvert(params: {
  depth: BitDepthValue;
}): Promise<BitDepthConvertResult> {
  return runModal("Change bit depth", async () => {
    const document = requireActiveDocument();
    const target = DEPTH_VALUES[params.depth];
    const before = depthOf(document);

    /* 이미 그 심도면 손대지 않는다. 같은 값을 다시 대입해 얻을 것이 없다. */
    if (before === params.depth) {
      return { document: toDocumentInfo(document), before, after: before, applied: true };
    }

    try {
      document.bitsPerChannel = target as PhotoshopDocument["bitsPerChannel"];
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `비트 심도를 바꾸지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { before, requested: params.depth } },
      );
    }

    const after = depthOf(document);

    /* **쓴 값이 실제로 들어갔는지 확인한다.** 대입이 조용히 무시되는 경로가
     * 이 프로젝트에 이미 셋 있었다. 성공으로 보고하면 호출자는 16비트가 된 줄
     * 알고 외부 처리기를 돌린다. */
    if (after !== null && after !== params.depth) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `비트 심도가 적용되지 않았습니다 — 요청 ${params.depth}, 실제 ${after}. ` +
          "Photoshop 이 이 문서의 심도를 바꾸지 않았습니다.",
        { recoverable: true, details: { before, after, requested: params.depth } },
      );
    }

    return {
      document: toDocumentInfo(document),
      before,
      after,
      /* 못 읽었으면 `false` 다. 확인하지 못한 것을 확인했다고 하지 않는다. */
      applied: after === params.depth,
    };
  });
}
