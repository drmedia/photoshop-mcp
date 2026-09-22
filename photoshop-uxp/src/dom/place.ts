import { action, app, constants, type PhotoshopLayer } from "photoshop";
import type { Folder } from "uxp";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { describeLayer } from "./layer-edit.js";
import { runModal } from "./modal.js";
import { fileSystem, requireWorkspace } from "./workspace.js";

/**
 * `LAYER_PLACE` — 파일을 스마트 오브젝트 레이어로 가져온다.
 *
 * UXP DOM 에 place API 가 없어 batchPlay 를 쓴다. (ARCHITECTURE §13)
 * descriptor 는 검증된 파라미터로 이 모듈이 조립한다. 호출자는 파일 이름만 준다.
 * (ARCHITECTURE §23.2)
 *
 * `save` 와 마찬가지로 경로 문자열이 아니라 **세션 토큰**을 넘겨야 한다.
 * 경로를 그대로 주면 `invalid file token used` 가 난다. (ROADMAP §8.5)
 */

/** 승인된 폴더에서 파일 항목을 찾는다. */
async function findFile(folder: Folder, filename: string): Promise<unknown> {
  const entries = await folder.getEntries();
  const target = filename.toLowerCase();
  const found = entries.find((entry) => entry.name.toLowerCase() === target);

  if (found === undefined) {
    throw new DispatchError("FILE_NOT_FOUND", `승인된 작업 폴더에 파일이 없습니다: ${filename}`, {
      recoverable: true,
      details: { filename },
    });
  }
  if (!found.isFile) {
    throw new DispatchError("INVALID_PARAMETER", `파일이 아니라 폴더입니다: ${filename}`, {
      recoverable: true,
      details: { filename },
    });
  }
  return found;
}

/**
 * 가져온 레이어를 픽셀로 굽는다.
 *
 * **스마트 오브젝트로 두면 얻는 것이 없는 경우가 있다.** 외부 처리기가 구워
 * 돌려준 결과가 그렇다 — 더블클릭해도 그 처리기가 다시 돌지 않고 구워진 파일이
 * 열릴 뿐이다. 마스크·블렌딩에는 픽셀이 편하고 파일도 작다.
 *
 * **상수를 얻지 못하면 시험 삼아 부르지 않고 실패한다.** `document.close` 의
 * `SaveOptions` 와 같은 규칙이다 — 짐작한 값으로 부르면 무엇이 일어날지 모른다.
 */
async function rasterizeLayer(layer: PhotoshopLayer, filename: string): Promise<void> {
  const entire = constants.RasterizeType?.ENTIRELAYER;
  if (entire === undefined || typeof layer.rasterize !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 버전에서는 레이어를 픽셀로 구울 수 없습니다. " +
        "rasterize 없이 가져온 뒤 Photoshop 에서 직접 래스터화하세요.",
      { recoverable: true, details: { filename } },
    );
  }
  await layer.rasterize(entire);
}

export async function layerPlace(params: {
  filename: string;
  name?: string;
  rasterize?: boolean;
}): Promise<LayerInfo> {
  return runModal("Place file", async () => {
    const document = requireActiveDocument();
    const folder = await requireWorkspace();
    const entry = await findFile(folder, params.filename);

    const token = fileSystem().createSessionToken(
      entry as Parameters<ReturnType<typeof fileSystem>["createSessionToken"]>[0],
    );

    const results = await action.batchPlay(
      [
        {
          _obj: "placeEvent",
          // linked: false — 파일 경로를 참조하지 않고 문서 안에 포함한다.
          // 링크로 넣으면 파일을 옮기거나 지웠을 때 문서가 깨진다.
          linked: false,
          null: { _path: token, _kind: "local" },
          freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        },
      ],
      {},
    );

    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { filename: params.filename },
      });
    }

    // place 는 새 레이어를 만들고 그것을 활성으로 만든다.
    // ID 를 응답에서 읽지 않고 다시 조회한다 — 스마트 필터 때처럼 ID 가 바뀔 수 있다.
    const placed = app.activeDocument?.activeLayers[0];
    if (placed === undefined) {
      throw new DispatchError("COMMAND_FAILED", "가져온 레이어를 찾을 수 없습니다.", {
        details: { filename: params.filename },
      });
    }

    if (params.name !== undefined) {
      placed.name = params.name;
    }

    if (params.rasterize === true) {
      await rasterizeLayer(placed, params.filename);
    }

    /* **구워졌는지 확인한다.** `rasterize` 가 던지지 않았다고 픽셀이 된 것은
     * 아니다 — 만드는 것만 확인하고 넘어가 조정 레이어 여섯 종류를 놓친 적이
     * 있다(ROADMAP §17.38). `describeLayer` 가 읽는 `kind` 가 근거다. */
    const described = describeLayer(document, placed);
    if (params.rasterize === true && described.type === "smartObject") {
      throw new DispatchError(
        "COMMAND_FAILED",
        "레이어를 픽셀로 굽지 못했습니다. 스마트 오브젝트로 남아 있습니다.",
        { details: { filename: params.filename, layerId: described.id } },
      );
    }
    return described;
  });
}
