import { action } from "photoshop";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";

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

/** 읽기와 병합을 한 번에. 레이어 몇 개만 다룰 때 쓴다. */
export async function withMaskStateAsync(layers: readonly LayerInfo[]): Promise<LayerInfo[]> {
  return withMaskState(layers, await readMaskState(layers.map((entry) => entry.id)));
}
