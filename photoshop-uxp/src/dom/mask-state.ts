import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { toAdjustmentKind, type AdjustmentKindResult } from "./adjustment-kind.js";

/**
 * 레이어의 마스크 상태를 읽는다.
 *
 * ## 왜 batchPlay 인가
 *
 * UXP DOM 이 알려주지 않는다. `layer.userMaskEnabled` 를 읽어 보았지만 항상
 * `undefined` 다. DOM 에 API 가 없을 때만 batchPlay 를 쓴다는 규칙에 해당한다.
 * (ARCHITECTURE §13)
 *
 * descriptor 는 **검증된 레이어 id 로 이 모듈이 조립한다.** 호출자가 descriptor 를
 * 넘기는 통로는 없다. (ARCHITECTURE §23)
 *
 * ## 왜 필요한가
 *
 * 호출자가 마스크를 만들었는지 확인할 방법이 없었다. "하늘만 어둡게" 같은 작업은
 * 마스크가 붙어야 완성인데 결과에 그 정보가 없으면 스스로 검증할 수 없다.
 * `mask.enable` 을 마스크 없는 레이어에 불러 막히는 일도 미리 피할 수 없었다.
 *
 * ## 실패하면 조용히 넘어간다
 *
 * 마스크 정보는 부가 정보다. 이것 때문에 `layer.list` 가 통째로 실패하면 손해가 더
 * 크다. 읽지 못하면 필드를 넣지 않는다 — 없는 것을 `false` 로 덮으면 "마스크가
 * 없다" 는 틀린 사실을 말하게 된다.
 */
export async function readMaskState(
  ids: readonly number[],
): Promise<Map<number, { hasMask: boolean; maskEnabled: boolean }>> {
  const out = new Map<number, { hasMask: boolean; maskEnabled: boolean }>();
  if (ids.length === 0) {
    return out;
  }

  const descriptors = ids.flatMap((id) => [
    { _obj: "get", _target: [{ _property: "hasUserMask" }, { _ref: "layer", _id: id }] },
    { _obj: "get", _target: [{ _property: "userMaskEnabled" }, { _ref: "layer", _id: id }] },
  ]);

  let results: Record<string, unknown>[];
  try {
    results = await action.batchPlay(descriptors, {});
  } catch {
    return out;
  }

  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i] as number;
    const has = results[i * 2]?.["hasUserMask"];
    if (typeof has !== "boolean") {
      continue;
    }
    const enabled = results[i * 2 + 1]?.["userMaskEnabled"];
    out.set(id, {
      hasMask: has,
      // 마스크가 없으면 활성 여부는 의미가 없다. 있는데 값을 못 읽으면 켜진 것으로
      // 본다 — Photoshop 이 마스크를 만들 때 기본이 활성이기 때문이다.
      maskEnabled: has && enabled !== false,
    });
  }
  return out;
}

/**
 * 조정 레이어의 종류를 읽는다. (ROADMAP §17.24)
 *
 * `layer.list` 는 "조정 레이어다" 까지만 말하고 **무슨 조정인지는 말하지 않았다.**
 * 저장한 PSD 를 다시 열면 이름으로 짐작하는 수밖에 없었다.
 *
 * `hasUserMask` 와 같은 방식으로 `adjustment` 속성을 읽는다. 마스크 상태와 같은
 * 규칙으로, **읽지 못하면 필드를 넣지 않는다.**
 *
 * 조정 레이어가 아닌 것에는 부르지 않는다 — 호출부가 걸러서 넘긴다.
 */
export async function readAdjustmentKinds(
  ids: readonly number[],
): Promise<Map<number, AdjustmentKindResult>> {
  const out = new Map<number, AdjustmentKindResult>();
  if (ids.length === 0) {
    return out;
  }

  let results: Record<string, unknown>[];
  try {
    results = await action.batchPlay(
      ids.map((id) => ({
        _obj: "get",
        _target: [{ _property: "adjustment" }, { _ref: "layer", _id: id }],
      })),
      {},
    );
  } catch {
    return out;
  }

  for (let i = 0; i < ids.length; i += 1) {
    const value = results[i]?.["adjustment"];
    if (value === undefined) {
      continue;
    }
    out.set(ids[i] as number, toAdjustmentKind(value));
  }
  return out;
}

/** 읽은 마스크 상태를 레이어 정보에 얹는다. 읽지 못한 레이어는 그대로 둔다. */
export function withMaskState(
  layers: readonly LayerInfo[],
  state: ReadonlyMap<number, { hasMask: boolean; maskEnabled: boolean }>,
): LayerInfo[] {
  return layers.map((layer) => {
    const found = state.get(layer.id);
    return found === undefined
      ? layer
      : { ...layer, hasMask: found.hasMask, maskEnabled: found.maskEnabled };
  });
}

/** 읽은 조정 종류를 레이어 정보에 얹는다. 읽지 못한 레이어는 그대로 둔다. */
export function withAdjustmentKind(
  layers: readonly LayerInfo[],
  kinds: ReadonlyMap<number, AdjustmentKindResult>,
): LayerInfo[] {
  return layers.map((layer) => {
    const found = kinds.get(layer.id);
    if (found === undefined) {
      return layer;
    }
    // 원본은 매핑에 실패했을 때만 담는다. 성공했는데 남기면 두 값이 같은 것을
    // 가리켜 어느 쪽을 믿어야 할지 모호해진다.
    return found.raw === undefined
      ? { ...layer, adjustmentType: found.adjustmentType }
      : { ...layer, adjustmentType: found.adjustmentType, rawAdjustmentType: found.raw };
  });
}

/**
 * 읽기와 병합을 한 번에. 레이어 몇 개만 다룰 때 쓴다.
 *
 * 조정 종류는 **조정 레이어에만** 묻는다. 픽셀 레이어에 물으면 Photoshop 이
 * 오류를 내고, 그러면 batchPlay 한 묶음이 통째로 실패해 마스크 상태까지 잃는다.
 */
export async function withMaskStateAsync(layers: readonly LayerInfo[]): Promise<LayerInfo[]> {
  const withMask = withMaskState(layers, await readMaskState(layers.map((entry) => entry.id)));
  const adjustments = withMask.filter((entry) => entry.type === "adjustment");
  if (adjustments.length === 0) {
    return withMask;
  }
  return withAdjustmentKind(
    withMask,
    await readAdjustmentKinds(adjustments.map((entry) => entry.id)),
  );
}

/**
 * 마스크가 레이어에 **연결되어 있는지** 읽는다. (ROADMAP §51)
 *
 * `readMaskState` 에 합치지 않았다. 그쪽은 `layer.list` 가 레이어마다 부르는
 * 경로라 속성을 하나 더하면 문서 전체에서 왕복이 레이어 수만큼 늘어난다.
 * **연결 여부는 link · unlink 를 부를 때만 필요하다** — 필요한 곳에서만 묻는다.
 *
 * **읽지 못하면 `null` 이다.** `false` 로 덮으면 "연결되어 있지 않다" 는 틀린
 * 사실을 말하게 된다 — `isBackground` · `rawBitDepth` 와 같은 원칙이다.
 */
export async function readMaskLinked(id: number): Promise<boolean | null> {
  let results: Record<string, unknown>[];
  try {
    results = await action.batchPlay(
      [{ _obj: "get", _target: [{ _property: "userMaskLinked" }, { _ref: "layer", _id: id }] }],
      {},
    );
  } catch {
    return null;
  }
  const value = results[0]?.["userMaskLinked"];
  return typeof value === "boolean" ? value : null;
}
