import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 레이어 컴프. (ROADMAP §57)
 *
 * **전부 DOM 이다** — `document.layerComps`(24.0+) 와 `LayerComp` 클래스로
 * 다 된다. batchPlay 를 쓰지 않는다.
 *
 * `add` 의 옵션 인터페이스가 레퍼런스에 없어 **빈 객체로 만든 뒤 R/W 속성에
 * 직접 넣고 읽어서 확인한다.**
 */

export const LAYER_COMP_LIST = "LAYER_COMP_LIST";
export const LAYER_COMP_GET = "LAYER_COMP_GET";
export const LAYER_COMP_CREATE = "LAYER_COMP_CREATE";
export const LAYER_COMP_APPLY = "LAYER_COMP_APPLY";
export const LAYER_COMP_RECAPTURE = "LAYER_COMP_RECAPTURE";
export const LAYER_COMP_DELETE = "LAYER_COMP_DELETE";

const CompName = z.string().trim().min(1).max(255);

export const LayerCompInfoSchema = z.object({
  index: z.number().int(),
  /** batchPlay 용 id. 못 읽으면 `null`. */
  id: z.number().nullable(),
  name: z.string(),
  comment: z.string().nullable(),
  /** 레이어 스타일을 기억하는지. */
  appearance: z.boolean().nullable(),
  /** 레이어 위치를 기억하는지. */
  position: z.boolean().nullable(),
  /** 레이어 표시 여부를 기억하는지. */
  visibility: z.boolean().nullable(),
  /** 스마트 오브젝트 안의 컴프 선택을 기억하는지. */
  childComp: z.boolean().nullable(),
  /** 패널에서 선택되어 있는지. 읽기 전용이다. */
  selected: z.boolean().nullable(),
});

export const LayerCompListResultSchema = z.object({ comps: z.array(LayerCompInfoSchema) });
export const LayerCompDeleteResultSchema = z.object({
  deleted: z.string(),
  remaining: z.number().int(),
});

export type LayerCompInfo = z.infer<typeof LayerCompInfoSchema>;
export type LayerCompListResult = z.infer<typeof LayerCompListResultSchema>;
export type LayerCompDeleteResult = z.infer<typeof LayerCompDeleteResultSchema>;

export const LayerCompListParamsSchema = z.object({}).strict();

/**
 * 이름 **또는** 색인.
 *
 * **이름은 유일하지 않다** — `getAllByName` 이 배열을 돌려준다. 여럿이면
 * 플러그인이 거절하고 색인을 쓰라고 말한다. (액션과 같다, §17.34)
 */
const TargetShape = {
  name: CompName.optional(),
  index: z.number().int().min(0).max(999).optional(),
};
const requireOneTarget = (value: { name?: string; index?: number }): boolean =>
  (value.name === undefined) !== (value.index === undefined);
const targetMessage = { message: "name 과 index 중 정확히 하나를 줍니다." };

export const LayerCompGetParamsSchema = z
  .object(TargetShape)
  .strict()
  .refine(requireOneTarget, targetMessage);
export const LayerCompApplyParamsSchema = LayerCompGetParamsSchema;
export const LayerCompRecaptureParamsSchema = LayerCompGetParamsSchema;
export const LayerCompDeleteParamsSchema = LayerCompGetParamsSchema;

export const LayerCompCreateParamsSchema = z
  .object({
    name: CompName.optional(),
    comment: z.string().trim().max(1000).optional(),
    /**
     * 무엇을 기억할지.
     *
     * 레퍼런스가 "옵션 없이 만들면 표시 여부만 기록된다" 고 적는다 —
     * **결과를 읽어서 실제로 무엇이 켜졌는지 답한다.**
     */
    appearance: z.boolean().optional(),
    position: z.boolean().optional(),
    visibility: z.boolean().optional(),
    childComp: z.boolean().optional(),
  })
  .strict();

export type LayerCompListParams = z.infer<typeof LayerCompListParamsSchema>;
export type LayerCompGetParams = z.infer<typeof LayerCompGetParamsSchema>;
export type LayerCompCreateParams = z.infer<typeof LayerCompCreateParamsSchema>;
export type LayerCompApplyParams = z.infer<typeof LayerCompApplyParamsSchema>;
export type LayerCompRecaptureParams = z.infer<typeof LayerCompRecaptureParamsSchema>;
export type LayerCompDeleteParams = z.infer<typeof LayerCompDeleteParamsSchema>;

function forward<TParams, TResult>(
  schema: z.ZodType<TResult>,
  label: string,
): CommandHandler<TParams, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
        details: { issues: parsed.error.issues, received: raw },
        cause: parsed.error,
      });
    }
    return parsed.data;
  };
}

export const layerCompListCommand = forward<LayerCompListParams, LayerCompListResult>(
  LayerCompListResultSchema,
  "레이어 컴프 목록",
);
export const layerCompGetCommand = forward<LayerCompGetParams, LayerCompInfo>(
  LayerCompInfoSchema,
  "레이어 컴프 조회",
);
export const layerCompCreateCommand = forward<LayerCompCreateParams, LayerCompInfo>(
  LayerCompInfoSchema,
  "레이어 컴프 만들기",
);
export const layerCompApplyCommand = forward<LayerCompApplyParams, LayerCompInfo>(
  LayerCompInfoSchema,
  "레이어 컴프 적용",
);
export const layerCompRecaptureCommand = forward<LayerCompRecaptureParams, LayerCompInfo>(
  LayerCompInfoSchema,
  "레이어 컴프 다시 기록",
);
export const layerCompDeleteCommand = forward<LayerCompDeleteParams, LayerCompDeleteResult>(
  LayerCompDeleteResultSchema,
  "레이어 컴프 삭제",
);
