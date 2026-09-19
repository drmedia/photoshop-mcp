import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 스마트 오브젝트 변환. (ROADMAP §17.27)
 *
 * CORE_API §5.8 이 `P2 · EDIT` 로 분류해 두고 구현은 미뤄 둔 것이다.
 *
 * ## 왜 필요했나
 *
 * Camera Raw 중심 보정에서 **값을 고칠 때마다 레이어를 다시 만들어야 했다.**
 * 한 세션에서 네 번 그랬다 — NR 강도, dehaze/clarity 비율, `blacks` 과보정,
 * 로컬 대비와 NR 을 함께 걸기.
 *
 * `camera_raw.apply` 는 픽셀에 굽는다. 스마트 오브젝트로 만들어 두면 같은 필터가
 * **스마트 필터**로 붙어 나중에 값만 고칠 수 있다.
 *
 * 필터 Tool 들의 `asSmartFilter: true` 로도 변환되지만 그때는 필터가 함께 걸린다.
 * "변환만" 하는 길이 없었다.
 *
 * ## id 가 바뀐다
 *
 * 변환하면 레이어 객체가 교체되어 **id 가 달라진다.** 실기에서 한 번에 세 번
 * 바뀐 기록이 있다(§8.4). 그래서 결과의 `id` 를 반드시 읽어 쓴다 — 호출자가
 * 예전 id 로 이어서 작업하면 조용히 다른 레이어를 건드린다.
 *
 * 그 사실을 `previousId` 로 함께 드러낸다.
 *
 * ## 이미 스마트 오브젝트면 아무것도 하지 않는다
 *
 * 두 번 변환하면 **스마트 오브젝트 안에 스마트 오브젝트**가 생겨 구조가 한 겹
 * 깊어진다. 되돌리기 어렵고 호출자가 의도한 적이 없는 일이다.
 *
 * 실패로 두지 않는다 — 이미 원하는 상태이고, 오류로 만들면 호출자가 매번 먼저
 * 확인해야 한다. 대신 `converted: false` 로 무슨 일이 있었는지 말한다.
 * (`layer.reorder` 의 `moved` 와 같은 규칙)
 */

export const SMART_OBJECT_CONVERT = "SMART_OBJECT_CONVERT";

export const SmartObjectConvertParamsSchema = z
  .object({
    /** 대상 레이어. 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
  })
  .strict();

export type SmartObjectConvertParams = z.infer<typeof SmartObjectConvertParamsSchema>;

export const SmartObjectConvertResultSchema = z.object({
  /** 변환 뒤의 레이어. **`id` 가 바뀌었을 수 있으므로 이 값을 쓴다.** */
  layer: LayerInfoSchema,
  /**
   * 실제로 변환했는지.
   *
   * 이미 스마트 오브젝트였으면 `false` 다. 실패가 아니라 할 일이 없었던 것이다.
   */
  converted: z.boolean(),
  /** 변환 전 id. 바뀌지 않았으면 `layer.id` 와 같다. */
  previousId: z.number().int(),
});

export type SmartObjectConvertResult = z.infer<typeof SmartObjectConvertResultSchema>;

export const smartObjectConvertCommand: CommandHandler<
  SmartObjectConvertParams,
  SmartObjectConvertResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = SmartObjectConvertResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "변환 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
