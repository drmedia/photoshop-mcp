import type { LayerInfo } from "@photoshop-mcp/extension-sdk";

/**
 * 결과 레이어 이름 규칙.
 *
 * 기존 MilkyScape 패널의 관례를 따른다 — `<도구>_<기능>_<번호>`.
 * 예: `StarNet2_별제거_01`
 *
 * 번호를 붙이는 이유는 같은 대상을 여러 번 실행할 수 있고 **매번 새 결과를
 * 만들기** 때문이다. 기존 결과를 덮어쓰거나 자동으로 지우지 않는다.
 * (MilkyScape 개발계획서 §2-8, §2-9, §5.2)
 */

/** 이름 규칙에 쓰는 접두사. */
export interface LayerKind {
  tool: string;
  feature: string;
}

export const STARLESS: LayerKind = { tool: "StarNet2", feature: "별제거" };
export const STARS: LayerKind = { tool: "StarNet2", feature: "별" };
export const SHARPENED: LayerKind = { tool: "BXT", feature: "선명화" };
export const GRADIENT: LayerKind = { tool: "GraXpert", feature: "그래디언트제거" };

const prefixOf = (kind: LayerKind): string => `${kind.tool}_${kind.feature}_`;

/** 두 자리 번호. 100 이상은 자릿수를 늘린다. */
function pad(value: number): string {
  return value < 100 ? String(value).padStart(2, "0") : String(value);
}

/**
 * 다음 실행 번호를 붙인 이름.
 *
 * 기존 레이어를 훑어 가장 큰 번호 다음을 쓴다. 빈 번호를 재사용하지 않는다 —
 * 사용자가 중간 결과를 지웠을 때 이름이 겹치면 어느 것이 최신인지 알 수 없다.
 */
export function nextName(layers: readonly LayerInfo[], kind: LayerKind): string {
  const prefix = prefixOf(kind);
  let highest = 0;

  for (const layer of layers) {
    if (!layer.name.startsWith(prefix)) {
      continue;
    }
    const suffix = layer.name.slice(prefix.length);
    const parsed = /^(\d+)$/u.exec(suffix);
    if (parsed?.[1] !== undefined) {
      highest = Math.max(highest, Number.parseInt(parsed[1], 10));
    }
  }

  return `${prefix}${pad(highest + 1)}`;
}

/** 그 종류의 레이어들. 번호가 큰 것부터. */
export function findByKind(layers: readonly LayerInfo[], kind: LayerKind): LayerInfo[] {
  const prefix = prefixOf(kind);
  return layers
    .filter((layer) => layer.name.startsWith(prefix))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** 가장 최근 결과. 없으면 `null`. */
export function latestOfKind(layers: readonly LayerInfo[], kind: LayerKind): LayerInfo | null {
  return findByKind(layers, kind)[0] ?? null;
}
