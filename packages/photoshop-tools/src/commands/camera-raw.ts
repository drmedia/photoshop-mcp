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

/** 곡선의 범위 분할점. 0–100. 기본은 25 · 50 · 75 다. */
const Split = z.number().int().min(0).max(100);

/**
 * 포인트 곡선의 한 점. 입력·출력 모두 0–255 다.
 *
 * **평탄 배열이 아니라 점으로 받는다.** `[0, 0, 255]` 같은 홀수 길이가
 * 조용히 통과하는 상태를 만들지 않기 위해서다.
 */
const CurvePoint = z
  .object({
    x: z.number().int().min(0).max(255),
    y: z.number().int().min(0).max(255),
  })
  .strict();

/**
 * 포인트 곡선.
 *
 * x 가 **엄격히 증가**해야 한다. 같거나 줄어들면 Camera Raw 가 어떻게 받는지
 * 확인하지 않았고, 짐작해서 통과시키지 않는다.
 */
const Curve = z
  .array(CurvePoint)
  .min(2)
  .max(16)
  .superRefine((points, ctx) => {
    for (let index = 1; index < points.length; index += 1) {
      if ((points[index] as { x: number }).x <= (points[index - 1] as { x: number }).x) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "x"],
          message: "x 는 엄격히 증가해야 합니다.",
        });
        return;
      }
    }
  });
/** 0–100 슬라이더. */
const Amount = z.number().int().min(0).max(100);

/**
 * 국소 보정의 마스크. (ROADMAP §67)
 *
 * **좌표는 0–1 정규화**이고 문서 왼쪽 위가 (0,0) 이다. 캔버스 밖으로
 * 나갈 수 있어 **음수를 막지 않는다** — 실기에서 −0.707 을 봤다.
 * 범위 제한은 잰 값이 아니라 **터무니없는 입력을 막는 울타리**다.
 */
const Coord = z.number().min(-10).max(10);

/** 선형. 두 점으로 방향과 길이를 정한다. */
const LinearMaskSchema = z
  .object({
    type: z.literal("linearGradient"),
    /** 효과가 0 인 쪽. */
    from: z.object({ x: Coord, y: Coord }).strict(),
    /** 효과가 100% 인 쪽. */
    to: z.object({ x: Coord, y: Coord }).strict(),
    inverted: z.boolean().optional(),
    name: z.string().min(1).max(255).optional(),
  })
  .strict();

/**
 * 방사형. (ROADMAP §68)
 *
 * **중심과 반지름이 아니라 경계 상자다** — `photoshop.mask.gradient` 의
 * `radial` 과 모양이 다르다. 그쪽은 중심에서 반지름으로 준다.
 */
const RadialMaskSchema = z
  .object({
    type: z.literal("radialGradient"),
    bounds: z.object({ top: Coord, left: Coord, bottom: Coord, right: Coord }).strict(),
    /** 타원의 회전. 도. */
    angle: z.number().min(-360).max(360).optional(),
    /** 가장자리 부드러움. 0–100. 생략하면 50. */
    feather: z.number().int().min(0).max(100).optional(),
    /** 모서리 둥글기. −100~100. 생략하면 0. */
    roundness: z.number().int().min(-100).max(100).optional(),
    inverted: z.boolean().optional(),
    name: z.string().min(1).max(255).optional(),
  })
  .strict();

/** 범위·AI 마스크는 아직 안 쟀다. **모르는 종류를 조용히 떨어뜨리지 않는다.** */
const LocalMaskSchema = z.discriminatedUnion("type", [LinearMaskSchema, RadialMaskSchema]);

/** ±100 국소 슬라이더. */
const Local = z.number().int().min(-100).max(100);

/**
 * 국소 보정 하나.
 *
 * **슬라이더는 Camera Raw UI 에 보이는 값 그대로 준다.** 저장은 ±1 로
 * 정규화되지만 나누는 수가 슬라이더마다 달라(노출 ÷4 · 색조 ÷180 · 나머지
 * ÷100) 플러그인이 변환한다. 호출자가 그 눈금을 알 필요가 없다.
 */
const LocalCorrectionSchema = z
  .object({
    mask: LocalMaskSchema,
    name: z.string().min(1).max(255).optional(),
    /**
     * 보정 전체의 배율. **100 이 기본이고 100 을 넘을 수 있다.**
     * 슬라이더를 하나씩 올리는 대신 이것으로 세기를 한꺼번에 조절한다.
     */
    amount: z.number().int().min(0).max(200).optional(),

    /** **EV 다.** 전역 exposure 와 범위가 다르다 — 이쪽은 ±4 다. */
    exposure: z.number().min(-4).max(4).optional(),
    contrast: Local.optional(),
    highlights: Local.optional(),
    shadows: Local.optional(),
    whites: Local.optional(),
    blacks: Local.optional(),
    clarity: Local.optional(),
    texture: Local.optional(),
    dehaze: Local.optional(),
    grain: Local.optional(),
    glow: Local.optional(),
    sharpness: Local.optional(),
    luminanceNoise: Local.optional(),
    moire: Local.optional(),
    defringe: Local.optional(),
    temperature: Local.optional(),
    tint: Local.optional(),
    saturation: Local.optional(),
    /** **각도다.** ±180 이고 전역 색상 혼합의 hue* 와 다른 물건이다. */
    hue: z.number().int().min(-180).max(180).optional(),
  })
  .strict();

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

    /**
     * 국소 보정. (ROADMAP §67)
     *
     * **마스크를 씌운 보정을 전역 설정과 한 번에 건다.** Camera Raw 안에서
     * 함께 계산되므로 레이어를 따로 만들어 거는 것과 결과가 다르다 —
     * 그쪽은 굽는 횟수가 늘어난다.
     *
     * **부를 때마다 통째로 바뀐다.** `$LCs` 가 덩어리 하나여서 앞서 건
     * 국소 보정은 사라진다. 전역 설정과 같은 규칙이다.
     *
     * 스마트 오브젝트에 걸면 나중에 값만 고칠 수 있고,
     * photoshop.smart_object.get_info 의 raw.filterFX 로 되읽을 수 있다.
     */
    localCorrections: z.array(LocalCorrectionSchema).min(1).max(10).optional(),

    // ── 세부: 샤픈. (ROADMAP §64) ─────────────────────────
    //
    // **descriptor 키 `sharpen` 에 `$` 가 없다** — `saturation` · `curve` 에
    // 이은 세 번째 예외다. 캡처로 확인했고 짐작한 것이 아니다.
    //
    // 노이즈 감소와 **같은 패널이고 서로를 상쇄한다** — 노이즈를 줄이면
    // 디테일이 뭉개지고 샤픈은 노이즈까지 키운다. 한 번에 함께 거는 것이
    // 이 Tool 이 하나인 이유다.
    /** 샤픈 양. 0–150. Camera Raw UI 의 '양'. */
    sharpenAmount: z.number().int().min(0).max(150).optional(),
    /**
     * 샤픈 반경. **0.5–3.0 실수.**
     *
     * 정수를 줘도 받지만 빌더가 실수로 밀어 보낸다 — `exposure` 가 정수면
     * 조용히 무시되는 것을 겪었고, 확인 전까지 안전한 쪽을 고른다.
     */
    sharpenRadius: z.number().min(0.5).max(3).optional(),
    /** 샤픈 세부. 0–100. 높을수록 미세한 질감까지 세운다. */
    sharpenDetail: z.number().int().min(0).max(100).optional(),
    /**
     * 샤픈 마스킹. 0–100.
     *
     * **가장자리가 아닌 평탄한 영역을 샤픈에서 뺀다.** 하늘처럼 고른 면의
     * 노이즈가 같이 서는 것을 막는다 — 천체사진에서 이것이 핵심이다.
     */
    sharpenMasking: z.number().int().min(0).max(100).optional(),

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

    // ── 곡선: 파라메트릭. (ROADMAP §17.30) ────────────────
    //
    // 이름은 Camera Raw UI 그대로다. 기본·세부의 highlights/shadows 와는 **다른
    // 것이다** — 저쪽은 톤 범위를 직접 밀고 이쪽은 곡선의 해당 구간을 구부린다.
    curveHighlights: Slider.optional(),
    curveLights: Slider.optional(),
    curveDarks: Slider.optional(),
    curveShadows: Slider.optional(),

    /** 곡선 구간의 경계. 기본 25 · 50 · 75. */
    curveShadowSplit: Split.optional(),
    curveMidtoneSplit: Split.optional(),
    curveHighlightSplit: Split.optional(),

    /**
     * RGB 포인트 곡선의 **채도 미세 조정**. 0–100, 기본 100.
     *
     * 곡선으로 대비를 올리면 채도가 함께 오르는데 그 양을 조절한다.
     * 낮추면 대비만 오르고 색은 덜 따라온다.
     */
    curveRefineSaturation: Split.optional(),

    // ── 곡선: 포인트 ─────────────────────────────────────
    //
    // 점 목록으로 준다. 끝점(0,0)·(255,255)을 강제하지 않는다 — Camera Raw 가
    // 낸 descriptor 에는 있었지만 필수인지 확인하지 않았다.
    /** RGB 합성 곡선. */
    curveRgb: Curve.optional(),
    curveRed: Curve.optional(),
    curveGreen: Curve.optional(),
    curveBlue: Curve.optional(),

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
  /**
   * 이 레이어에 쌓인 Camera Raw 스마트 필터의 개수. (ROADMAP §67)
   *
   * **스마트 오브젝트에서는 필터가 덮이지 않고 쌓인다.** 2 이상이면 같은
   * 보정이 여러 번 먹고 있다는 뜻이다 — 실기에서 노출 +3 이 두 번 걸려
   * 하이라이트 19.7% 가 날아갔다.
   *
   * 스마트 오브젝트가 아니면 0 이고, 읽지 못하면 `null` 이다.
   */
  smartFilterCount: z.number().int().nullable(),
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
  return parsed.data as {
    layer: LayerInfo;
    applied: string[];
    smartFilterCount: number | null;
  };
};
