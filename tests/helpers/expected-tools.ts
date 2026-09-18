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
] as const;

/**
 * 아직 노출하면 안 되는 Tool.
 *
 * destructive 명령은 Permission System 과 함께 이후 Phase 에서 추가한다. (ROADMAP §7.4)
 * 그 밖은 Phase 4 이후 범위다.
 */
export const FORBIDDEN_TOOLS = [
  // destructive
  "photoshop.layer.delete",
  "photoshop.document.flatten",
  "photoshop.document.close",
  "photoshop.group.ungroup",
  // Phase 4 이후
  "photoshop.mask.create",
  "photoshop.selection.clear",
  "photoshop.adjustment.curves",
  "photoshop.adjustment.levels",
  "photoshop.filter.gaussian_blur",
  "photoshop.document.save",
] as const;
