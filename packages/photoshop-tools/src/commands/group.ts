import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 3 그룹 Command. (ROADMAP §7.2)
 *
 * 그룹 해제(ungroup)는 넣지 않는다. 자식 레이어의 위치를 바꾸므로
 * 되돌리기 어려운 구조 변경이고, Permission System 과 함께 검토한다. (ROADMAP §7.4)
 */

export const GROUP_CREATE = "GROUP_CREATE";
export const GROUP_MOVE_LAYER = "GROUP_MOVE_LAYER";

const GroupName = z.string().trim().min(1).max(255);

export const GroupCreateParamsSchema = z
  .object({
    name: GroupName.optional(),
    /** 그룹에 넣을 레이어. 생략하면 빈 그룹을 만든다. */
    layerIds: z.array(z.number().int()).min(1).optional(),
    /**
     * 새 그룹을 **어디에** 만들지. (ROADMAP §17.20)
     *
     * - 생략 또는 `null` — **최상위.** 이것이 기본이다
     * - 그룹 id — 그 그룹 안
     *
     * `layerIds` 와 함께 쓸 수 없다. 레이어를 묶을 때는 그 레이어들이 있던
     * 자리에 그룹이 생기는 것이 맞고, 위치를 따로 주면 둘이 충돌한다.
     *
     * ## 왜 기본이 최상위인가
     *
     * Photoshop 은 **활성 레이어가 있는 곳**에 새 그룹을 만든다. 활성 레이어가
     * 어느 그룹 안이면 새 그룹도 그 안에 들어간다.
     *
     * 실기에서 이것이 조용히 연쇄를 만들었다 — 그룹을 하나 선택한 뒤 새 그룹을
     * 만들었더니 그 안에 들어갔고, 다음 그룹은 다시 그 안에, 마지막에 만든 조정
     * 레이어는 **세 겹 마스크에 갇혀 아무 데도 걸리지 않았다.** 오류는 없었고
     * 반환된 `parentId` 를 읽고서야 알았다.
     *
     * 호출자가 "지금 활성 레이어가 어디 있는지" 를 추적해야 결과를 예측할 수
     * 있는 API 는 조용히 틀린다. 그래서 기본을 **위치에 의존하지 않는 쪽**으로
     * 둔다. 그룹 안에 만들려면 명시한다.
     */
    parentId: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.layerIds !== undefined && value.parentId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["parentId"],
        message:
          "layerIds 와 parentId 는 함께 쓸 수 없습니다. " +
          "레이어를 묶으면 그 레이어들이 있던 자리에 그룹이 생깁니다.",
      });
    }
  });

export const GroupMoveLayerParamsSchema = z
  .object({
    layerId: z.number().int(),
    /** 이동할 그룹. `null` 이면 그룹에서 꺼내 최상위로 옮긴다. */
    groupId: z.number().int().nullable(),
  })
  .strict();

export type GroupCreateParams = z.infer<typeof GroupCreateParamsSchema>;
export type GroupMoveLayerParams = z.infer<typeof GroupMoveLayerParamsSchema>;

/**
 * Bridge 로 전달하고 결과를 검증한다.
 *
 * 편집 Command 와 같은 이유로 결과를 검증한다 — Plugin 은 별도 프로세스이고
 * `executeCommand` 자체에는 검증이 없다.
 */
function forward<TParams>(): CommandHandler<TParams, LayerInfo> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = LayerInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 레이어 스키마를 만족하지 않습니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

/** 만들어진 그룹 레이어를 돌려준다. */
export const groupCreateCommand = forward<GroupCreateParams>();

/** 이동한 레이어를 돌려준다. `parentId` 로 결과를 확인할 수 있다. */
export const groupMoveLayerCommand = forward<GroupMoveLayerParams>();
