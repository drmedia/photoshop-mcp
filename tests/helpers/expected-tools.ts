/**
 * 현재 등록되는 Core Tool / Command 목록.
 *
 * Phase 가 올라갈 때마다 여러 테스트가 같은 목록을 중복 단정해 함께 깨졌다.
 * 한 곳에서 관리해 Phase 추가 시 이 파일만 고치면 되도록 한다.
 */

/** 등록 순서를 그대로 유지한다. `tools/list` 응답 순서이기도 하다. */
export const EXPECTED_TOOLS = [
  // Phase 1 — 조회
  "photoshop.ping",
  "photoshop.document.get",
  "photoshop.layer.list",
  // Phase 3 — 레이어 편집 (비파괴)
  "photoshop.layer.create",
  "photoshop.layer.duplicate",
  "photoshop.layer.rename",
  "photoshop.layer.select",
  "photoshop.layer.set_visibility",
  "photoshop.layer.set_opacity",
  // Phase 3 — 그룹
  "photoshop.group.create",
  "photoshop.group.move_layer",
  // Phase 3 — History
  "photoshop.history.undo",
  // Phase 4 — 조정 레이어
  "photoshop.adjustment.curves",
  "photoshop.adjustment.levels",
  "photoshop.adjustment.brightness_contrast",
  // Phase 4 — 마스크 · 선택
  "photoshop.mask.create",
  "photoshop.mask.enable",
  "photoshop.mask.disable",
  "photoshop.selection.clear",
  "photoshop.selection.invert",
  // Phase 4 — 필터
  "photoshop.filter.gaussian_blur",
  // ROADMAP §8.6 — 실기에서 드러난 공백
  "photoshop.layer.set_blend_mode",
  "photoshop.selection.set",
  "photoshop.adjustment.hue_saturation",
  "photoshop.adjustment.vibrance",
  // Phase 9 — 파일 저장 (ROADMAP §8.5)
  "photoshop.workspace.status",
  "photoshop.document.save_as",
  "photoshop.document.export",
  "photoshop.document.save",
] as const;

export const EXPECTED_COMMANDS = [
  "PING",
  "DOCUMENT_GET",
  "LAYER_LIST",
  "LAYER_CREATE",
  "LAYER_DUPLICATE",
  "LAYER_RENAME",
  "LAYER_SELECT",
  "LAYER_VISIBILITY",
  "LAYER_OPACITY",
  "GROUP_CREATE",
  "GROUP_MOVE_LAYER",
  "HISTORY_UNDO",
  "ADJUSTMENT_CURVES",
  "ADJUSTMENT_LEVELS",
  "ADJUSTMENT_BRIGHTNESS_CONTRAST",
  "MASK_CREATE",
  "MASK_ENABLE",
  "MASK_DISABLE",
  "SELECTION_CLEAR",
  "SELECTION_INVERT",
  "FILTER_GAUSSIAN_BLUR",
  "LAYER_BLEND_MODE",
  "SELECTION_SET",
  "ADJUSTMENT_HUE_SATURATION",
  "ADJUSTMENT_VIBRANCE",
  "WORKSPACE_STATUS",
  "DOCUMENT_SAVE_AS",
  "DOCUMENT_EXPORT",
  "DOCUMENT_SAVE",
] as const;

/**
 * 아직 노출하면 안 되는 Tool.
 *
 * `document.save` 는 Phase 9 에서 destructive 로 분류해 추가했다.
 * 아래 것들은 아직 대응하는 Command 조차 없다.
 */
export const FORBIDDEN_TOOLS = [
  // destructive — 분류만으로는 부족하고 각각 구현이 필요하다
  "photoshop.layer.delete",
  "photoshop.document.flatten",
  "photoshop.document.close",
  "photoshop.group.ungroup",
  // 아직 구현하지 않음
  "photoshop.mask.delete",
  "photoshop.document.flatten_all",
] as const;
