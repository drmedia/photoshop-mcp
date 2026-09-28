import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 조정 레이어 넷 — 노출 · 흑백 · 포토 필터 · 채널 혼합. (ROADMAP §52)
 *
 * descriptor 는 전부 `["all"]` 알림으로 잡았다. 범위는 Photoshop 패널의
 * 슬라이더 범위다 — **descriptor 의미를 짐작한 것이 아니라 눈에 보이는 값**이다.
 */

export const ADJUSTMENT_EXPOSURE = "ADJUSTMENT_EXPOSURE";
export const ADJUSTMENT_BLACK_WHITE = "ADJUSTMENT_BLACK_WHITE";
export const ADJUSTMENT_PHOTO_FILTER = "ADJUSTMENT_PHOTO_FILTER";
export const ADJUSTMENT_CHANNEL_MIXER = "ADJUSTMENT_CHANNEL_MIXER";

const LayerName = z.string().trim().min(1).max(200).optional();

export const AdjustmentExposureParamsSchema = z
  .object({
    /** 노출(스톱). 패널 범위는 −20 ~ 20. */
    exposure: z.number().min(-20).max(20).optional(),
    /** 오프셋. 패널 범위는 −0.5 ~ 0.5. 그림자를 들어올린다. */
    offset: z.number().min(-0.5).max(0.5).optional(),
    /** 감마. 패널 범위는 0.01 ~ 9.99. **`gamma` 가 아니다.** */
    gammaCorrection: z.number().min(0.01).max(9.99).optional(),
    name: LayerName,
  })
  .strict();

/** 흑백의 여섯 색. 패널 범위는 −200 ~ 300. */
const BwChannel = z.number().min(-200).max(300).optional();

export const AdjustmentBlackWhiteParamsSchema = z
  .object({
    red: BwChannel,
    yellow: BwChannel,
    /** Photoshop descriptor 에서는 `grain` 이다. 경계에서 바꾼다. */
    green: BwChannel,
    cyan: BwChannel,
    blue: BwChannel,
    magenta: BwChannel,
    /** 색조 입히기. **`tint` 가 아니라 `useTint` 다.** 색은 Photoshop 기본값이다. */
    useTint: z.boolean().optional(),
    name: LayerName,
  })
  .strict();

export const AdjustmentPhotoFilterParamsSchema = z
  .object({
    /**
     * 필터 색. **Lab 이다.**
     *
     * 패널의 드롭다운(Warming Filter 85 등)은 descriptor 에 이름으로 나가지
     * 않고 Lab 색으로 나간다 — 실기에서 드롭다운을 바꿔 잡은 값이 그랬다.
     */
    color: z
      .object({
        luminance: z.number().min(0).max(100),
        a: z.number().min(-128).max(127),
        b: z.number().min(-128).max(127),
      })
      .strict()
      .optional(),
    /** 농도(%). 패널 범위는 1 ~ 100. */
    density: z.number().min(1).max(100).optional(),
    /** 광도 유지. 켜면 색만 옮기고 밝기는 그대로 둔다. */
    preserveLuminosity: z.boolean().optional(),
    name: LayerName,
  })
  .strict();

/** 출력 채널 하나의 혼합비(%). 패널 범위는 소스 −200 ~ 200, 상수 −200 ~ 200. */
const ChannelMixSchema = z
  .object({
    red: z.number().min(-200).max(200).optional(),
    green: z.number().min(-200).max(200).optional(),
    blue: z.number().min(-200).max(200).optional(),
    constant: z.number().min(-200).max(200).optional(),
  })
  .strict();

export const AdjustmentChannelMixerParamsSchema = z
  .object({
    /** 단색. **descriptor 키는 `monochromatic` 이고 `gray` 와 짝이다.** */
    monochrome: z.boolean().optional(),
    red: ChannelMixSchema.optional(),
    green: ChannelMixSchema.optional(),
    blue: ChannelMixSchema.optional(),
    /** 단색일 때의 행렬. `monochrome: true` 와 함께만 쓴다. */
    gray: ChannelMixSchema.optional(),
    name: LayerName,
  })
  .strict()
  /* **두 모드를 섞으면 Photoshop 이 오류 없이 한쪽만 쓴다.** 스키마에서도 막아
   * 플러그인까지 가기 전에 답을 준다. */
  .superRefine((value, ctx) => {
    const mono = value.monochrome === true;
    const hasColor =
      value.red !== undefined || value.green !== undefined || value.blue !== undefined;
    if (mono && hasColor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "monochrome 일 때는 gray 만 줍니다. red · green · blue 는 쓰이지 않습니다.",
      });
    }
    if (!mono && value.gray !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "gray 는 monochrome: true 일 때만 쓰입니다.",
      });
    }
  });

export type AdjustmentExposureParams = z.infer<typeof AdjustmentExposureParamsSchema>;
export type AdjustmentBlackWhiteParams = z.infer<typeof AdjustmentBlackWhiteParamsSchema>;
export type AdjustmentPhotoFilterParams = z.infer<typeof AdjustmentPhotoFilterParamsSchema>;
export type AdjustmentChannelMixerParams = z.infer<typeof AdjustmentChannelMixerParamsSchema>;

function forwardLayer<TParams>(): CommandHandler<TParams, LayerInfo> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = LayerInfoSchema.safeParse(raw);
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

export const adjustmentExposureCommand = forwardLayer<AdjustmentExposureParams>();
export const adjustmentBlackWhiteCommand = forwardLayer<AdjustmentBlackWhiteParams>();
export const adjustmentPhotoFilterCommand = forwardLayer<AdjustmentPhotoFilterParams>();
export const adjustmentChannelMixerCommand = forwardLayer<AdjustmentChannelMixerParams>();
