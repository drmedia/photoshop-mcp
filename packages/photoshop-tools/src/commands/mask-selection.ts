import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 4 마스크와 선택 영역. (ROADMAP §8.1, §8.2)
 *
 * 마스크는 비파괴다. 픽셀을 지우는 대신 가린다.
 * 마스크 삭제는 넣지 않는다 — 가려둔 작업을 잃으므로 destructive 에 가깝고
 * Permission System 과 함께 검토한다. (ROADMAP §7.4)
 */

export const MASK_CREATE = "MASK_CREATE";
export const MASK_ENABLE = "MASK_ENABLE";
export const MASK_DISABLE = "MASK_DISABLE";
export const SELECTION_CLEAR = "SELECTION_CLEAR";
export const SELECTION_INVERT = "SELECTION_INVERT";

/** 대상 레이어. 생략하면 활성 레이어. */
const TargetLayer = z.number().int().optional();

export const MaskCreateParamsSchema = z
  .object({
    layerId: TargetLayer,
    /**
     * 마스크 초기 상태.
     *
     * - `revealAll` (기본) — 전부 흰색. 아무것도 가리지 않는다
     * - `hideAll` — 전부 검은색. 전부 가린다
     * - `fromSelection` — 현재 선택 영역을 마스크로 쓴다. 선택이 없으면 실패한다
     */
    from: z.enum(["revealAll", "hideAll", "fromSelection"]).optional(),
  })
  .strict();

export const MaskToggleParamsSchema = z.object({ layerId: TargetLayer }).strict();
export const SelectionParamsSchema = z.object({}).strict();

export type MaskCreateParams = z.infer<typeof MaskCreateParamsSchema>;
export type MaskToggleParams = z.infer<typeof MaskToggleParamsSchema>;
export type SelectionParams = z.infer<typeof SelectionParamsSchema>;

/** 선택 영역 Command 결과. 레이어를 바꾸지 않으므로 선택 상태만 알린다. */
export interface SelectionResult {
  /** 실행 후 선택 영역이 남아 있는지. */
  hasSelection: boolean;
}

const SelectionResultSchema = z.object({ hasSelection: z.boolean() });

/** 마스크 Command 는 대상 레이어의 변경 후 상태를 돌려준다. */
function forwardLayer<TParams>(): CommandHandler<TParams, LayerInfo> {
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

function forwardSelection<TParams>(): CommandHandler<TParams, SelectionResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = SelectionResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 스키마를 만족하지 않습니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

export const maskCreateCommand = forwardLayer<MaskCreateParams>();
export const maskEnableCommand = forwardLayer<MaskToggleParams>();
export const maskDisableCommand = forwardLayer<MaskToggleParams>();
export const selectionClearCommand = forwardSelection<SelectionParams>();
export const selectionInvertCommand = forwardSelection<SelectionParams>();
