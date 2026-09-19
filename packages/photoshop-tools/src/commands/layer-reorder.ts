import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 레이어 순서 변경. (ROADMAP §17.23)
 *
 * ## 왜 이제야
 *
 * §17.9 가 "레이어 순서 변경은 아직 없다" 고 적어 둔 자리다. 그동안은 만들 때
 * 순서를 맞추면 됐는데, 실기 보정에서 **이미 만든 것을 옮겨야** 하는 경우가
 * 나왔다 — 채도 레이어가 그룹 안에 갇혀 있는 것을 최상위로 꺼냈다.
 *
 * 그때 `group.move_layer` 에 `groupId: null` 을 줘서 우회했다. 그것은 "그룹에서
 * 꺼낸다" 는 뜻의 API 이고 꺼낸 뒤 어디에 놓이는지는 부수 효과였다.
 *
 * ## **같은 부모 안에서만 움직인다**
 *
 * `top` · `bottom` · `up` · `down` 은 형제들 사이의 순서만 바꾼다. 그룹 경계를
 * 넘지 않는다.
 *
 * Photoshop UI 는 그룹 끝에서 한 번 더 누르면 밖으로 나간다. 그 동작을 흉내내지
 * 않았다 — 호출자가 "지금 그룹의 몇 번째인지" 를 알아야 결과를 예측할 수 있게
 * 되고, §17.20 에서 겪은 것과 같은 종류의 조용한 놀라움이 된다.
 *
 * 그룹을 넘나드는 이동은 `group.move_layer` 가 한다. `above` · `below` 는
 * 기준 레이어 옆으로 가므로 부모가 바뀔 수 있고, 그 사실은 결과의 `parentId`
 * 에 드러난다.
 *
 * ## 이미 그 자리면 실패가 아니다
 *
 * 맨 위 레이어에 `up` 을 주는 것은 오류가 아니다. 오류로 두면 호출자가 매번
 * 현재 위치를 확인해야 한다.
 *
 * 대신 **`moved` 로 무슨 일이 있었는지 말한다.** 조용히 성공을 돌려주면
 * 호출자는 움직였다고 믿는다.
 */

export const LAYER_REORDER = "LAYER_REORDER";

export const LayerReorderParamsSchema = z
  .object({
    layerId: z.number().int().positive(),
    /**
     * 어디로 옮길지.
     *
     * - `top` · `bottom` — 같은 부모 안에서 맨 위 / 맨 아래
     * - `up` · `down` — 같은 부모 안에서 한 칸
     * - `above` · `below` — `referenceId` 의 바로 위 / 아래. **부모가 바뀔 수 있다**
     */
    placement: z.enum(["top", "bottom", "up", "down", "above", "below"]),
    /** `above` · `below` 의 기준 레이어. 다른 placement 에는 쓰지 않는다. */
    referenceId: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsReference = value.placement === "above" || value.placement === "below";
    if (needsReference && value.referenceId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceId"],
        message: `${value.placement} 에는 referenceId 가 필요합니다.`,
      });
    }
    if (!needsReference && value.referenceId !== undefined) {
      // 조용히 무시하면 호출자는 기준이 쓰인 줄 안다.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceId"],
        message: `${value.placement} 에는 referenceId 를 쓰지 않습니다.`,
      });
    }
    if (value.referenceId !== undefined && value.referenceId === value.layerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["referenceId"],
        message: "자기 자신을 기준으로 삼을 수 없습니다.",
      });
    }
  });

export type LayerReorderParams = z.infer<typeof LayerReorderParamsSchema>;

export const LayerReorderResultSchema = z.object({
  layer: LayerInfoSchema,
  /**
   * 실제로 움직였는지.
   *
   * 맨 위에서 `up` 을 하면 `false` 다. 실패가 아니라 할 일이 없었던 것이다.
   */
  moved: z.boolean(),
  /** 옮기기 전 같은 부모 안에서의 위치. 0 이 맨 위. */
  previousIndex: z.number().int(),
  /** 옮긴 뒤의 위치. **요청이 아니라 실제로 읽은 값이다.** */
  index: z.number().int(),
  /** 같은 부모 안의 레이어 수. `index` 를 읽는 기준이 된다. */
  siblings: z.number().int(),
});

export type LayerReorderResult = z.infer<typeof LayerReorderResultSchema>;

export const layerReorderCommand: CommandHandler<LayerReorderParams, LayerReorderResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerReorderResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "순서 변경 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
