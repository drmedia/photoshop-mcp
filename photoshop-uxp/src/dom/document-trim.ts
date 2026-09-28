import { constants } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument, toDocumentInfo } from "./document.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_TRIM` — 둘레의 여백을 잘라낸다. (CORE_API §5)
 *
 * ## `crop` · `canvas.resize` 와 무엇이 다른가
 *
 * 셋 다 캔버스를 줄이지만 **무엇을 남길지 정하는 주체가 다르다.**
 *
 * ```text
 * document.crop     호출자가 좌표로 정한다
 * canvas.resize     호출자가 크기와 기준점으로 정한다
 * document.trim     Photoshop 이 픽셀을 보고 정한다
 * ```
 *
 * 그래서 이것은 **얼마나 잘릴지 미리 알 수 없다.** 결과의 `before` · `after` 로
 * 확인한다.
 *
 * ## 캔버스 밖 픽셀을 남기지 않는다 — `canvas.resize` 와 다르다
 *
 * 실기에서 잰 것이다(ROADMAP §37).
 *
 * ```text
 * canvas.resize   일반 레이어의 캔버스 밖 픽셀을 남긴다 (배경만 잘린다)
 * document.trim   일반 레이어도 잘린다
 * ```
 *
 * **숨긴 레이어가 가장 위험하다.** 보이는 것만으로 자를 범위가 정해지므로,
 * 숨긴 레이어에 그 밖의 내용이 있으면 조용히 사라진다 — 숨긴 얼룩이 통째로
 * 없어져 `bounds` 가 0 이 되는 것을 확인했다. `document.flatten` 이 숨긴
 * 레이어를 버리는 것과 같은 종류의 놀라움이고, 그래서 `destructive` 다.
 *
 * ## 자를 것이 없으면 오류가 아니다
 *
 * 여백이 없으면 크기가 그대로다. 실패로 만들지 않고 `changed: false` 로 말한다 —
 * `layer.reorder` 가 맨 위에서 `moved: false` 를 주는 것과 같다. 다만 성공만
 * 돌려주고 끝내지는 않는다. 그러면 호출자가 잘렸다고 믿는다.
 */

/** Tool 이름 → `constants.TrimType` 의 키. */
const TRIM_KEYS = {
  transparent: "TRANSPARENT",
  topLeft: "TOPLEFT",
  bottomRight: "BOTTOMRIGHT",
} as const;

export type TrimModeName = keyof typeof TRIM_KEYS;

export interface TrimSize {
  width: number;
  height: number;
}

export interface DocumentTrimResult {
  document: DocumentInfo;
  before: TrimSize;
  after: TrimSize;
  /** 가로·세로로 얼마나 줄었는지. 어느 쪽이 잘렸는지는 알 수 없다. */
  removed: TrimSize;
  /** 실제로 잘렸는가. 자를 것이 없으면 `false` 이고 오류가 아니다. */
  changed: boolean;
  /** 실제로 쓴 기준. */
  mode: TrimModeName;
}

export async function documentTrim(params: {
  mode: TrimModeName;
  top?: boolean;
  left?: boolean;
  bottom?: boolean;
  right?: boolean;
}): Promise<DocumentTrimResult> {
  return runModal("Trim document", async () => {
    const document = requireActiveDocument();

    const trim = (document as unknown as Record<string, unknown>)["trim"];
    if (typeof trim !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.trim 이 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const key = TRIM_KEYS[params.mode];
    const trimType = (constants.TrimType as unknown as Record<string, unknown> | undefined)?.[key];
    if (trimType === undefined) {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 에서 기준 ${params.mode}(${key}) 를 찾을 수 없습니다.`,
        { recoverable: true, details: { mode: params.mode, key } },
      );
    }

    /* **한 면이라도 지정하면 네 면을 모두 명시한다.** 나머지를 `undefined` 로
     * 두면 Photoshop 이 무엇을 기본으로 삼는지에 결과가 달라진다 — 하나만 끄려던
     * 호출이 조용히 다른 면까지 자를 수 있다. 아무것도 안 주면 기본값에 맡긴다. */
    const anySide =
      params.top !== undefined ||
      params.left !== undefined ||
      params.bottom !== undefined ||
      params.right !== undefined;

    const before: TrimSize = {
      width: Math.round(document.width),
      height: Math.round(document.height),
    };

    try {
      if (anySide) {
        await (trim as (...args: unknown[]) => Promise<void>).call(
          document,
          trimType,
          params.top ?? true,
          params.left ?? true,
          params.bottom ?? true,
          params.right ?? true,
        );
      } else {
        await (trim as (...args: unknown[]) => Promise<void>).call(document, trimType);
      }
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `여백을 잘라내지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { before, mode: params.mode } },
      );
    }

    const after: TrimSize = {
      width: Math.round(document.width),
      height: Math.round(document.height),
    };

    return {
      document: toDocumentInfo(document),
      before,
      after,
      removed: { width: before.width - after.width, height: before.height - after.height },
      changed: after.width !== before.width || after.height !== before.height,
      mode: params.mode,
    };
  });
}
