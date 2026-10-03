import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 이 세션이 만든 레이어. (ROADMAP §101)
 *
 * 보정 시험을 하면 임시 레이어가 열 장 넘게 쌓인다. `layer.delete` 는 id 를 하나하나 골라야
 * 하고 `destructive` 라 기본 허용 밖이다. 여기서는 **이 서버의 Command 가 만든 것**만 다룬다 —
 * 사용자가 손으로 만든 레이어와 원래 있던 레이어는 이 통로로 지울 수 없다.
 *
 * ## `edit` 인 이유
 *
 * 지우는 범위가 "이 서버가 방금 만든 것" 으로 한정되어 사용자의 작업이 사라지지 않는다. 기록은
 * 플러그인 메모리에 있어 플러그인을 다시 띄우면 잊는다 — 잊은 것은 지울 수 없을 뿐 잘못 지우지
 * 않는다.
 */

export const LAYER_LIST_CREATED = "LAYER_LIST_CREATED";
export const LAYER_DELETE_CREATED = "LAYER_DELETE_CREATED";

export const LayerListCreatedParamsSchema = z.object({}).strict();

export const LayerListCreatedResultSchema = z.object({
  documentId: z.number().int(),
  /** 지금도 문서에 있는, 이 세션이 만든 레이어. */
  layers: z.array(z.object({ id: z.number().int(), name: z.string() })),
});
export type LayerListCreatedResult = z.infer<typeof LayerListCreatedResultSchema>;

export const LayerDeleteCreatedParamsSchema = z
  .object({
    /** 생략하면 이 세션이 만든 것 전부. 주면 그 가운데서만 지운다. */
    layerIds: z.array(z.number().int().positive()).min(1).max(50).optional(),
  })
  .strict();
export type LayerDeleteCreatedParams = z.infer<typeof LayerDeleteCreatedParamsSchema>;

export const LayerDeleteCreatedResultSchema = z.object({
  deleted: z.array(z.number().int()),
  failed: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  /** 요청했지만 이 세션이 만든 것이 아니라 건드리지 않은 id. */
  notCreated: z.array(z.number().int()),
  remaining: z.number().int(),
});
export type LayerDeleteCreatedResult = z.infer<typeof LayerDeleteCreatedResultSchema>;

function parse<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export const layerListCreatedCommand: CommandHandler<
  z.infer<typeof LayerListCreatedParamsSchema>,
  LayerListCreatedResult
> = async (command, context) =>
  parse(
    LayerListCreatedResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    "생성 레이어 목록",
  );

export const layerDeleteCreatedCommand: CommandHandler<
  LayerDeleteCreatedParams,
  LayerDeleteCreatedResult
> = async (command, context) =>
  parse(
    LayerDeleteCreatedResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    "생성 레이어 삭제",
  );
