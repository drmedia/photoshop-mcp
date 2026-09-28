import type { CommandHandler } from "@photoshop-mcp/command-engine";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Phase 3 레이어 편집 Command. (ROADMAP §7.1)
 *
 * 모두 비파괴 작업이다. `layer.delete` · `flatten` 같은 destructive 명령은
 * Permission System 과 함께 이후 Phase 에서 추가한다. (ROADMAP §7.4)
 *
 * `layerId` 를 생략하면 활성 레이어를 대상으로 한다. "현재 레이어를 복제해줘" 같은
 * 자연어 요청이 그 형태이기 때문이다. (ROADMAP Phase 3 Completion Criteria)
 */

export const LAYER_CREATE = "LAYER_CREATE";
export const LAYER_DUPLICATE = "LAYER_DUPLICATE";
export const LAYER_RENAME = "LAYER_RENAME";
export const LAYER_SELECT = "LAYER_SELECT";
export const LAYER_VISIBILITY = "LAYER_VISIBILITY";
export const LAYER_OPACITY = "LAYER_OPACITY";
export const LAYER_FILL_OPACITY = "LAYER_FILL_OPACITY";

/** 레이어 이름. 앞뒤 공백만으로 이루어질 수 없다. */
const LayerName = z.string().trim().min(1).max(255);

/** 대상 레이어. 생략하면 활성 레이어. */
const TargetLayer = z.number().int().optional();

export const LayerCreateParamsSchema = z.object({ name: LayerName.optional() }).strict();
export const LayerDuplicateParamsSchema = z
  .object({ layerId: TargetLayer, name: LayerName.optional() })
  .strict();
export const LayerRenameParamsSchema = z.object({ layerId: TargetLayer, name: LayerName }).strict();
export const LayerSelectParamsSchema = z.object({ layerId: z.number().int() }).strict();
export const LayerVisibilityParamsSchema = z
  .object({ layerId: TargetLayer, visible: z.boolean() })
  .strict();
export const LayerOpacityParamsSchema = z
  .object({ layerId: TargetLayer, opacity: z.number().min(0).max(100) })
  .strict();
/**
 * `fillOpacity` 는 `opacity` 와 **다른 값**이다. Adobe 레퍼런스가 둘을 따로 두고
 * 있고(`opacity` 는 "master opacity"), `photoshop.layer.get` 이 이미 둘 다 준다.
 */
export const LayerFillOpacityParamsSchema = z
  .object({ layerId: TargetLayer, fillOpacity: z.number().min(0).max(100) })
  .strict();

export type LayerCreateParams = z.infer<typeof LayerCreateParamsSchema>;
export type LayerDuplicateParams = z.infer<typeof LayerDuplicateParamsSchema>;
export type LayerRenameParams = z.infer<typeof LayerRenameParamsSchema>;
export type LayerSelectParams = z.infer<typeof LayerSelectParamsSchema>;
export type LayerVisibilityParams = z.infer<typeof LayerVisibilityParamsSchema>;
export type LayerOpacityParams = z.infer<typeof LayerOpacityParamsSchema>;
export type LayerFillOpacityParams = z.infer<typeof LayerFillOpacityParamsSchema>;

/**
 * 편집 Command 는 대상 레이어의 변경 후 상태를 돌려준다.
 *
 * 호출자가 결과를 확인하려고 `LAYER_LIST` 를 다시 부르지 않아도 되고,
 * 여러 작업을 연달아 할 때 직전 결과의 `id` 를 다음 작업에 쓸 수 있다.
 */
export type LayerMutationResult = LayerInfo;

/**
 * Command 를 Bridge 로 전달하고 결과를 검증하는 핸들러.
 *
 * 파라미터 검증은 Engine 이 이미 마쳤다. 여기서는 **결과**를 검증한다.
 * Plugin 은 별도 프로세스이고, `executeCommand` 는 조회 경로와 달리 자체 검증이 없다.
 * 실기에서 Plugin 이 `id` 와 `name` 이 빠진 객체를 돌려준 적이 있는데
 * 그대로 MCP 클라이언트까지 전달되었다.
 */
function forward<TParams>(): CommandHandler<TParams, LayerMutationResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = LayerInfoSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(
        ErrorCode.PROTOCOL_ERROR,
        `Plugin 응답이 레이어 스키마를 만족하지 않습니다: ${command.type}`,
        { details: { command: command.type, issues: parsed.error.issues, received: raw } },
      );
    }
    return parsed.data;
  };
}

/**
 * `LAYER_FILL_OPACITY` 의 결과. (CORE_API §5 P1)
 *
 * 다른 레이어 편집은 `LayerInfo` 하나를 돌려주는데 여기만 감싼다 — **`LayerInfo`
 * 에 `fillOpacity` 가 없기 때문이다.** 평탄하게 두면 호출자가 값을 확인하려고
 * `layer.get` 을 한 번 더 불러야 한다. 모양은 그 `layer.get` 과 같게 맞췄다.
 *
 * `fillOpacity` 는 **읽어 온 실제값**이다. 못 읽으면 `null` 이고, 그때는 값이
 * 들어갔는지 확인하지 못했다는 뜻이다 — `0` 으로 채우지 않는다.
 */
export const LayerFillOpacityResultSchema = z.object({
  layer: LayerInfoSchema,
  fillOpacity: z.number().nullable(),
});

export type LayerFillOpacityResult = z.infer<typeof LayerFillOpacityResultSchema>;

export const layerFillOpacityCommand: CommandHandler<
  LayerFillOpacityParams,
  LayerFillOpacityResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = LayerFillOpacityResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 예상과 다릅니다: ${command.type}`,
      { details: { command: command.type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
};

export const layerCreateCommand = forward<LayerCreateParams>();
export const layerDuplicateCommand = forward<LayerDuplicateParams>();
export const layerRenameCommand = forward<LayerRenameParams>();
export const layerSelectCommand = forward<LayerSelectParams>();
export const layerVisibilityCommand = forward<LayerVisibilityParams>();
export const layerOpacityCommand = forward<LayerOpacityParams>();
