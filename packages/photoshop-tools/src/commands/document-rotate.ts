import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 문서 회전. (ROADMAP §17.19)
 *
 * ## 왜 필요했나
 *
 * 실기 보정에서 수평선이 **−1.87° 기울어 있는 것을 재 놓고 고치지 못했다.**
 * `document.crop` 은 구도를 사각형으로 덜어낼 뿐 기울기는 손대지 못한다.
 * 기울어진 수평선은 자르기로 절대 풀리지 않는 종류의 문제다.
 *
 * ## 자르기와 나눈다
 *
 * 회전하면 캔버스가 커지고 모서리에 빈 영역이 생긴다. 이것을 한 Tool 에 합치지
 * 않았다 — 자르기는 `document.crop` 이 이미 하고, 합치면 "회전만 하고 직접
 * 구도를 잡고 싶다" 를 할 수 없게 된다.
 *
 * 대신 **빈 영역이 들어오지 않는 최대 직사각형을 결과에 담아** 준다
 * (`safeBounds`). `document.crop` 의 `bounds` 에 그대로 넘기면 된다.
 * 계산은 서버가 한다 — 호출자가 삼각함수를 맞게 쓰기를 기대하지 않는다.
 *
 * ## `edit` 이다
 *
 * 회전은 모든 레이어의 픽셀을 **재보간한다.** 자르기(`delete: false`)와 달리
 * 원래 값이 그대로 남지 않는다는 점에서 더 무겁다.
 *
 * 그래도 `edit` 으로 둔다. History 로 되돌아가고, 필터·결함 제거도 픽셀을
 * 다시 쓰면서 `edit` 이다. §17.12 에서 자르기를 두고 한 판단과 같다 —
 * `destructive` 로 올리면 기본 허용(`read` · `edit`) 밖이라 **기본 설정에서
 * 수평 교정이 막힌다.** 되돌릴 수 있는 일을 막는 것은 과하다.
 *
 * 다만 재보간은 반복하면 쌓인다. 각도를 나눠 여러 번 부르지 않는다.
 */

export const DOCUMENT_ROTATE = "DOCUMENT_ROTATE";

export const DocumentRotateParamsSchema = z
  .object({
    /**
     * 회전 각도(도). **시계 방향이 양수**다.
     *
     * 수평선이 오른쪽으로 올라가 있으면(기울기가 음수) 양수 각도로 내린다.
     * 측정한 기울기가 −1.87° 였다면 `angle: 1.87` 이다.
     *
     * 0 은 거부한다. 아무것도 하지 않으면서 재보간만 일어나는 호출이다.
     *
     * **범위는 −45 ~ 45 다.** 이것은 수평 교정 도구이지 세로/가로를 바꾸는
     * 도구가 아니다. 그리고 이 범위에서는 회전하면 캔버스가 **반드시** 커지므로
     * 플러그인이 "정말 돌아갔는가" 를 크기 변화로 확인할 수 있다 —
     * 180° 를 허용하면 크기가 그대로라 그 확인이 성립하지 않는다.
     */
    angle: z
      .number()
      .min(-45)
      .max(45)
      .refine((value) => value !== 0, { message: "angle 이 0 이면 회전할 것이 없습니다." }),
  })
  .strict();

export type DocumentRotateParams = z.infer<typeof DocumentRotateParamsSchema>;

const BoundsSchema = z.object({
  left: z.number().int(),
  top: z.number().int(),
  right: z.number().int(),
  bottom: z.number().int(),
});

export const DocumentRotateResultSchema = z.object({
  /** 회전 뒤 캔버스 크기. Photoshop 이 잘리지 않게 키운다. */
  width: z.number().int(),
  height: z.number().int(),
  previousWidth: z.number().int(),
  previousHeight: z.number().int(),
  /** 실제로 적용한 각도. */
  angle: z.number(),
  /**
   * 빈 모서리가 들어오지 않는 최대 직사각형. **원본 종횡비를 유지한다.**
   *
   * `document.crop` 의 `bounds` 에 그대로 넘길 수 있다. 회전만 하고 구도를
   * 직접 잡고 싶으면 무시하면 된다.
   */
  safeBounds: BoundsSchema,
  /** 어느 경로로 돌렸는지. DOM 에 API 가 있는지 짐작하지 않고 재서 정한다. */
  method: z.string(),
});

export type DocumentRotateResult = z.infer<typeof DocumentRotateResultSchema>;

/**
 * 회전한 사각형 안에 들어가는 **중앙 정렬·축평행·원본 종횡비** 최대 직사각형.
 *
 * ## 왜 종횡비를 유지하는가
 *
 * 면적만 최대로 잡는 표준 공식은 종횡비가 원본과 달라진다. 수평 교정의 목적은
 * 사진을 바로 세우는 것이지 비율을 바꾸는 것이 아니다. 비율이 필요하면
 * `document.crop` 으로 따로 잡는다.
 *
 * ## 유도
 *
 * 원점을 중심으로 반폭 `W/2` · 반높이 `H/2` 인 사각형을 `θ` 만큼 돌린 도형 안에
 * 점 `(x, y)` 가 있을 조건은
 *
 * ```text
 * |x·cosθ + y·sinθ| ≤ W/2   그리고   |−x·sinθ + y·cosθ| ≤ H/2
 * ```
 *
 * 볼록도형이므로 축평행 사각형(반폭 `a`, 반높이 `b`)은 **네 꼭짓점만** 검사하면
 * 된다. 좌변의 최대값은 각각 `a·c + b·s` 와 `a·s + b·c` (`c = |cosθ|`,
 * `s = |sinθ|`) 이므로, `b = a/r` (`r = W/H`) 를 넣으면
 *
 * ```text
 * a ≤ (W/2) / (c + s/r)      a ≤ (H/2) / (s + c/r)
 * ```
 *
 * 둘 중 작은 쪽이 답이다.
 *
 * ## 반올림은 안쪽으로
 *
 * 바깥으로 반올림하면 빈 픽셀이 한 줄 들어온다. 한 줄이라도 들어오면 이 함수가
 * 약속한 것이 거짓이 되므로 `ceil` / `floor` 로 **줄이는 쪽**으로 맞춘다.
 */
export function inscribedBounds(
  previousWidth: number,
  previousHeight: number,
  angleDegrees: number,
  canvasWidth: number,
  canvasHeight: number,
): { left: number; top: number; right: number; bottom: number } {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const ratio = previousWidth / previousHeight;

  const halfWidth = Math.min(
    previousWidth / 2 / (cos + sin / ratio),
    previousHeight / 2 / (sin + cos / ratio),
  );
  const halfHeight = halfWidth / ratio;

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;

  // 안쪽으로 맞춘다. 바깥으로 반올림하면 빈 픽셀이 한 줄 들어온다.
  const left = Math.max(0, Math.ceil(centerX - halfWidth));
  const top = Math.max(0, Math.ceil(centerY - halfHeight));
  const right = Math.min(canvasWidth, Math.floor(centerX + halfWidth));
  const bottom = Math.min(canvasHeight, Math.floor(centerY + halfHeight));

  return { left, top, right, bottom };
}

/** Plugin 이 돌려주는 것. `safeBounds` 는 여기서 계산해 붙인다. */
const BridgeResultSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  previousWidth: z.number().int(),
  previousHeight: z.number().int(),
  angle: z.number(),
  method: z.string(),
});

export const documentRotateCommand: CommandHandler<
  DocumentRotateParams,
  DocumentRotateResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = BridgeResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "회전 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }

  // **계산은 서버에서 끝낸다.** Plugin 은 실행 Agent 다. (CLAUDE.md 의존 방향 §6)
  // 그리고 회전 뒤 캔버스 크기는 요청이 아니라 Photoshop 이 실제로 만든 값을 쓴다.
  const result = parsed.data;
  return {
    ...result,
    safeBounds: inscribedBounds(
      result.previousWidth,
      result.previousHeight,
      result.angle,
      result.width,
      result.height,
    ),
  };
};
