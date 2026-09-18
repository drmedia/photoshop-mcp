import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";

/**
 * 활성 레이어를 `activeLayers` 순서대로 정렬한다. (`LAYER_GET_ACTIVE`)
 *
 * ## 왜 따로 떼어 두는가
 *
 * 여기가 틀리면 `photoshop.layer.get_active` 가 **거짓말을 한다.** 편집 Command 는
 * `layerId` 를 생략하면 `document.activeLayers[0]` 을 대상으로 삼으므로, 이 함수가
 * 돌려주는 첫 번째가 그것과 달라지면 "무엇을 건드릴지" 를 잘못 알려준다.
 *
 * 실제로 한 번 틀렸다. 처음에는 평탄화 목록을 선택 집합으로 걸렀는데, 그러면 결과가
 * 레이어 순서(위→아래)로 정렬된다. 실기에서 두 개를 선택해 보니 `activeLayers[0]` 은
 * id 13 인데 이 Tool 은 id 14 를 첫 번째로 보고했다. **Photoshop 의 `activeLayers`
 * 순서는 레이어 순서가 아니다.**
 *
 * `dom/layers.ts` 는 `photoshop` 런타임에 의존해 테스트에서 부를 수 없다. 그래서
 * 순서 규칙만 여기로 옮겨 단위 테스트로 고정한다.
 *
 * @param activeIds `document.activeLayers` 의 id. **이 순서가 결과 순서다.**
 * @param flattened 평탄화한 레이어 목록. `parentId` 가 여기에만 있다.
 * @param fallbacks `activeIds` 와 같은 순서의 최소 정보. 평탄화 목록에 없을 때 쓴다.
 */
export function orderActiveLayers(
  activeIds: readonly number[],
  flattened: readonly LayerInfo[],
  fallbacks: readonly LayerInfo[],
): LayerInfo[] {
  const byId = new Map(flattened.map((layer) => [layer.id, layer]));
  const out: LayerInfo[] = [];

  for (let i = 0; i < activeIds.length; i += 1) {
    const id = activeIds[i] as number;
    // 평탄화 목록에 없으면 최소 정보라도 넣는다. 건너뛰면 뒤엣것이 첫 번째로
    // 올라와 편집 대상과 어긋난다 — 빠뜨리는 쪽이 더 위험하다.
    const found = byId.get(id) ?? fallbacks[i];
    if (found !== undefined) {
      out.push(found);
    }
  }
  return out;
}
