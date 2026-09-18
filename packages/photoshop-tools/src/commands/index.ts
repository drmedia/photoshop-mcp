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
import { FILTER_GAUSSIAN_BLUR, GaussianBlurParamsSchema, gaussianBlurCommand } from "./filter.js";
import {
  ADJUSTMENT_HUE_SATURATION,
  ADJUSTMENT_VIBRANCE,
  HueSaturationParamsSchema,
  LAYER_BLEND_MODE,
  LayerBlendModeParamsSchema,
  SELECTION_SET,
  SelectionSetParamsSchema,
  VibranceParamsSchema,
  hueSaturationCommand,
  layerBlendModeCommand,
  selectionSetCommand,
  vibranceCommand,
} from "./gap-tools.js";
import {
  MASK_CREATE,
  MASK_DISABLE,
  MASK_ENABLE,
  MaskCreateParamsSchema,
  MaskToggleParamsSchema,
  SELECTION_CLEAR,
  SELECTION_INVERT,
  SelectionParamsSchema,
  maskCreateCommand,
  maskDisableCommand,
  maskEnableCommand,
  selectionClearCommand,
  selectionInvertCommand,
} from "./mask-selection.js";
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
import {
  DOCUMENT_EXPORT,
  DOCUMENT_SAVE,
  DOCUMENT_SAVE_AS,
  ExportParamsSchema,
  SaveAsParamsSchema,
  WORKSPACE_STATUS,
  exportCommand,
  saveAsCommand,
  saveCommand,
  workspaceStatusCommand,
} from "./document-save.js";
import { LAYER_LIST, layerListCommand } from "./layer-list.js";
import { LAYER_PLACE, LayerPlaceParamsSchema, layerPlaceCommand } from "./layer-place.js";
import {
  WORKSPACE_DELETE,
  WORKSPACE_USAGE,
  WorkspaceDeleteParamsSchema,
  WorkspaceUsageParamsSchema,
  workspaceDeleteCommand,
  workspaceUsageCommand,
} from "./workspace-files.js";
import { PING, pingCommand } from "./ping.js";

export { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
export * from "./document-save.js";
export * from "./layer-place.js";
export * from "./workspace-files.js";
export * from "./adjustment.js";
export * from "./filter.js";
export * from "./gap-tools.js";
export * from "./group.js";
export * from "./mask-selection.js";
export * from "./history.js";
export * from "./layer-edit.js";
export { LAYER_LIST, layerListCommand } from "./layer-list.js";
export { PING, pingCommand, type PingResult } from "./ping.js";

/**
 * Photoshop Core Command 를 레지스트리에 등록한다. (ROADMAP §5.3, §7.1)
 *
 * 파라미터를 받는 Command 는 스키마를 함께 등록한다.
 * Extension 이 Tool 을 거치지 않고 Engine 을 직접 호출해도 검증되도록 하기 위함이다.
 *
 * `permission` 은 필수다. (ARCHITECTURE §22)
 * 현재 Core Command 는 `read` 아니면 `edit` 뿐이다 — 전부 비파괴이기 때문이다.
 * `external` · `destructive` Command 는 아직 없다.
 */
export function registerPhotoshopCommands(registry: CommandRegistry): void {
  // Phase 1 — 조회
  registry.register(PING, pingCommand, { permission: "read" });
  registry.register(DOCUMENT_GET, documentGetCommand, { permission: "read" });
  registry.register(LAYER_LIST, layerListCommand, { permission: "read" });

  // Phase 3 — 레이어 편집 (비파괴)
  const edit = "edit" as const;
  registry.register(LAYER_CREATE, layerCreateCommand, {
    permission: edit,
    schema: LayerCreateParamsSchema,
  });
  registry.register(LAYER_DUPLICATE, layerDuplicateCommand, {
    permission: edit,
    schema: LayerDuplicateParamsSchema,
  });
  registry.register(LAYER_RENAME, layerRenameCommand, {
    permission: edit,
    schema: LayerRenameParamsSchema,
  });
  registry.register(LAYER_SELECT, layerSelectCommand, {
    permission: edit,
    schema: LayerSelectParamsSchema,
  });
  registry.register(LAYER_VISIBILITY, layerVisibilityCommand, {
    permission: edit,
    schema: LayerVisibilityParamsSchema,
  });
  registry.register(LAYER_OPACITY, layerOpacityCommand, {
    permission: edit,
    schema: LayerOpacityParamsSchema,
  });

  // Phase 3 — 그룹
  registry.register(GROUP_CREATE, groupCreateCommand, {
    permission: edit,
    schema: GroupCreateParamsSchema,
  });
  registry.register(GROUP_MOVE_LAYER, groupMoveLayerCommand, {
    permission: edit,
    schema: GroupMoveLayerParamsSchema,
  });

  // Phase 3 — History
  //
  // undo 는 되돌리기이지 파괴가 아니다. 이미 한 편집을 취소할 뿐,
  // Photoshop 의 History 에 남아 redo 할 수 있다.
  registry.register(HISTORY_UNDO, historyUndoCommand, {
    permission: edit,
    schema: HistoryUndoParamsSchema,
  });

  // Phase 4 — 조정 레이어 (비파괴)
  registry.register(ADJUSTMENT_CURVES, curvesCommand, {
    permission: edit,
    schema: CurvesParamsSchema,
  });
  registry.register(ADJUSTMENT_LEVELS, levelsCommand, {
    permission: edit,
    schema: LevelsParamsSchema,
  });
  registry.register(ADJUSTMENT_BRIGHTNESS_CONTRAST, brightnessContrastCommand, {
    permission: edit,
    schema: BrightnessContrastParamsSchema,
  });

  // Phase 4 — 마스크 (비파괴)
  registry.register(MASK_CREATE, maskCreateCommand, {
    permission: edit,
    schema: MaskCreateParamsSchema,
  });
  registry.register(MASK_ENABLE, maskEnableCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });
  registry.register(MASK_DISABLE, maskDisableCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });

  // Phase 4 — 선택 영역
  registry.register(SELECTION_CLEAR, selectionClearCommand, {
    permission: edit,
    schema: SelectionParamsSchema,
  });
  registry.register(SELECTION_INVERT, selectionInvertCommand, {
    permission: edit,
    schema: SelectionParamsSchema,
  });

  // Phase 4 — 필터 (기본 스마트 필터로 비파괴)
  registry.register(FILTER_GAUSSIAN_BLUR, gaussianBlurCommand, {
    permission: edit,
    schema: GaussianBlurParamsSchema,
  });

  // ROADMAP §8.6 — 실기에서 드러난 공백
  registry.register(LAYER_BLEND_MODE, layerBlendModeCommand, {
    permission: edit,
    schema: LayerBlendModeParamsSchema,
  });
  registry.register(SELECTION_SET, selectionSetCommand, {
    permission: edit,
    schema: SelectionSetParamsSchema,
  });
  registry.register(ADJUSTMENT_HUE_SATURATION, hueSaturationCommand, {
    permission: edit,
    schema: HueSaturationParamsSchema,
  });
  registry.register(ADJUSTMENT_VIBRANCE, vibranceCommand, {
    permission: edit,
    schema: VibranceParamsSchema,
  });

  // Phase 9 — 파일 저장 (ROADMAP §8.5)
  //
  // save_as 와 export 는 Photoshop 밖(파일 시스템)에 쓰므로 external 이다.
  // 덮어쓰지 않으므로 데이터를 잃지 않는다.
  //
  // save 는 원본을 덮어쓴다. 되돌릴 수 없으므로 destructive 다.
  registry.register(WORKSPACE_STATUS, workspaceStatusCommand, { permission: "read" });
  registry.register(DOCUMENT_SAVE_AS, saveAsCommand, {
    permission: "external",
    schema: SaveAsParamsSchema,
  });
  registry.register(DOCUMENT_EXPORT, exportCommand, {
    permission: "external",
    schema: ExportParamsSchema,
  });
  registry.register(DOCUMENT_SAVE, saveCommand, { permission: "destructive" });

  // 외부 처리 결과를 되돌리는 길. 승인된 폴더 안이라도 Photoshop 밖 파일을 읽으므로
  // export 와 같은 external 이다.
  registry.register(LAYER_PLACE, layerPlaceCommand, {
    permission: "external",
    schema: LayerPlaceParamsSchema,
  });

  // ROADMAP §17 — 임시 파일 관리
  // 조회는 read, 삭제는 되돌릴 수 없으므로 destructive.
  registry.register(WORKSPACE_USAGE, workspaceUsageCommand, {
    permission: "read",
    schema: WorkspaceUsageParamsSchema,
  });
  registry.register(WORKSPACE_DELETE, workspaceDeleteCommand, {
    permission: "destructive",
    schema: WorkspaceDeleteParamsSchema,
  });
}
