import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * `LAYER_SET_LOCK` — 레이어 잠금. (CORE_API §5 P2)
 *
 * **넷이 독립 플래그가 아니다.** Adobe 레퍼런스는 각각 읽기/쓰기 불린으로
 * 적지만 실기는 다르다 — **하나를 쓰면 나머지가 전부 지워진다.** 그래서 한
 * 번에 하나만 걸 수 있고, 파라미터도 단일 값이다. (ROADMAP §43)
 *
 * 네 불린을 받는 모양으로 먼저 만들었다가 바꿨다. 그러면 `pixels` 와
 * `position` 을 함께 달라는 **절대 성공할 수 없는 요청**을 받아들이게 된다.
 */

export const LAYER_SET_LOCK = "LAYER_SET_LOCK";

/** `none` 이 "전부 풀기" 다 — `allLocked = false` 가 그 일을 한다. */
export const LockNameSchema = z.enum(["none", "all", "pixels", "position", "transparentPixels"]);

export const LayerSetLockParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
    /** 걸 잠금. **한 번에 하나뿐이다.** */
    lock: LockNameSchema,
  })
  .strict();

export type LayerSetLockParams = z.infer<typeof LayerSetLockParamsSchema>;

/** 못 읽은 것은 `null` 이다 — `false` 로 덮으면 "안 잠겼다" 는 틀린 사실이 된다. */
const LockStateSchema = z.object({
  /** **읽기 전용** — 무엇이든 잠겼는가. */
  any: z.boolean().nullable(),
  all: z.boolean().nullable(),
  pixels: z.boolean().nullable(),
  position: z.boolean().nullable(),
  transparentPixels: z.boolean().nullable(),
});

export const LayerSetLockResultSchema = z.object({
  layer: LayerInfoSchema,
  /**
   * 건 뒤에 **읽은** 다섯 값.
   *
   * 단일 값으로 요약하지 않는다 — **배경 레이어는 `position` 과
   * `transparentPixels` 를 동시에 갖는다.** 설정기로 도달할 수 없는 상태이고,
   * 요약하면 그 사실을 말할 수 없다.
   */
  locks: LockStateSchema,
  /** 요청한 잠금이 실제로 걸렸는가. */
  applied: z.boolean(),
});

export type LayerSetLockResult = z.infer<typeof LayerSetLockResultSchema>;

export const layerSetLockCommand: CommandHandler<LayerSetLockParams, LayerSetLockResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerSetLockResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};
