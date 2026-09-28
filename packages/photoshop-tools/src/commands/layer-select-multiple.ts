import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import type { ActiveLayerState } from "./layer-active.js";

/**
 * `LAYER_SELECT_MULTIPLE` — 레이어 여러 장을 한 번에 선택한다. (CORE_API §5 P1)
 *
 * `layer.select` 는 하나만 고른다. Photoshop 은 여러 장을 동시에 고를 수 있고
 * `layer.get_active` 가 그 상태를 이미 보고한다 — **읽기만 되고 쓰기가 없었다.**
 *
 * 결과는 `layer.get_active` 와 **같은 모양**이다. 두 Tool 이 다른 모양을 주면
 * 호출자가 둘을 따로 배워야 한다.
 */

export const LAYER_SELECT_MULTIPLE = "LAYER_SELECT_MULTIPLE";

export const LayerSelectMultipleParamsSchema = z
  .object({
    /**
     * 고를 레이어. 하나만 줘도 되지만 그때는 `layer.select` 가 더 분명하다.
     *
     * **중복을 거절한다.** 같은 id 를 두 번 주면 호출자가 무언가 착각한
     * 것이고, 조용히 하나로 합치면 그 착각이 그대로 남는다.
     */
    layerIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "layerIds 에 같은 id 가 두 번 있습니다.",
      }),
  })
  .strict();

export type LayerSelectMultipleParams = z.infer<typeof LayerSelectMultipleParamsSchema>;

/**
 * `layer` 는 **서버가** `layers[0]` 에서 뽑는다.
 *
 * Plugin 이 둘을 따로 보내면 어긋날 수 있고, 그러면 "편집 Tool 이 무엇을
 * 건드리는지" 를 알려주는 값이 거짓말을 한다. (`layer.get_active` 와 같은 규칙)
 */
export const layerSelectMultipleCommand: CommandHandler<
  LayerSelectMultipleParams,
  ActiveLayerState
> = async (command, context) => {
  const layers = await context.bridge.executeCommand<LayerInfo[]>(command);
  return { layer: layers[0] ?? null, layers };
};
