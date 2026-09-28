import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { resolveMutatedLayer } from "./mutation-result.js";
import { runModal } from "./modal.js";
import { findFile } from "./place.js";
import { fileSystem, requireWorkspace } from "./workspace.js";

/**
 * 스마트 오브젝트 변환. (ROADMAP §17.27)
 *
 * DOM 에 변환 API 가 없어 batchPlay 를 쓴다. descriptor 는 파라미터가 없는 고정
 * 상수라 호출자가 끼어들 자리가 없다. (ARCHITECTURE §13, §23)
 *
 * `filter.ts` 가 `asSmartFilter` 에서 쓰는 것과 같은 descriptor 다.
 */

export async function smartObjectConvert(params: { layerId?: number }): Promise<{
  layer: LayerInfo;
  converted: boolean;
  previousId: number;
}> {
  return runModal("Convert to smart object", async () => {
    const document = requireActiveDocument();

    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const previousId = target.id;
    const before = flattenLayers(document.layers);
    const info = before.find((entry) => entry.id === previousId);
    if (info === undefined) {
      throw new DispatchError("LAYER_NOT_FOUND", "대상 레이어를 확인하지 못했습니다.", {
        recoverable: true,
      });
    }

    // **두 번 변환하지 않는다.** 스마트 오브젝트 안에 스마트 오브젝트가 생겨
    // 구조가 한 겹 깊어지고, 호출자가 의도한 적이 없는 일이다.
    if (info.type === "smartObject") {
      return {
        layer: (await withMaskStateAsync([info]))[0] as LayerInfo,
        converted: false,
        previousId,
      };
    }

    document.activeLayers = [target];

    const results = await action.batchPlay([{ _obj: "newPlacedLayer" }], {});
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { layerId: previousId },
      });
    }

    // **id 가 바뀐다.** 활성 레이어로 추정하지 않고 이번에 생긴 id 로 찾는다 —
    // 다른 이유로 활성 레이어가 바뀌었을 수 있다. (§8.4 의 mutate() 와 같은 규칙)
    const after = flattenLayers(requireActiveDocument().layers);
    const resolved = resolveMutatedLayer(
      before.map((entry) => entry.id),
      after,
      previousId,
    );
    if (resolved === null) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "변환은 실행되었지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { previousId } },
      );
    }

    // 변환됐다고 말하기 전에 실제로 스마트 오브젝트인지 본다.
    if (resolved.type !== "smartObject") {
      throw new DispatchError(
        "COMMAND_FAILED",
        `변환 명령은 오류 없이 끝났지만 레이어가 ${resolved.type} 입니다.`,
        { details: { previousId, actual: resolved.type } },
      );
    }

    return {
      layer: (await withMaskStateAsync([resolved]))[0] as LayerInfo,
      converted: true,
      previousId,
    };
  });
}

export interface SmartObjectInfo {
  layer: LayerInfo;
  isSmartObject: boolean;
  /** 연결(linked) 인지 포함(embedded) 인지. 모르면 `null`. */
  linked: boolean | null;
  /**
   * 내용 파일 이름.
   *
   * **포함이어도 값이 있다** — 실기에서 변환한 레이어가 `PLAIN.psb` 를
   * 돌려줬다. 포함일 때는 Photoshop 내부 이름이고 연결일 때만 실제 경로다.
   * 처음에 "포함이면 null" 이라고 적었는데 재 보니 틀렸다.
   */
  fileReference: string | null;
  /** `placed` 의 안쪽 값. 실기에서 `rasterizeContent` 가 왔다. */
  placed: string | null;
  /**
   * 내용의 XMP 문서 id.
   *
   * **"지금 내용을 공유하는가" 가 아니라 "어디서 온 내용인가" 다.** 같은 파일에서
   * 온 두 레이어는 `new_via_copy` 로 갈라 놓아도 같은 값이다 — 실기에서
   * 원본과 사본이 같았다. §54 에 "내용을 공유한다" 고 적었던 해석이 틀렸다.
   */
  contentId: string | null;
  /** 연결된 파일의 전체 경로. 포함이거나 모르면 `null`. */
  linkPath: string | null;
  /** **연결된 파일이 사라졌는지.** `true` 면 문서가 깨진 상태다. */
  linkMissing: boolean | null;
  /** 연결된 파일이 바뀌었는지. `true` 면 `smart_object.update` 가 할 일이 있다. */
  linkChanged: boolean | null;
  /** 해석하지 못한 원본. 아는 것만 위로 올리고 나머지는 그대로 둔다. */
  raw: Record<string, unknown> | null;
}

/**
 * 스마트 오브젝트의 속성을 읽는다. (ROADMAP §54)
 *
 * ## DOM 에 없다 — 레퍼런스가 그렇게 말한다
 *
 * Adobe Layer 레퍼런스에 스마트 오브젝트 관련 멤버가 **하나도 없다.**
 * `rasterize()` 만 있고 그건 `layer.rasterize` 가 이미 쓴다.
 *
 * ## 읽기라 잡아 달라고 부탁하지 않았다
 *
 * batchPlay `get` 은 **읽기만 한다.** 없는 속성을 물으면 오류가 나거나 빈 값이
 * 오고 문서는 바뀌지 않는다. 그래서 키를 알아내는 데 알림 캡처가 필요 없다 —
 * `mask.select` 의 `ChannelProbe` 와 같은 방법이다(§31).
 *
 * ## 아는 것만 올리고 나머지는 `raw` 로 둔다
 *
 * 이름을 짐작해 채우지 않는다. 매핑하지 못한 키는 `raw` 에 그대로 남긴다 —
 * `rawBitDepth` · `rawKind` · `rawAdjustmentType` 과 같은 원칙이다.
 */
export async function smartObjectGetInfo(params: { layerId?: number }): Promise<SmartObjectInfo> {
  return runModal("Get smart object info", async () => {
    const document = requireActiveDocument();
    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const info = flattenLayers(document.layers).find((entry) => entry.id === target.id);
    if (info === undefined) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        `레이어 ${target.id} 를 목록에서 찾지 못했습니다.`,
        {
          recoverable: true,
          details: { layerId: target.id },
        },
      );
    }
    const layer = (await withMaskStateAsync([info]))[0] as LayerInfo;

    /* **스마트 오브젝트가 아니면 묻지 않는다.** 물으면 batchPlay 가 실패하고,
     * 그 실패를 "정보를 못 읽었다" 로 돌려주면 호출자는 스마트 오브젝트인데
     * 읽기에 실패한 것으로 읽는다. */
    if (layer.type !== "smartObject") {
      return {
        layer,
        isSmartObject: false,
        linked: null,
        fileReference: null,
        placed: null,
        contentId: null,
        linkPath: null,
        linkMissing: null,
        linkChanged: null,
        raw: null,
      };
    }

    let bag: Record<string, unknown> | null = null;
    try {
      const results = await action.batchPlay(
        [
          {
            _obj: "get",
            _target: [{ _property: "smartObject" }, { _ref: "layer", _id: layer.id }],
          },
        ],
        {},
      );
      const value = results[0]?.["smartObject"];
      bag = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
    } catch {
      /* 읽지 못하면 `null` 이다. 지어내지 않는다. */
      bag = null;
    }

    if (bag === null) {
      return {
        layer,
        isSmartObject: true,
        linked: null,
        fileReference: null,
        placed: null,
        contentId: null,
        linkPath: null,
        linkMissing: null,
        linkChanged: null,
        raw: null,
      };
    }

    /* `_obj` 는 descriptor 자신의 클래스 이름("smartObject")이라 담지 않는다.
     * 나머지 넷은 실기에서 실제로 온 것이다. */
    const known = new Set([
      "_obj",
      "linked",
      "fileReference",
      "placed",
      "documentID",
      "link",
      "linkMissing",
      "linkChanged",
    ]);
    const linkedValue = bag["linked"];
    const fileValue = bag["fileReference"];
    const documentIdValue = bag["documentID"];

    /* `placed` 는 `{_enum:"placed", _value:"rasterizeContent"}` 로 온다.
     * 안쪽 값만 꺼내고, 모양이 다르면 `null` 로 둔 채 `raw` 에 남긴다. */
    const placedRaw = bag["placed"];
    const placedValue =
      placedRaw !== null && typeof placedRaw === "object"
        ? (placedRaw as Record<string, unknown>)["_value"]
        : undefined;

    /* 연결일 때만 오는 셋. `link` 는 `{_path, _kind}` 이고 경로만 꺼낸다.
     * **`linkMissing` 이 `workspace.delete` 로 깨진 연결을 잡아낸다** — 실기에서
     * 연결된 파일을 지우고 `true` 가 되는 것을 확인했다. (ROADMAP §55) */
    const linkRaw = bag["link"];
    const linkPathValue =
      linkRaw !== null && typeof linkRaw === "object"
        ? (linkRaw as Record<string, unknown>)["_path"]
        : undefined;
    const missingValue = bag["linkMissing"];
    const changedValue = bag["linkChanged"];

    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(bag)) {
      if (!known.has(key)) {
        rest[key] = value;
      }
    }
    if (placedValue === undefined && placedRaw !== undefined) {
      rest["placed"] = placedRaw;
    }

    return {
      layer,
      isSmartObject: true,
      linked: typeof linkedValue === "boolean" ? linkedValue : null,
      fileReference: typeof fileValue === "string" ? fileValue : null,
      placed: typeof placedValue === "string" ? placedValue : null,
      contentId: typeof documentIdValue === "string" ? documentIdValue : null,
      linkPath: typeof linkPathValue === "string" ? linkPathValue : null,
      linkMissing: typeof missingValue === "boolean" ? missingValue : null,
      linkChanged: typeof changedValue === "boolean" ? changedValue : null,
      raw: Object.keys(rest).length === 0 ? null : rest,
    };
  });
}

/**
 * 내용을 공유하지 않는 사본을 만든다. (ROADMAP §55)
 *
 * **`layer.duplicate` 와 다르다.** 복제본은 내용을 공유해서 한쪽을 고치면
 * 다른 쪽도 바뀐다 — `smart_object.get_info` 의 `contentId` 가 같은 것으로
 * 실기에서 확인했다(§54). 이것은 내용을 복사해 **연결을 끊는다.**
 *
 * descriptor 는 `["all"]` 알림으로 잡았다. **인자가 하나도 없다** —
 * `{_obj:"placedLayerMakeCopy"}` 가 전부이고 활성 레이어에 걸린다.
 * History 이름은 `New Smart Object via Copy` 다.
 */
export async function smartObjectNewViaCopy(params: { layerId?: number }): Promise<{
  layer: LayerInfo;
  sourceId: number;
}> {
  return runModal("New smart object via copy", async () => {
    const document = requireActiveDocument();
    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const sourceId = target.id;
    const described = flattenLayers(document.layers).find((entry) => entry.id === sourceId);
    /* **스마트 오브젝트가 아니면 미리 막는다.** Photoshop 은 "명령을 사용할 수
     * 없습니다" 라고만 답해 이유를 알 수 없다. */
    if (described === undefined || described.type !== "smartObject") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${sourceId} 는 스마트 오브젝트가 아닙니다. smart_object.convert 를 먼저 부르세요.`,
        { recoverable: true, details: { layerId: sourceId, type: described?.type ?? null } },
      );
    }

    /* **연결 스마트 오브젝트에는 걸리지 않는다.**
     *
     * 실기에서 Photoshop 이 "'복사를 통해 새 스마트 오브젝트 만들기' 명령은 현재
     * 사용할 수 없습니다" 라고만 답했다 — 이유를 알 수 없는 문장이다. 연결은
     * 내용이 파일에 있어 복사해 낼 것이 없다. 미리 막고 이유를 말한다.
     * (ROADMAP §55) */
    const info = await smartObjectGetInfo({ layerId: sourceId });
    if (info.linked === true) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${sourceId} 는 연결(linked) 스마트 오브젝트라 사본을 만들 수 없습니다. ` +
          "내용이 파일에 있어 복사해 낼 것이 없습니다 — layer.place 로 다시 가져오세요.",
        { recoverable: true, details: { layerId: sourceId, linked: true } },
      );
    }

    document.activeLayers = [target];
    const before = flattenLayers(document.layers).map((entry) => entry.id);

    const results = await action.batchPlay([{ _obj: "placedLayerMakeCopy" }], {});
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { layerId: sourceId },
      });
    }

    /* **새 레이어가 생긴다.** 원본은 그대로 남으므로 `resolveMutatedLayer` 가
     * 아니라 "없던 id" 를 직접 찾는다. */
    const after = flattenLayers(requireActiveDocument().layers);
    const known = new Set(before);
    const created = after.find((entry) => !known.has(entry.id));
    if (created === undefined) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "사본은 만들어졌지만 결과 레이어를 확인하지 못했습니다. layer.list 로 확인하세요.",
        { recoverable: true, details: { layerId: sourceId } },
      );
    }
    return { layer: (await withMaskStateAsync([created]))[0] as LayerInfo, sourceId };
  });
}

/**
 * 연결된 내용을 다른 파일로 바꾼다. (ROADMAP §55)
 *
 * 잡은 descriptor 에 **경로가 인자로 들어 있다** — 그래서 대화상자 없이 부를 수
 * 있다. 그게 이 Tool 을 만들 수 있느냐를 갈랐다.
 *
 * ```json
 * { "_obj": "placedLayerRelinkToFile",
 *   "null": { "_path": "...", "_kind": "local" }, "layerID": 4 }
 * ```
 *
 * 경로는 **세션 토큰**이어야 한다 — 문자열을 그대로 주면
 * `invalid file token used` 가 난다(§8.5). `layer.place` 와 같은 규칙이고,
 * 그래서 **승인된 작업 폴더 안의 파일만** 받는다.
 */
export async function smartObjectRelink(params: {
  layerId?: number;
  filename: string;
}): Promise<SmartObjectInfo> {
  return runModal("Relink smart object", async () => {
    const document = requireActiveDocument();
    const target =
      params.layerId === undefined
        ? document.activeLayers[0]
        : findLayerById(document.layers, params.layerId);
    if (target === undefined || target === null) {
      throw new DispatchError(
        "LAYER_NOT_FOUND",
        params.layerId === undefined
          ? "활성 레이어가 없습니다."
          : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
        { recoverable: true, details: { layerId: params.layerId } },
      );
    }

    const layerId = target.id;
    const described = flattenLayers(document.layers).find((entry) => entry.id === layerId);
    if (described === undefined || described.type !== "smartObject") {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `레이어 ${layerId} 는 스마트 오브젝트가 아닙니다.`,
        { recoverable: true, details: { layerId, type: described?.type ?? null } },
      );
    }

    const folder = await requireWorkspace();
    const entry = await findFile(folder, params.filename);
    const token = fileSystem().createSessionToken(
      entry as Parameters<ReturnType<typeof fileSystem>["createSessionToken"]>[0],
    );

    const results = await action.batchPlay(
      [
        {
          _obj: "placedLayerRelinkToFile",
          null: { _path: token, _kind: "local" },
          layerID: layerId,
        },
      ],
      {},
    );
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { layerId, filename: params.filename },
      });
    }

    /* **바뀐 것을 그대로 읽어 돌려준다.** 성공만 말하면 호출자는 어느 파일에
     * 연결됐는지 다시 물어야 한다. */
    return smartObjectGetInfo({ layerId });
  });
}

/**
 * 수정된 연결 스마트 오브젝트를 전부 새로 읽는다. (ROADMAP §55)
 *
 * **레이어 하나가 아니라 문서 전체다.** 메뉴 이름은 "수정된 내용 업데이트"
 * 인데 History 이름이 `Update All Modified Smart Objects` 이고 잡은
 * descriptor 도 문서 단위였다.
 *
 * ```json
 * { "_obj": "placedLayerUpdateAllModified", "documentID": 854, "layerIDs": [] }
 * ```
 *
 * **`layerIDs` 에 값을 넣어 보지 않았다.** 빈 배열만 잡혔고, 넣으면 그것만
 * 도는지 알 수 없다 — 짐작해서 파라미터로 열지 않는다.
 */
export async function smartObjectUpdate(): Promise<{ documentId: number }> {
  return runModal("Update modified smart objects", async () => {
    const document = requireActiveDocument();
    const results = await action.batchPlay(
      [
        {
          _obj: "placedLayerUpdateAllModified",
          documentID: document.id,
          layerIDs: [],
        },
      ],
      {},
    );
    const failure = results.find((result) => result["message"] !== undefined);
    if (failure !== undefined) {
      throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
        details: { documentId: document.id },
      });
    }
    return { documentId: document.id };
  });
}
