import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Camera Raw 필터. (ROADMAP §17.17)
 *
 * ## 왜 하나뿐인가
 *
 * 슬라이더마다 Tool 을 두지 않는다. **Camera Raw 는 슬라이더들이 한 렌더링
 * 파이프라인 안에서 함께 계산되고**, 한 번 걸 때마다 픽셀이 구워진다.
 * 나눠서 걸면 이미 구워진 결과 위에 다시 거는 것이라 결과가 달라진다.
 *
 * 실기에서 잰 값이다. 같은 네 설정을 한 번에 건 것과 네 번 나눠 건 것 —
 *
 * ```text
 *              p5      p50     p95     평균
 * 원본          7.7    13.9    60.5    21.16
 * 한 번에      11.7    30.8   130.4    44.77
 * 네 번 나눠   13.9    36.6   124.0    48.01
 * ```
 *
 * p50 이 19% 어긋나고 하이라이트는 오히려 덜 눌렸다. 게다가 24MP 를 네 번 처리하고
 * History 도 네 단계가 된다.
 *
 * `basic` · `detail` 같은 묶음 Tool 도 두지 않는다. 둘을 이어 부르면 **똑같이 두 번
 * 구워진다.** 도구가 그 실수를 못 하게 막는 편이 낫다.
 *
 * ## descriptor 는 플러그인이 조립한다
 *
 * 호출자는 `exposure` 를 주고 `$Ex12` 를 모른다. batchPlay descriptor 를 넘기는
 * 통로를 만들지 않는다. (ARCHITECTURE §23)
 *
 * 키는 실기에서 `addNotificationListener(["all"])` 로 잡아낸 것이다.
 * 짐작한 이름이 하나도 없다.
 */

export const CAMERA_RAW_APPLY = "CAMERA_RAW_APPLY";

/** ±100 슬라이더. Camera Raw UI 의 범위다. */
const Slider = z.number().int().min(-100).max(100);
/** 0–100 슬라이더. */
const Amount = z.number().int().min(0).max(100);

export const CameraRawParamsSchema = z
  .object({
    /** 대상 레이어. 생략하면 활성 레이어. **숨긴 레이어는 거절한다.** */
    layerId: z.number().int().positive().optional(),

    // ── 기본 ─────────────────────────────────────────────
    /**
     * 노출. −5 ~ +5, 0.01 단위.
     *
     * **이 값만 실수다.** 정수로 나가면 Photoshop 이 조용히 무시한다 — 성공을
     * 돌려주면서 아무것도 안 한다. 빌더가 강제한다.
     */
    exposure: z.number().min(-5).max(5).optional(),
    /** 색온도. **켈빈이 아니다** — 필터는 픽셀에 걸리므로 −100 ~ +100 상대값이다. */
    temperature: Slider.optional(),
    tint: Slider.optional(),
    contrast: Slider.optional(),
    highlights: Slider.optional(),
    shadows: Slider.optional(),
    whites: Slider.optional(),
    blacks: Slider.optional(),
    texture: Slider.optional(),
    clarity: Slider.optional(),
    dehaze: Slider.optional(),
    vibrance: Slider.optional(),
    saturation: Slider.optional(),

    // ── 세부: 노이즈 ──────────────────────────────────────
    /** 휘도 노이즈 감소. 실기에서 σ 6.722 → 3.418 (49%). */
    noiseReduction: Amount.optional(),
    noiseDetail: Amount.optional(),
    noiseContrast: Amount.optional(),
    /** 색상 노이즈 감소. */
    colorNoiseReduction: Amount.optional(),
    colorNoiseDetail: Amount.optional(),
    colorNoiseSmoothness: Amount.optional(),

    // ── 효과 ─────────────────────────────────────────────
    grainAmount: Amount.optional(),
    grainSize: Amount.optional(),
    grainRoughness: Amount.optional(),
    vignetteAmount: Slider.optional(),
    vignetteMidpoint: Amount.optional(),
    vignetteFeather: Amount.optional(),
    vignetteRoundness: Slider.optional(),

    // ── 색상 혼합 (HSL). (ROADMAP §17.29) ─────────────────
    //
    // 색상별 조정이다. 전역 `vibrance` · `saturation` 과 달리 **특정 색만**
    // 건드린다 — 야경에서 조명색만 살리고 하늘은 두는 식이다.
    //
    // 키 24개는 알림 캡처로 확인했다. 짐작한 것이 하나도 없다.
    /** 색조. */
    hueRed: Slider.optional(),
    hueOrange: Slider.optional(),
    hueYellow: Slider.optional(),
    hueGreen: Slider.optional(),
    hueAqua: Slider.optional(),
    hueBlue: Slider.optional(),
    huePurple: Slider.optional(),
    hueMagenta: Slider.optional(),

    /** 채도. */
    saturationRed: Slider.optional(),
    saturationOrange: Slider.optional(),
    saturationYellow: Slider.optional(),
    saturationGreen: Slider.optional(),
    saturationAqua: Slider.optional(),
    saturationBlue: Slider.optional(),
    saturationPurple: Slider.optional(),
    saturationMagenta: Slider.optional(),

    /** 광도. */
    luminanceRed: Slider.optional(),
    luminanceOrange: Slider.optional(),
    luminanceYellow: Slider.optional(),
    luminanceGreen: Slider.optional(),
    luminanceAqua: Slider.optional(),
    luminanceBlue: Slider.optional(),
    luminancePurple: Slider.optional(),
    luminanceMagenta: Slider.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // 설정이 하나도 없으면 아무것도 안 하고 성공을 돌려주게 된다.
    // 호출자는 적용됐다고 믿는다 — 가장 나쁜 실패다.
    const settings = Object.entries(value).filter(([key]) => key !== "layerId");
    if (settings.every(([, entry]) => entry === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "적용할 설정이 하나도 없습니다. 최소 한 가지는 지정하세요.",
        path: ["exposure"],
      });
    }
  });

export type CameraRawParams = z.infer<typeof CameraRawParamsSchema>;

export const CameraRawResultSchema = z.object({
  layer: LayerInfoSchema,
  /**
   * 실제로 보낸 설정 이름들.
   *
   * 요청한 것과 다르면 무언가 빠진 것이다. 조용히 무시되는 값이 있는 필터라
   * 이것을 돌려준다.
   */
  applied: z.array(z.string()),
});

export type CameraRawResult = z.infer<typeof CameraRawResultSchema>;

export const cameraRawApplyCommand: CommandHandler<CameraRawParams, CameraRawResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = CameraRawResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "Camera Raw 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data as { layer: LayerInfo; applied: string[] };
};
