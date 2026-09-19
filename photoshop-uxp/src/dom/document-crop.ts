import { action } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * 문서 자르기. (ROADMAP §17.12)
 *
 * UXP DOM 에 자르기 API 가 없어 batchPlay 를 쓴다. descriptor 는 검증된 파라미터로
 * 이 모듈이 조립한다. (ARCHITECTURE §13, §23)
 *
 * **`delete: false` 가 핵심이다.** 캔버스만 줄이고 바깥 픽셀은 레이어에 남긴다.
 * 이 한 줄이 이 Command 를 `destructive` 가 아니라 `edit` 으로 만든다.
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

export async function documentCrop(params: { bounds: CropBounds }): Promise<{
  width: number;
  height: number;
  previousWidth: number;
  previousHeight: number;
  pixelsRetained: boolean;
}> {
  return runModal("Crop document", async () => {
    const document = requireActiveDocument();
    const previousWidth = document.width;
    const previousHeight = document.height;
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
    return {
      width: after.width,
      height: after.height,
      previousWidth,
      previousHeight,
      pixelsRetained: true,
    };
  });
}
