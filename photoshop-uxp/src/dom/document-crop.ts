import { action } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { requireActiveDocument } from "./document.js";
import { flattenLayers } from "./layers.js";
import { runModal } from "./modal.js";

/**
 * 문서 자르기. (ROADMAP §17.12)
 *
 * UXP DOM 에 자르기 API 가 없어 batchPlay 를 쓴다. descriptor 는 검증된 파라미터로
 * 이 모듈이 조립한다. (ARCHITECTURE §13, §23)
 *
 * **`delete: false` 가 핵심이다.** 캔버스만 줄이고 바깥 픽셀은 레이어에 남긴다.
 * 이 한 줄이 이 Command 를 `destructive` 가 아니라 `edit` 으로 만든다.
 *
 * ## 배경 레이어는 승격되고 **id 가 바뀐다**
 *
 * 배경은 캔버스 밖에 픽셀을 가질 수 없다. 그래서 바깥을 남기려면 Photoshop 이
 * 일반 레이어로 바꾼다 — 실기에서 id 1 이 id 3(`레이어 0`)이 되었다
 * (ROADMAP §36).
 *
 * **한동안 이 사실을 결과에 담지 않았다.** 호출자가 들고 있던 id 는 사라지는데
 * 아무 말도 하지 않았다. `smart_object.convert` 의 `previousId` · 배경
 * `set_opacity` 의 승격과 같은 유형이다.
 */

interface CropBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function pixels(value: number): { _unit: string; _value: number } {
  return { _unit: "pixelsUnit", _value: value };
}

/** 승격이 일어났을 때 무엇이 무엇으로 바뀌었는지. */
export interface CropPromotion {
  /** 사라진 배경 레이어의 id. */
  previousId: number;
  /** 그 자리에 생긴 일반 레이어. */
  layer: LayerInfo;
}

export async function documentCrop(params: { bounds: CropBounds }): Promise<{
  width: number;
  height: number;
  previousWidth: number;
  previousHeight: number;
  pixelsRetained: boolean;
  promoted: CropPromotion | null;
}> {
  return runModal("Crop document", async () => {
    const document = requireActiveDocument();
    const previousWidth = document.width;
    const previousHeight = document.height;

    /* 변경 **전** 목록을 떠 둔다. 배경이 승격되면 id 가 바뀌는데, 뒤에서
     * 위치로 추정하면 틀린다 — `resolveMutatedLayer` 와 같은 규칙이다. */
    const before = flattenLayers(document.layers);
    const beforeIds = new Set(before.map((entry) => entry.id));
    const backgroundId = before.find((entry) => entry.isBackground === true)?.id ?? null;
    const { left, top, right, bottom } = params.bounds;

    // 캔버스를 넓히는 것은 자르기가 아니다. 조용히 넓혀 주면 잘린 줄 안다.
    if (right > previousWidth || bottom > previousHeight) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `자를 영역이 문서(${previousWidth}×${previousHeight})를 벗어납니다: ` +
          `right ${right}, bottom ${bottom}.`,
        { recoverable: true, details: { previousWidth, previousHeight, bounds: params.bounds } },
      );
    }

    const results = await action.batchPlay(
      [
        {
          _obj: "crop",
          to: {
            _obj: "rectangle",
            top: pixels(top),
            left: pixels(left),
            bottom: pixels(bottom),
            right: pixels(right),
          },
          angle: { _unit: "angleUnit", _value: 0 },
          // 바깥 픽셀을 남긴다. 되돌릴 수 있고 잃는 것이 없다.
          delete: false,
        },
      ],
      {},
    );
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { bounds: params.bounds },
      });
    }

    // **요청한 크기가 아니라 실제 크기를 읽는다.**
    //
    // Photoshop 이 반올림하거나 경계를 조정할 수 있다. 요청값을 그대로 돌려주면
    // 호출자는 맞다고 믿고, 어긋난 것은 한참 뒤에 드러난다.
    const after = requireActiveDocument();

    /* **승격을 짝지을 수 있을 때만 말한다.** 배경이 있었고, 그 id 가 사라졌고,
     * 새 id 가 정확히 하나 생겼을 때다. 하나로 좁혀지지 않으면 `null` 이다 —
     * 짐작한 id 를 주면 호출자가 엉뚱한 레이어를 편집한다. */
    const afterLayers = flattenLayers(after.layers);
    const appeared = afterLayers.filter((entry) => !beforeIds.has(entry.id));
    const gone = backgroundId !== null && !afterLayers.some((entry) => entry.id === backgroundId);
    const promoted =
      gone && appeared.length === 1
        ? { previousId: backgroundId as number, layer: appeared[0] as LayerInfo }
        : null;

    return {
      width: after.width,
      height: after.height,
      previousWidth,
      previousHeight,
      pixelsRetained: true,
      promoted,
    };
  });
}
