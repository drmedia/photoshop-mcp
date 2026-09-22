import type { LayerInfo } from "@photoshop-mcp/extension-api";

/**
 * 레이어 이름과 임시 파일 이름.
 *
 * **둘을 같은 카운터에서 파생하지 않는다.** 실행이 중간에 실패하면 내보낸
 * 파일은 남는데 레이어는 만들어지지 않는다. 그러면 재시도할 때마다 같은 이름으로
 * 내보내려다 `FILE_ALREADY_EXISTS` 로 영구히 막힌다. 실기에서 겪은 것이다.
 *
 * `extensions/rcastro` · `extensions/starnet` 과 같은 내용이다. 공유하지 않는 이유는 Extension 이
 * 서로를 import 할 수 없기 때문이다 — 각자 독립해 배포된다.
 */

function pad(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/**
 * 다음 번호를 붙인 레이어 이름.
 *
 * 빈 번호를 재사용하지 않는다 — 사용자가 중간 결과를 지웠을 때 이름이 겹치면
 * 어느 것이 최신인지 알 수 없다.
 */
export function nextLayerName(layers: readonly LayerInfo[], product: string): string {
  const prefix = `${product} `;
  let highest = 0;
  for (const layer of layers) {
    if (!layer.name.startsWith(prefix)) {
      continue;
    }
    const parsed = /^(\d+)$/u.exec(layer.name.slice(prefix.length));
    if (parsed?.[1] !== undefined) {
      highest = Math.max(highest, Number.parseInt(parsed[1], 10));
    }
  }
  return `${prefix}${pad(highest + 1)}`;
}

/** 작업 폴더에 쓸 파일 이름. 경로 구분자는 스키마가 거부하므로 미리 없앤다. */
function slug(documentName: string): string {
  const base = documentName.replace(/^.*[\\/]/u, "").replace(/\.[^.]+$/u, "");
  const cleaned = base.replace(/[\\/:*?"<>|\s]+/gu, "-").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "doc";
}

/** 이번 실행의 임시 파일 기준 이름. */
export function runStem(documentName: string, product: string): string {
  const token = Date.now().toString(36).slice(-6);
  return `${slug(documentName)}-${product.toLowerCase()}-${token}`;
}
