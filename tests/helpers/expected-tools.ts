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
  "photoshop.layer.get_active",
  "photoshop.selection.sky",
  // ROADMAP §17.12 — 구도. 조정 레이어로는 할 수 없는 일
  "photoshop.document.crop",
  "photoshop.document.capture",
  "photoshop.layer.capture",
  "photoshop.selection.capture",
  "photoshop.layer.from_background",
  "photoshop.adjustment.color_balance",
  "photoshop.filter.high_pass",
  "photoshop.filter.minimum_maximum",
  "photoshop.selection.save_channel",
  "photoshop.selection.load_channel",
  "photoshop.selection.modify",
  "photoshop.selection.color_range",
  "photoshop.layer.stamp_visible",
  "photoshop.mask.gradient",
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
  // Phase 8 — 외부 처리기 (ROADMAP §12)
  //
  // 조회만 노출한다. 실행은 Extension 이 전체 흐름의 일부로 호출한다.
  // 외부 처리 결과를 되돌리는 길
  "photoshop.layer.place",
  // ROADMAP §17 — 임시 파일 관리
  "photoshop.workspace.usage",
  "photoshop.workspace.delete",
  // Phase 8 — 외부 처리기 (ROADMAP §12)
  //
  // 조회만 노출한다. 실행은 Extension 이 전체 흐름의 일부로 호출한다.
  "photoshop.capability.list",
  // ROADMAP §17.11 — Photoshop 창. 문서가 아니라 화면이라 external 이다
  "photoshop.window.capture",
  // ROADMAP §14 — 긴 작업 (MCP 기본 타임아웃 60초를 넘는 것)
  "photoshop.job.status",
  "photoshop.job.list",
  "photoshop.job.cancel",
  // ROADMAP §11 — 선언으로 정의한 Tool 순서
  // ROADMAP §15 — 이벤트. LLM 은 구독하지 않고 조회한다
  "photoshop.event.recent",
  "photoshop.workflow.list",
  "photoshop.workflow.run",
  // ROADMAP §17 — 무엇이 되고 무엇이 막혀 있는지 한 번에.
  // 다른 모든 구성 요소를 들여다보므로 마지막에 등록한다.
  "photoshop.diagnostics",
] as const;

export const EXPECTED_COMMANDS = [
  "PING",
  "DOCUMENT_GET",
  "LAYER_LIST",
  "LAYER_GET_ACTIVE",
  "SELECTION_SKY",
  "DOCUMENT_CROP",
  "CAPTURE_DOCUMENT",
  "CAPTURE_LAYER",
  "CAPTURE_SELECTION",
  "LAYER_FROM_BACKGROUND",
  "ADJUSTMENT_COLOR_BALANCE",
  "FILTER_HIGH_PASS",
  "FILTER_MINIMUM_MAXIMUM",
  "SELECTION_SAVE_CHANNEL",
  "SELECTION_LOAD_CHANNEL",
  "SELECTION_MODIFY",
  "SELECTION_COLOR_RANGE",
  "LAYER_STAMP_VISIBLE",
  "MASK_GRADIENT",
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
  "LAYER_PLACE",
  "WORKSPACE_USAGE",
  "WORKSPACE_DELETE",
  // ROADMAP §16 — Resource 를 뒷받침하는 읽기
  "SELECTION_GET",
  "HISTORY_LIST",
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
