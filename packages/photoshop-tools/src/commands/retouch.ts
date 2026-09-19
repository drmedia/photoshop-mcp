import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 결함 제거. (ROADMAP §17.14, RETOUCH_PROCESS 3단계)
 *
 * ## 왜 필요했나
 *
 * 프로세스의 한 단계가 **통째로 비어 있었다.** 갯벌 사진에서 하늘의 센서 먼지를
 * 찾아 놓고 지우지 못했다.
 *
 * ## 배경 레이어는 거절한다
 *
 * 이 Command 는 **원본 촬영 픽셀을 지우는 것이 목적인 유일한 작업**이다. 필터는
 * 효과를 입히는 것이고 되돌릴 수 있게 쌓을 수도 있지만, 먼지 제거는 있던 것을
 * 없애는 일이다. 배경에 바로 걸면 카메라가 본 것의 기록이 사라진다.
 *
 * RETOUCH_PROCESS 3단계가 "반드시 빈 레이어에 올려 원본과 분리한다" 고 적은 자리다.
 * 그래서 배경이면 **무엇을 하라고 말하며 막는다** — `layer.duplicate` 로 복제하고
 * 그 레이어를 지정하면 된다. 한 번 더 부르는 비용으로 원본이 남는다.
 *
 * ## `edit` 이다
 *
 * 픽셀을 직접 바꾸지만 필터와 같은 급이다(ARCHITECTURE §22). 배경을 막아 두었으므로
 * 여기서 사라지는 것은 **이미 사본인 레이어**의 픽셀이고, History 로 되돌아간다.
 */

export const RETOUCH_REMOVE_SPOTS = "RETOUCH_REMOVE_SPOTS";

const SpotSchema = z
  .object({
    /** 중심 x. 문서 픽셀 좌표, 왼쪽 위가 (0, 0). */
    x: z.number().int().min(0),
    /** 중심 y. */
    y: z.number().int().min(0),
    /**
     * 반지름(px). 결함보다 **조금 크게** 잡는다 — 내용 인식 채우기가 주변을
     * 참고하므로 결함이 선택 안에 완전히 들어와야 한다.
     *
     * 상한 300 은 의도다. 이것은 먼지·잡티용이지 피사체를 지우는 도구가 아니다.
     */
    radius: z.number().int().min(1).max(300),
  })
  .strict();

export type Spot = z.infer<typeof SpotSchema>;

export const RemoveSpotsParamsSchema = z
  .object({
    /** 지울 지점들. 한 번에 여러 개를 받는다 — 먼지는 원래 목록으로 온다. */
    spots: z.array(SpotSchema).min(1).max(50),
    /** 대상 레이어. 생략하면 활성 레이어. **배경은 거절한다.** */
    layerId: z.number().int().positive().optional(),
    /** 가장자리 페더(px). 생략하면 2. */
    feather: z.number().int().min(0).max(20).optional(),
  })
  .strict();

export type RemoveSpotsParams = z.infer<typeof RemoveSpotsParamsSchema>;

export const RemoveSpotsResultSchema = z.object({
  layer: LayerInfoSchema,
  /** 실제로 채운 지점 수. 요청 수와 다르면 무언가 잘못된 것이다. */
  removed: z.number().int(),
});

export type RemoveSpotsResult = z.infer<typeof RemoveSpotsResultSchema>;

export const retouchRemoveSpotsCommand: CommandHandler<
  RemoveSpotsParams,
  RemoveSpotsResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = RemoveSpotsResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "결함 제거 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data as { layer: LayerInfo; removed: number };
};
