import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 닷징 · 버닝. (ROADMAP §17.31)
 *
 * ## 왜 만들 수 있었나
 *
 * 치유 브러시를 만들지 않은 이유(§17.14)는 **획 경로**가 필요하다는 것이었다.
 * batchPlay 로 획을 흉내 내면 좌표 목록을 보내는 일이 되고, 그러면 호출자가
 * descriptor 를 조립하는 것과 다를 바 없어진다.
 *
 * 닷징·버닝은 다르다. 필요한 것은 **부드러운 원형 얼룩** 하나이고 그것은
 * `중심 · 반지름 · 강도 · 경도` 네 값으로 결정된다. 검증된 파라미터로 조립된다.
 *
 * ## 얼룩을 배열로 받는다
 *
 * 한 번에 하나만 받으면 얼룩 스무 개에 호출이 스무 번이고, 그 사이 활성 레이어가
 * 바뀔 틈이 생긴다. `retouch.remove_spots` 와 같은 모양으로 둔다.
 *
 * ## 은하수에는 마스크가 먼저다
 *
 * 성운은 형태가 복잡해서 원형 얼룩으로 덮으면 부자연스러워진다. 구조를 따라가는
 * 보정은 `selection.color_range` + `adjustment.curves` 쪽이 맞다. 이 Command 는
 * **중심부 발광이나 전경의 국소 밝기**처럼 둥근 것이 자연스러운 자리에 쓴다.
 */

export const DODGE_BURN_DAB = "DODGE_BURN_DAB";

const DabSchema = z
  .object({
    /** 얼룩 중심. 문서 좌상단이 원점. */
    x: z.number().min(0),
    y: z.number().min(0),
    /** 반지름(픽셀). */
    radius: z.number().min(1).max(5000),
    /**
     * 강도 1–100. 채우기 불투명도로 간다.
     *
     * **작게 여러 번이 크게 한 번보다 낫다.** 10–20 으로 겹쳐 쌓으면 경계가
     * 드러나지 않는다.
     */
    strength: z.number().int().min(1).max(100),
    /**
     * 경도 0–100. 기본 0(가장 부드러움).
     *
     * 페더 = `radius × (1 − hardness/100)` 이다. 100 이면 페더가 0 이 되어
     * 가장자리가 그대로 드러나므로, 경계를 일부러 세울 때만 쓴다.
     */
    hardness: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const DodgeBurnParamsSchema = z
  .object({
    /**
     * 얼룩 목록. 순서대로 쌓인다.
     *
     * 상한 200 은 의도다. 이것은 국소 보정 도구이지 그림 그리는 도구가 아니다.
     */
    dabs: z.array(DabSchema).min(1).max(200),
    /** `dodge` 는 밝히고 `burn` 은 어둡게 한다. */
    mode: z.enum(["dodge", "burn"]),
    /**
     * 대상 레이어. 생략하면 활성 레이어.
     *
     * **`softLight` 를 건 빈 픽셀 레이어여야 한다.** 배경과 조정 레이어·그룹·
     * 스마트 오브젝트는 거절한다.
     */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type DodgeBurnParams = z.infer<typeof DodgeBurnParamsSchema>;

export const DodgeBurnResultSchema = z.object({
  /** 칠한 레이어. */
  layer: LayerInfoSchema,
  /**
   * 실제로 찍힌 얼룩 수.
   *
   * 중간에 실패하면 그 앞까지는 이미 칠해져 있다. 요청 수와 다를 수 있으므로
   * 짐작하지 않고 세어서 돌려준다.
   */
  applied: z.number().int(),
});

export type DodgeBurnResult = z.infer<typeof DodgeBurnResultSchema>;

export const dodgeBurnDabCommand: CommandHandler<DodgeBurnParams, DodgeBurnResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DodgeBurnResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "닷징·버닝 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
