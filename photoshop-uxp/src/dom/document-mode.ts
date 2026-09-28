import { constants } from "photoshop";
import type { DocumentInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument, toDocumentInfo } from "./document.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * `DOCUMENT_MODE_CONVERT` — 색상 모드를 바꾼다. (CORE_API §5 P2)
 *
 * ## 넷만 연다
 *
 * `ChangeMode` 에는 일곱 가지가 있지만 **`BITMAP` · `INDEXEDCOLOR` ·
 * `MULTICHANNEL` 은 내놓지 않았다.**
 *
 * 앞의 둘은 Photoshop UI 에서 설정 대화상자를 띄우고, 레이어가 있으면 평탄화
 * 여부까지 묻는다. **대화상자가 뜨면 플러그인이 멈추고 Bridge 가 15초에
 * 타임아웃한다** — 이 프로젝트에서 네 번 반복된 실패 유형이다(§17.11 · §17.25 ·
 * §17.26 · §17.34). `options` 로 피할 수 있을지도 모르지만 **실기에서 뜨지 않는
 * 것을 확인하기 전에는 열지 않는다.** `MULTICHANNEL` 은 채널만 남기는 출력용
 * 모드라 이 서버의 쓰임과 멀다.
 *
 * ## 되돌릴 수 없다
 *
 * RGB → Grayscale 은 색을 영영 버린다. RGB → CMYK 는 색역 밖을 잘라낸다.
 * 문서 어디에도 원래 값이 남지 않으므로 `destructive` 다 — `image.resize` 가
 * 해상도를 버리는 것과 같은 자리다.
 *
 * ## 레이어는 살아남았다 — 그래도 세어서 답한다
 *
 * 실기에서 네 모드를 모두 돌렸고 **레이어가 하나도 사라지지 않았다**(2 → 2).
 * 대화상자도 뜨지 않았다. 그래도 `layersDiscarded` 를 **읽어서** 담는다 —
 * 다른 버전·다른 문서에서 평탄화될 수 있고, 그때 조용히 지나가면 호출자는
 * 레이어가 남아 있다고 믿는다. `document.flatten` 의 `hiddenDiscarded` 와 같다.
 */

/** Tool 이름 → `constants.ChangeMode` 의 키. */
const MODE_KEYS = {
  rgb: "RGB",
  grayscale: "GRAYSCALE",
  cmyk: "CMYK",
  lab: "LAB",
} as const;

export type ColorModeName = keyof typeof MODE_KEYS;

/** `toColorMode` 가 돌려주는 표시 이름. 비교에 쓴다. */
const EXPECTED_LABEL: Record<ColorModeName, string> = {
  rgb: "RGB",
  grayscale: "Grayscale",
  cmyk: "CMYK",
  lab: "Lab",
};

export interface ModeConvertResult {
  document: DocumentInfo;
  before: { mode: string; layers: number };
  after: { mode: string; layers: number };
  /** 요청한 모드가 실제로 되었는가. 요청값을 되풀이한 것이 아니다. */
  applied: boolean;
  /** 변환 중 사라진 레이어 수. 평탄화되면 0 이 아니다. */
  layersDiscarded: number;
}

function layerCount(document: unknown): number {
  try {
    return toArray<unknown>((document as { layers?: unknown }).layers).length;
  } catch {
    return 0;
  }
}

export async function documentModeConvert(params: {
  mode: ColorModeName;
}): Promise<ModeConvertResult> {
  return runModal("Change mode", async () => {
    const document = requireActiveDocument();

    const change = (document as unknown as Record<string, unknown>)["changeMode"];
    if (typeof change !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 에는 document.changeMode 가 없습니다(23.0 이상이 필요합니다).",
        { recoverable: false },
      );
    }

    const key = MODE_KEYS[params.mode];
    const target = (constants.ChangeMode as unknown as Record<string, unknown> | undefined)?.[key];
    if (target === undefined) {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `이 Photoshop 에서 색상 모드 ${params.mode}(${key}) 를 찾을 수 없습니다.`,
        { recoverable: true, details: { mode: params.mode, key } },
      );
    }

    const before = { mode: toDocumentInfo(document).colorMode, layers: layerCount(document) };

    /* **이미 그 모드면 아무것도 하지 않는다.** 같은 모드로 한 번 더 부르면
     * Photoshop 이 평탄화만 하고 끝날 수 있다 — 얻는 것 없이 레이어를 잃는다. */
    if (before.mode === EXPECTED_LABEL[params.mode]) {
      return {
        document: toDocumentInfo(document),
        before,
        after: { ...before },
        applied: true,
        layersDiscarded: 0,
      };
    }

    try {
      await (change as (...args: unknown[]) => Promise<void>).call(document, target);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `색상 모드를 바꾸지 못했습니다: ${String(
          (error as { message?: unknown })?.message ?? error,
        )}`,
        { recoverable: true, details: { before, requested: params.mode } },
      );
    }

    const info = toDocumentInfo(document);
    const after = { mode: info.colorMode, layers: layerCount(document) };

    return {
      document: info,
      before,
      after,
      /* **읽어서 비교한다.** 요청을 되풀이하면 무시된 변환이 성공으로 나간다 —
       * 이 프로젝트의 "조용한 실패" 를 막는 자리다. */
      applied: after.mode === EXPECTED_LABEL[params.mode],
      layersDiscarded: Math.max(0, before.layers - after.layers),
    };
  });
}
