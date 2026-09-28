import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_MERGE` — 레이어를 합친다. (CORE_API §5 P2)
 *
 * **선택 상태에 따라 뜻이 달라진다.** Adobe 레퍼런스가 "Combines selected
 * layers; merges one layer downward if only one is selected" 라고 적는다.
 *
 * 그 숨은 의존성을 그대로 두지 않는다 — `layerIds` 로 무엇을 합칠지 명시하면
 * 이 Command 가 먼저 선택한다. 호출자가 "지금 무엇이 선택돼 있는지" 를 추적해야
 * 결과를 예측할 수 있는 API 는 조용히 틀린다(ROADMAP §17.20).
 */

export const LAYER_MERGE = "LAYER_MERGE";

export const LayerMergeParamsSchema = z
  .object({
    /**
     * 합칠 레이어.
     *
     * - **하나** — 그 레이어를 **아래로 병합**한다
     * - **둘 이상** — 그것들끼리 병합한다
     * - 생략 — 지금 선택돼 있는 것을 쓴다
     */
    layerIds: z.array(z.number().int().positive()).min(1).max(200).optional(),
  })
  .strict();

export type LayerMergeParams = z.infer<typeof LayerMergeParamsSchema>;

export const LayerMergeResultSchema = z.object({
  layer: LayerInfoSchema,
  /** 실제로 합친 대상의 id. 준 것이거나 그때 선택돼 있던 것이다. */
  merged: z.array(z.number()),
  /** 합치기 전후 전체 레이어 수. **아무 일도 안 일어나면 실패로 답한다.** */
  before: z.number(),
  after: z.number(),
  removed: z.number(),
  /** 하나만 주어 **아래로 병합**이 된 경우. */
  mergedDown: z.boolean(),
});

export type LayerMergeResult = z.infer<typeof LayerMergeResultSchema>;

export const layerMergeCommand: CommandHandler<LayerMergeParams, LayerMergeResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerMergeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
