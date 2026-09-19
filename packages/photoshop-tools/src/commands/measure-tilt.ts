import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 경계선 기울기 측정. (ROADMAP §17.21)
 *
 * ## 왜 필요했나
 *
 * `document.rotate`(§17.19)를 만들어 놓고 **그 입력을 만들 방법이 저장소 안에
 * 없었다.** 수평선 기울기를 잴 때마다 캡처를 밖으로 내보내 PowerShell 로
 * Theil-Sen 을 새로 짰다. 세 번 반복했고 한 번은 변수 이름이 충돌해 틀렸다.
 *
 * ## **각도만 돌려주지 않는다**
 *
 * 실기에서 세 번 쟀고 **두 번은 돌리지 않는 것이 답이었다.**
 *
 * ```text
 * 논둑    −1.816°   잔차 IQR 24.6px   직선이 아니었다
 * 종탑     8.366°   잔차 IQR 13.5px   직선이 아니었다
 * 갯벌    −1.873°   잔차 IQR  3.9px   직선이었다 — 교정함
 * ```
 *
 * 세 번 다 그럴듯한 각도가 나왔다. 가른 것은 잔차다. 각도만 돌려주는 Tool 은
 * **멀쩡한 사진을 돌리게 만든다.**
 *
 * ## 그런데 "믿어도 되는가" 는 담지 않는다
 *
 * `reliable: boolean` 을 만들지 않았다. 임계가 영역 크기에 따라 달라지기
 * 때문이다 — 900px 폭에서 잔차 4px 와 5000px 폭에서 4px 는 다른 이야기다.
 *
 * 대신 `spanPixels` 와 `risePixels` 를 함께 준다. 잔차를 **경계가 실제로
 * 오르내린 높이와 견주어** 읽으면 크기에 휘둘리지 않는다. 임계를 짐작해 박는
 * 것보다 근거를 함께 주는 편이 낫다. (`rawBitDepth` 와 같은 태도)
 */

export const MEASURE_TILT = "MEASURE_TILT";

const BoundsSchema = z
  .object({
    left: z.number().int().min(0),
    top: z.number().int().min(0),
    right: z.number().int().min(1),
    bottom: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.right <= value.left) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["right"],
        message: "right 는 left 보다 커야 합니다.",
      });
    }
    if (value.bottom <= value.top) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bottom"],
        message: "bottom 은 top 보다 커야 합니다.",
      });
    }
  });

export const MeasureTiltParamsSchema = z
  .object({
    /**
     * 잴 영역. **경계선 하나만 들어오게 잡는다.**
     *
     * 넓게 잡으면 섬·건물·전봇대가 섞여 잔차가 커진다. 그 자체가 정보이긴
     * 하지만, 잴 수 있는 곳이 있는데도 못 재는 결과가 된다.
     */
    bounds: BoundsSchema,
    /**
     * `horizontal` (기본) — 수평선처럼 가로로 뻗은 경계. 열마다 경계 y 를 찾는다.
     * `vertical` — 기둥·벽처럼 세로로 뻗은 경계. 행마다 경계 x 를 찾는다.
     */
    direction: z.enum(["horizontal", "vertical"]).optional(),
    /**
     * 경계로 인정할 최소 대비(0–255). 기본 20.
     *
     * 낮추면 희미한 경계도 잡지만 노이즈를 경계로 읽기 시작한다.
     */
    minContrast: z.number().min(1).max(255).optional(),
    /**
     * 레이어 하나만 잰다. 생략하면 합성 결과.
     *
     * **보정이 쌓인 뒤에는 원본 레이어를 지정한다.** 톤을 올리고 광해를 뺀
     * 합성에서는 경계 대비가 낮아져 측정이 어렵다 — 실기에서 1000열 중 83열만
     * 경계를 찾았고 잔차가 경계 높이보다 컸다.
     *
     * 조정 레이어와 그룹은 거절한다. 잴 픽셀이 없다.
     */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type MeasureTiltParams = z.infer<typeof MeasureTiltParamsSchema>;

export const MeasureTiltResultSchema = z.object({
  /** 기울기(도). **시계 방향이 양수**로, `document.rotate` 와 같은 규약이다. */
  angleDegrees: z.number(),
  /** 픽셀당 픽셀 기울기. */
  slope: z.number(),
  /** 잔차 절대값의 사분위 범위(px). **직선성의 척도다.** */
  residualIqr: z.number(),
  residualMedian: z.number(),
  /** 잔차 최대(px). 이것만 크면 이상치가 남은 것이고 IQR 이 크면 선 자체가 휘었다. */
  residualMax: z.number(),
  /** 실제로 쓴 표본 수. 500을 넘으면 균등 간격으로 솎는다. */
  samples: z.number().int(),
  /** 표본이 걸친 폭(px). */
  spanPixels: z.number(),
  /** 그 폭에서 경계가 오르내린 높이(px). 잔차를 이 값과 견주어 읽는다. */
  risePixels: z.number(),
  direction: z.string(),
  /** 무엇을 쟀는지. `composite` 또는 `layer:<id>`. */
  source: z.string(),
  /** 검사한 줄 수. */
  linesTotal: z.number().int(),
  /** 그중 경계를 찾은 줄 수. 너무 적으면 영역이나 minContrast 가 잘못됐다. */
  linesWithEdge: z.number().int(),
  elapsedMs: z.number().int(),
});

export type MeasureTiltResult = z.infer<typeof MeasureTiltResultSchema>;

export const measureTiltCommand: CommandHandler<MeasureTiltParams, MeasureTiltResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = MeasureTiltResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "기울기 측정 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
