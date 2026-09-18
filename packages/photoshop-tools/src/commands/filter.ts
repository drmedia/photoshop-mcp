import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 4 필터. (ROADMAP §8.4)
 *
 * 필터는 픽셀을 직접 바꾸는 파괴적 연산이다. Phase 3~4 의 다른 Command 는
 * 모두 비파괴이므로 기본값을 **스마트 필터**로 잡는다.
 *
 * - 대상이 이미 스마트 오브젝트면 그대로 스마트 필터로 적용한다
 * - 아니면 스마트 오브젝트로 변환한 뒤 적용한다 (`asSmartFilter` 기본 `true`)
 * - `asSmartFilter: false` 를 명시하면 픽셀에 직접 적용한다. 되돌릴 수 없다
 *
 * ROADMAP §8.3 의 "가능하면 Adjustment Layer 방식 우선" 과 같은 취지다.
 */

export const FILTER_GAUSSIAN_BLUR = "FILTER_GAUSSIAN_BLUR";

export const GaussianBlurParamsSchema = z
  .object({
    layerId: z.number().int().optional(),
    /** 흐림 반경(px). Photoshop 의 허용 범위. */
    radius: z.number().min(0.1).max(1000),
    /**
     * 스마트 필터로 적용할지. 기본 `true`.
     *
     * `false` 로 두면 픽셀을 직접 바꾼다. Undo 외에는 되돌릴 수 없다.
     */
    asSmartFilter: z.boolean().optional(),
  })
  .strict();

export type GaussianBlurParams = z.infer<typeof GaussianBlurParamsSchema>;

export const gaussianBlurCommand: CommandHandler<GaussianBlurParams, LayerInfo> = async (
  command,
  context,
) => {
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
