import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_LINK` · `LAYER_UNLINK` — 레이어 연결. (CORE_API §5)
 *
 * 연결된 레이어들은 **함께 움직이고 함께 변형된다.** 그룹과 다르다 — 트리
 * 구조가 바뀌지 않고 순서도 그대로다.
 */

export const LAYER_LINK = "LAYER_LINK";
export const LAYER_UNLINK = "LAYER_UNLINK";

export const LayerLinkParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
    /** 연결할 상대. **자기 자신은 받지 않는다.** */
    targetId: z.number().int().positive(),
  })
  .strict();

export const LayerUnlinkParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type LayerLinkParams = z.infer<typeof LayerLinkParamsSchema>;
export type LayerUnlinkParams = z.infer<typeof LayerUnlinkParamsSchema>;

export const LayerLinkResultSchema = z.object({
  layer: LayerInfoSchema,
  /**
   * 연결된 레이어의 id. **`linkedLayers` 를 읽은 값**이고 요청을 되풀이한
   * 것이 아니다. 가공하지 않고 그대로 준다.
   */
  linked: z.array(z.number()),
});

export type LayerLinkResult = z.infer<typeof LayerLinkResultSchema>;

function forward<TParams>(): CommandHandler<TParams, LayerLinkResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = LayerLinkResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 예상과 다릅니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

export const layerLinkCommand = forward<LayerLinkParams>();
export const layerUnlinkCommand = forward<LayerUnlinkParams>();
