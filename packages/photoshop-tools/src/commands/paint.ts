import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { DabSchema } from "./dodge-burn.js";

/**
 * 색 칠하기와 마스크 칠하기. (ROADMAP §17.32)
 *
 * `dodge_burn.dab`(§17.31)이 연 길을 넓힌 것이다. 얼룩은 획 경로가 필요 없어
 * 검증된 파라미터로 조립된다 — 치유 브러시를 만들지 않은 이유(§17.14)가
 * 여기에는 해당하지 않는다.
 *
 * ## `mask.dab` 이 더 중요하다
 *
 * `paint.dab` 은 픽셀을 덮어쓰므로 쓸 자리가 좁다. `mask.dab` 은 **조정 레이어의
 * 마스크**를 다듬으므로 비파괴 보정의 한가운데에 들어간다.
 *
 * 실기에서 은하수 사진의 빛 공해가 한쪽으로 치우쳐 있었는데, 선형·방사형
 * 그라디언트로는 그 형태를 맞출 수 없었다. 합성 픽셀에 닷징으로 덮으면
 * 조정 레이어를 껐다 켤 때 따라오지 않는다. 마스크를 직접 다듬어야 한다.
 */

export const PAINT_DAB = "PAINT_DAB";
export const MASK_DAB = "MASK_DAB";

/** 0–255. */
const ColorSchema = z
  .object({
    red: z.number().int().min(0).max(255),
    green: z.number().int().min(0).max(255),
    blue: z.number().int().min(0).max(255),
  })
  .strict();

const DabsSchema = z.array(DabSchema).min(1).max(200);

export const PaintDabParamsSchema = z
  .object({
    dabs: DabsSchema,
    /** 칠할 색. */
    color: ColorSchema,
    /**
     * 대상 레이어. 생략하면 활성 레이어.
     *
     * **픽셀 레이어여야 하고 배경은 거절한다.** 원본 픽셀을 덮어쓰기 때문이다.
     */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type PaintDabParams = z.infer<typeof PaintDabParamsSchema>;

export const MaskDabParamsSchema = z
  .object({
    dabs: DabsSchema,
    /**
     * `reveal` 은 흰색(보이게), `hide` 는 검정(가리게).
     *
     * 마스크에서 흰색이 보이는 쪽이라는 규칙을 이름으로 드러낸다 — `white`/`black`
     * 으로 두면 호출자가 매번 어느 쪽인지 되짚어야 한다.
     */
    mode: z.enum(["reveal", "hide"]),
    /** 마스크를 가진 레이어. 생략하면 활성 레이어. 조정 레이어도 된다. */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type MaskDabParams = z.infer<typeof MaskDabParamsSchema>;

export const PaintResultSchema = z.object({
  layer: LayerInfoSchema,
  /** 실제로 찍힌 얼룩 수. 중간에 실패하면 요청 수와 다르다. */
  applied: z.number().int(),
});

export type PaintResult = z.infer<typeof PaintResultSchema>;

function forward<TParams>(label: string): CommandHandler<TParams, PaintResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = PaintResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
        details: { issues: parsed.error.issues },
        cause: parsed.error,
      });
    }
    return parsed.data;
  };
}

export const paintDabCommand = forward<PaintDabParams>("칠하기");
export const maskDabCommand = forward<MaskDabParams>("마스크 칠하기");
