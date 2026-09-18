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
  })
  .strict();

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
