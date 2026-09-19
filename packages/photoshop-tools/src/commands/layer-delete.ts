import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 레이어 삭제. (ROADMAP §17.18)
 *
 * ## 왜 늦게 만들었나
 *
 * CORE_API §8 이 처음부터 `DESTRUCTIVE` 로 분류해 두고 구현은 미뤄 두었다.
 * 실기에서 **세 번** 아쉬웠다 — 보정 시험용 레이어(`ZZ_*`)를 만들어 놓고 지우지
 * 못해 문서에 열 장 넘게 쌓였다. History 가 바닥나면 되돌리기로도 못 없앤다.
 *
 * ## `destructive` 다
 *
 * 되돌리기로 살릴 수는 있지만 **작업을 없애는 것이 목적**인 Command 다.
 * 기본 허용(`read` · `edit`) 밖이므로 사용자가 `PHOTOSHOP_MCP_ALLOW` 로 켜야 한다.
 * CORE_API §8 이 "반드시 DESTRUCTIVE 로 분류한다" 고 미리 정해 둔 것을 따른다.
 *
 * ## **id 를 명시한다. 패턴을 받지 않는다**
 *
 * `workspace.delete` 와 같은 규칙이다. 별표 한 줄이 사용자의 작업을 지울 수 있다.
 * 이름이나 접두사로 고르는 통로를 만들지 않는다 — 고르는 일은 호출자가 하고,
 * 이 Command 는 지목된 것만 지운다.
 */

export const LAYER_DELETE = "LAYER_DELETE";

export const LayerDeleteParamsSchema = z
  .object({
    /**
     * 지울 레이어 id.
     *
     * 이름이나 패턴을 받지 않는다. `photoshop.layer.list` 로 고른 뒤 id 를 준다.
     */
    layerIds: z.array(z.number().int().positive()).min(1).max(50),
  })
  .strict();

export type LayerDeleteParams = z.infer<typeof LayerDeleteParamsSchema>;

export const LayerDeleteResultSchema = z.object({
  /** 실제로 사라진 id. **요청이 아니라 확인한 결과다.** */
  deleted: z.array(z.number().int()),
  /** 못 지운 것과 그 이유. */
  failed: z.array(z.object({ id: z.number().int(), reason: z.string() })),
  /** 남은 레이어 수. 문서가 비지 않았는지 호출자가 볼 수 있어야 한다. */
  remaining: z.number().int(),
});

export type LayerDeleteResult = z.infer<typeof LayerDeleteResultSchema>;

export const layerDeleteCommand: CommandHandler<LayerDeleteParams, LayerDeleteResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerDeleteResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "삭제 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
