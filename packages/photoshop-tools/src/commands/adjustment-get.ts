import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { AdjustmentSettingsSchema, parseAdjustmentSettings } from "./adjustment-settings.js";

/**
 * 조정 레이어가 가진 값을 읽는다. (ROADMAP §96)
 *
 * 보정 루프의 첫 단계("이미 걸린 보정을 읽는다")를 뒷받침한다. 이 Tool 이 없던 동안에는 기존 보정이
 * 무엇을 했는지 마스크로 짐작해야 했다(§95).
 *
 * ## 플러그인은 원본만 주고 서버가 해석한다
 *
 * Plugin 은 실행 Agent 다(CLAUDE.md 의존 방향 6). descriptor 를 읽기 쉬운 값으로 옮기는 계산은 서버에
 * 두어 Photoshop 없이 실제 descriptor 로 시험한다.
 */

export const ADJUSTMENT_GET = "ADJUSTMENT_GET";

export const AdjustmentGetParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type AdjustmentGetParams = z.infer<typeof AdjustmentGetParamsSchema>;

/** 플러그인이 돌려주는 모양. */
const PluginAdjustmentSchema = z.object({
  layer: LayerInfoSchema,
  isAdjustment: z.boolean(),
  raw: z.unknown(),
});

export const AdjustmentInfoSchema = PluginAdjustmentSchema.extend({
  /**
   * 해석한 값. **곡선과 색조·채도만** 옮긴다 — 실기에서 모양을 확인한 종류다. 나머지 종류와 읽지 못한
   * 경우는 `null` 이고 `raw` 만 있다.
   */
  settings: AdjustmentSettingsSchema,
});

export type AdjustmentInfo = z.infer<typeof AdjustmentInfoSchema>;

export const adjustmentGetCommand: CommandHandler<AdjustmentGetParams, AdjustmentInfo> = async (
  command,
  context,
) => {
  const received = await context.bridge.executeCommand<unknown>(command);
  const parsed = PluginAdjustmentSchema.safeParse(received);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      "조정 레이어 읽기 결과가 예상과 다릅니다.",
      { details: { issues: parsed.error.issues }, cause: parsed.error },
    );
  }
  return { ...parsed.data, settings: parseAdjustmentSettings(parsed.data.raw) };
};
