import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_GET_ACTIVE` — 지금 선택되어 있는 레이어.
 *
 * ## 왜 필요한가
 *
 * 편집 Tool 은 `layerId` 를 생략하면 활성 레이어를 대상으로 삼는다. 그런데 그것이
 * 무엇인지 물어볼 방법이 없었다. `layer.list` 로 전체를 받아 훑는 것이 유일한
 * 우회였는데, 레이어가 33개인 문서에서도 그렇게 해야 했다.
 *
 * ## 활성 레이어는 하나가 아니다
 *
 * Photoshop 은 레이어를 **여러 개 동시에 선택할 수 있다.** `document.activeLayers`
 * 는 배열이고, 편집 Command 들은 그중 첫 번째만 쓴다.
 *
 * 그래서 첫 번째만 돌려주면 안 된다. 세 개를 골라 둔 사용자에게 하나만 보여주면
 * `layer.rename` 이 나머지 둘을 건드리지 않는다는 사실이 가려진다.
 *
 * ## Plugin 은 배열만 보낸다
 *
 * `layer` 는 **서버가** `layers[0]` 에서 뽑는다. Plugin 이 둘을 따로 보내면 둘이
 * 어긋날 수 있고, 그러면 "편집 Tool 이 무엇을 건드리는지" 알려주는 이 Tool 자체가
 * 거짓말을 한다. 어긋날 수 있는 두 값을 주고받으며 검증하는 대신 **어긋날 수 없게**
 * 만든다. Plugin 은 실행 Agent 이고 계산은 서버에서 끝낸다. (ARCHITECTURE §11)
 *
 * ## 없을 때 실패하지 않는다
 *
 * 문서는 열려 있는데 선택된 레이어가 없으면 `layer: null` · `layers: []` 다.
 * 조회에서 "없음" 은 오류가 아니라 답이다. 문서 자체가 없을 때만 실패한다
 * (`DOCUMENT_NOT_FOUND`) — 그건 답할 대상이 없는 경우다.
 */

export const LAYER_GET_ACTIVE = "LAYER_GET_ACTIVE";

export const LayerGetActiveParams = z.object({}).strict();

export interface ActiveLayerState {
  /** 편집 Tool 이 `layerId` 없이 대상으로 삼는 레이어. 선택이 없으면 `null`. */
  layer: LayerInfo | null;
  /** 선택된 레이어 전부. Photoshop 은 여러 개를 고를 수 있다. */
  layers: LayerInfo[];
}

export const layerGetActiveCommand: CommandHandler<
  Record<string, never>,
  ActiveLayerState
> = async (command, context) => {
  const layers = await context.bridge.executeCommand<LayerInfo[]>(command);
  return { layer: layers[0] ?? null, layers };
};
