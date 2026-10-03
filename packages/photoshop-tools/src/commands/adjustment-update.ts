import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import {
  AdjustmentBlackWhiteParamsSchema,
  AdjustmentChannelMixerParamsSchema,
  AdjustmentExposureParamsSchema,
  AdjustmentPhotoFilterParamsSchema,
} from "./adjustment-extra.js";
import {
  BrightnessContrastParamsSchema,
  CurvesParamsSchema,
  LevelsParamsSchema,
} from "./adjustment.js";
import { HueSaturationParamsSchema, VibranceParamsSchema } from "./gap-tools.js";
import { ColorBalanceParams } from "./workflow-gaps.js";

/**
 * 이미 걸린 조정 레이어의 값을 고친다. (ROADMAP §101)
 *
 * ## 왜 필요한가
 *
 * 값을 바꿔 보려면 `history.undo` 로 되감아 다시 만들거나 새 레이어를 덧대야 했다. 되감으면
 * 그 사이에 한 다른 편집도 날아가고, 덧대면 레이어가 쌓인다. 조정 레이어는 **고칠 수 있어서**
 * 쓰는 것이다 — 그 능력이 도구에 없었다.
 *
 * ## 값은 만들 때와 같은 모양이다
 *
 * `kind` 가 정하는 `settings` 는 대응하는 `photoshop.adjustment.*` Tool 의 입력과 같다. 새로
 * 배울 것이 없고, 검증도 같은 스키마가 한다. 다만 **이름은 바꾸지 않는다** — `layer.rename` 이 한다.
 *
 * ## 종류를 바꾸지 않는다
 *
 * 곡선 레이어에 색조·채도 값을 넣을 수는 없다. 레이어의 종류가 `kind` 와 다르면 거절한다.
 *
 * ## 고쳤는지 읽어서 답한다
 *
 * `set` 이 오류 없이 끝났다고 값이 바뀐 것은 아니다. 전후 값을 읽어 `changed` 로 돌려준다.
 * 같은 값을 다시 넣으면 `false` 다 — 실패가 아니라 "이미 그렇다" 는 뜻이다.
 */

export const ADJUSTMENT_UPDATE = "ADJUSTMENT_UPDATE";

/** 고칠 수 있는 종류와 값을 검증할 스키마. 만들 때 쓰는 것을 그대로 쓴다. */
const SETTINGS_SCHEMAS = {
  curves: CurvesParamsSchema,
  levels: LevelsParamsSchema,
  brightness_contrast: BrightnessContrastParamsSchema,
  hue_saturation: HueSaturationParamsSchema,
  vibrance: VibranceParamsSchema,
  color_balance: ColorBalanceParams,
  exposure: AdjustmentExposureParamsSchema,
  black_white: AdjustmentBlackWhiteParamsSchema,
  photo_filter: AdjustmentPhotoFilterParamsSchema,
  channel_mixer: AdjustmentChannelMixerParamsSchema,
} as const;

export const ADJUSTMENT_KINDS = Object.keys(SETTINGS_SCHEMAS) as [
  keyof typeof SETTINGS_SCHEMAS,
  ...(keyof typeof SETTINGS_SCHEMAS)[],
];

export const AdjustmentUpdateParamsSchema = z
  .object({
    /** 고칠 조정 레이어. 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
    /** 레이어의 종류. 다르면 거절한다. */
    kind: z.enum(ADJUSTMENT_KINDS),
    /** 대응하는 `photoshop.adjustment.<kind>` Tool 의 입력과 같다. `name` 은 뺀다. */
    settings: z.record(z.string(), z.unknown()),
  })
  .strict();

export type AdjustmentUpdateParams = z.infer<typeof AdjustmentUpdateParamsSchema>;

export const AdjustmentUpdateResultSchema = z.object({
  layer: LayerInfoSchema,
  kind: z.enum(ADJUSTMENT_KINDS),
  /** 읽어서 확인한, 값이 실제로 달라졌는지. */
  changed: z.boolean(),
});

export type AdjustmentUpdateResult = z.infer<typeof AdjustmentUpdateResultSchema>;

export const adjustmentUpdateCommand: CommandHandler<
  AdjustmentUpdateParams,
  AdjustmentUpdateResult
> = async (command, context) => {
  const { layerId, kind, settings } = command.params;

  if ("name" in settings) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      "settings 에 name 을 쓸 수 없습니다. 이름은 photoshop.layer.rename 으로 바꿉니다.",
      { recoverable: true },
    );
  }

  const validated = SETTINGS_SCHEMAS[kind].safeParse(settings);
  if (!validated.success) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `${kind} 값이 올바르지 않습니다: ${validated.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
        .join("; ")}`,
      { recoverable: true, details: { issues: validated.error.issues } },
    );
  }

  const raw = await context.bridge.executeCommand<unknown>({
    ...command,
    params: {
      ...(layerId === undefined ? {} : { layerId }),
      kind,
      settings: validated.data,
    },
  });
  const parsed = AdjustmentUpdateResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      "조정 레이어 수정 결과가 예상과 다릅니다.",
      { details: { issues: parsed.error.issues }, cause: parsed.error },
    );
  }
  return parsed.data;
};
