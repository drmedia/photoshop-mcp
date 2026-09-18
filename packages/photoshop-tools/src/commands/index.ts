import type { CommandRegistry } from "@photoshop-mcp/command-engine";
import {
  ADJUSTMENT_BRIGHTNESS_CONTRAST,
  ADJUSTMENT_CURVES,
  ADJUSTMENT_LEVELS,
  BrightnessContrastParamsSchema,
  CurvesParamsSchema,
  LevelsParamsSchema,
  brightnessContrastCommand,
  curvesCommand,
  levelsCommand,
} from "./adjustment.js";
import { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
import { HISTORY_UNDO, HistoryUndoParamsSchema, historyUndoCommand } from "./history.js";
import {
  GROUP_CREATE,
  GROUP_MOVE_LAYER,
  GroupCreateParamsSchema,
  GroupMoveLayerParamsSchema,
  groupCreateCommand,
  groupMoveLayerCommand,
} from "./group.js";
import {
  LAYER_CREATE,
  LAYER_DUPLICATE,
  LAYER_OPACITY,
  LAYER_RENAME,
  LAYER_SELECT,
  LAYER_VISIBILITY,
  LayerCreateParamsSchema,
  LayerDuplicateParamsSchema,
  LayerOpacityParamsSchema,
  LayerRenameParamsSchema,
  LayerSelectParamsSchema,
  LayerVisibilityParamsSchema,
  layerCreateCommand,
  layerDuplicateCommand,
  layerOpacityCommand,
  layerRenameCommand,
  layerSelectCommand,
  layerVisibilityCommand,
} from "./layer-edit.js";
import { LAYER_LIST, layerListCommand } from "./layer-list.js";
import { PING, pingCommand } from "./ping.js";

export { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
export * from "./adjustment.js";
export * from "./group.js";
export * from "./history.js";
export * from "./layer-edit.js";
export { LAYER_LIST, layerListCommand } from "./layer-list.js";
export { PING, pingCommand, type PingResult } from "./ping.js";

/**
 * Photoshop Core Command 를 레지스트리에 등록한다. (ROADMAP §5.3, §7.1)
 *
 * 파라미터를 받는 Command 는 스키마를 함께 등록한다.
 * Extension 이 Tool 을 거치지 않고 Engine 을 직접 호출해도 검증되도록 하기 위함이다.
 */
export function registerPhotoshopCommands(registry: CommandRegistry): void {
  // Phase 1 — 조회
  registry.register(PING, pingCommand);
  registry.register(DOCUMENT_GET, documentGetCommand);
  registry.register(LAYER_LIST, layerListCommand);

  // Phase 3 — 레이어 편집 (비파괴)
  registry.register(LAYER_CREATE, layerCreateCommand, LayerCreateParamsSchema);
  registry.register(LAYER_DUPLICATE, layerDuplicateCommand, LayerDuplicateParamsSchema);
  registry.register(LAYER_RENAME, layerRenameCommand, LayerRenameParamsSchema);
  registry.register(LAYER_SELECT, layerSelectCommand, LayerSelectParamsSchema);
  registry.register(LAYER_VISIBILITY, layerVisibilityCommand, LayerVisibilityParamsSchema);
  registry.register(LAYER_OPACITY, layerOpacityCommand, LayerOpacityParamsSchema);

  // Phase 3 — 그룹
  registry.register(GROUP_CREATE, groupCreateCommand, GroupCreateParamsSchema);
  registry.register(GROUP_MOVE_LAYER, groupMoveLayerCommand, GroupMoveLayerParamsSchema);

  // Phase 3 — History
  registry.register(HISTORY_UNDO, historyUndoCommand, HistoryUndoParamsSchema);

  // Phase 4 — 조정 레이어 (비파괴)
  registry.register(ADJUSTMENT_CURVES, curvesCommand, CurvesParamsSchema);
  registry.register(ADJUSTMENT_LEVELS, levelsCommand, LevelsParamsSchema);
  registry.register(
    ADJUSTMENT_BRIGHTNESS_CONTRAST,
    brightnessContrastCommand,
    BrightnessContrastParamsSchema,
  );
}
