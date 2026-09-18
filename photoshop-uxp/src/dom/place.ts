import { action, app } from "photoshop";
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

export async function layerPlace(params: { filename: string; name?: string }): Promise<LayerInfo> {
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

    return describeLayer(document, placed);
  });
}
