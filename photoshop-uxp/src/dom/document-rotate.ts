import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { runModal } from "./modal.js";

/**
 * 문서 회전. (ROADMAP §17.19)
 *
 * ## DOM 에 API 가 있는지 짐작하지 않았다
 *
 * `document.statistics` 때 `document.histogram` 이 있다고 짐작했으면 없는 API 를
 * 썼을 것이다(§17.13). 그래서 여기서도 DOM 과 batchPlay 두 경로를 모두 준비하고
 * 실기에서 **쟀다.**
 *
 * `Document.rotate` 가 **있었다**(Photoshop 27.8). 그래서 batchPlay 경로는
 * 지웠다 — 한 번도 실행되지 않은 descriptor 를 짐작으로 남겨 두면, 언젠가
 * 그 경로가 처음 실행되는 날 그것이 맞는지 아무도 모른다.
 *
 * `method` 는 남긴다. 무엇으로 했는지는 우리가 아는 사실이고, 경로가 늘면
 * 호출자가 구분해야 한다. (`crop` 의 `pixelsRetained` 와 같은 판단)
 *
 * ## **돌았는지 확인한다**
 *
 * 오류 없이 아무 일도 하지 않는 경로가 이 프로젝트에서 이미 두 번 나왔다 —
 * 배경 레이어 `set_opacity` 와 Camera Raw 의 정수 `$Ex12`. 성공으로 보고하면
 * 호출자는 수평이 맞춰졌다고 믿는다.
 *
 * 각도가 −45~45 이고 0 이 아니면 회전은 캔버스를 **반드시** 키운다. 그래서
 * 기대 크기를 계산해 대조한다. 안 커졌으면 실패다.
 */

/** 회전 뒤 캔버스 크기. Photoshop 은 잘리지 않게 외접 사각형까지 키운다. */
function expectedCanvas(
  width: number,
  height: number,
  angleDegrees: number,
): { width: number; height: number } {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

export async function documentRotate(params: { angle: number }): Promise<{
  width: number;
  height: number;
  previousWidth: number;
  previousHeight: number;
  angle: number;
  method: string;
}> {
  return runModal("Rotate document", async () => {
    const document = requireActiveDocument();
    const previousWidth = document.width;
    const previousHeight = document.height;
    const { angle } = params;

    // 없는 환경이 있으면 짐작해서 우회하지 않고 그 사실을 말하며 실패한다.
    if (typeof document.rotate !== "function") {
      throw new DispatchError(
        "COMMAND_FAILED",
        "이 Photoshop 에는 Document.rotate 가 없습니다. " +
          "Photoshop 27.8 에서는 확인했습니다 — 버전을 알려주시면 다른 경로를 찾겠습니다.",
        { recoverable: false, details: { angle } },
      );
    }
    await document.rotate(angle);
    const method = "dom:Document.rotate";

    // **요청이 아니라 결과를 읽는다.**
    const after = requireActiveDocument();
    const expected = expectedCanvas(previousWidth, previousHeight, angle);

    // 안 커졌으면 아무 일도 일어나지 않은 것이다. 성공으로 보고하면 호출자는
    // 수평이 맞춰졌다고 믿는다. 2px 은 Photoshop 의 반올림 여유다.
    if (
      Math.abs(after.width - expected.width) > 2 ||
      Math.abs(after.height - expected.height) > 2
    ) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `회전 명령은 오류 없이 끝났지만 캔버스가 기대와 다릅니다. ` +
          `${previousWidth}×${previousHeight} 를 ${angle}° 돌리면 ` +
          `${Math.round(expected.width)}×${Math.round(expected.height)} 가 되어야 하는데 ` +
          `${after.width}×${after.height} 입니다. 회전이 적용되지 않았을 수 있습니다.`,
        { details: { angle, method, previousWidth, previousHeight } },
      );
    }

    return {
      width: after.width,
      height: after.height,
      previousWidth,
      previousHeight,
      angle,
      method,
    };
  });
}
