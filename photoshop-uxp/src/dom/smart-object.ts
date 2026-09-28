import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { flattenLayers } from "./layers.js";
import { withMaskStateAsync } from "./mask-state.js";
import { resolveMutatedLayer } from "./mutation-result.js";
import { runModal } from "./modal.js";

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
  /** 내용의 XMP 문서 id. 복제해도 같은 내용이면 같다. */
  contentId: string | null;
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
        raw: null,
      };
    }

    /* `_obj` 는 descriptor 자신의 클래스 이름("smartObject")이라 담지 않는다.
     * 나머지 넷은 실기에서 실제로 온 것이다. */
    const known = new Set(["_obj", "linked", "fileReference", "placed", "documentID"]);
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
      raw: Object.keys(rest).length === 0 ? null : rest,
    };
  });
}
