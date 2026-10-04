/**
 * Tool 프로필 — `tools/list` 에 **무엇을 보일지** 고른다.
 *
 * Core Tool 이 176개라 목록만 약 14.5만 글자다. 컨텍스트가 작거나 토큰을 세는 환경에서는
 * 매 요청마다 이것이 입력으로 들어간다. 보정에 쓰는 것만 보이면 되는 사용자가 있다.
 *
 * **노출만 줄인다.** 권한 강제는 Command Engine 이 그대로 하고, Extension 이 Command 를
 * 직접 부르는 길도 그대로다. 프로필은 보안 경계가 아니라 목록의 크기다 — 그래서 감춘 Tool 을
 * 불러도 실행하지 않고 **왜 없는지**를 말해 준다. 조용히 없는 척하면 호출자가 이름을 의심한다.
 */

export const TOOL_PROFILES = ["full", "retouch", "readonly"] as const;
export type ToolProfile = (typeof TOOL_PROFILES)[number];

export const DEFAULT_TOOL_PROFILE: ToolProfile = "full";

/** 프로필 판정에 필요한 Tool 의 최소 표면. */
export interface ProfiledTool {
  name: string;
  permission: string;
}

/**
 * `retouch` 가 보이는 Core Tool.
 *
 * 읽기 · 분석 · 비교 · 조정 레이어 · Camera Raw · 마스크 · 선택 · 스냅샷 — 보정 절차
 * (`guidance.ts`)가 말하는 것은 전부 들어 있다. 텍스트 · 패스 · 가이드 · 레이어 컴프 ·
 * 변형 · 병합 · 액션 · 워크플로처럼 보정 루프 밖의 것은 뺐다.
 *
 * 목록에 없는 이름은 `tests/tool-profile.test.ts` 가 잡는다 — 오타가 조용히 Tool 하나를
 * 감추는 것이 이 방식의 약점이다.
 */
export const RETOUCH_TOOLS: ReadonlySet<string> = new Set([
  // 상태
  "photoshop.ping",
  "photoshop.diagnostics",
  "photoshop.host.get",
  "photoshop.metadata.get",
  "photoshop.workspace.status",
  "photoshop.job.status",
  "photoshop.job.list",
  "photoshop.job.cancel",
  // 문서
  "photoshop.document.get",
  "photoshop.document.list",
  "photoshop.document.activate",
  "photoshop.document.open",
  "photoshop.document.save_as",
  "photoshop.document.export",
  "photoshop.document.save",
  "photoshop.document.duplicate",
  "photoshop.document.bit_depth_convert",
  // 별 사진 지침이 키울 때 bicubicSmoother 를 말한다.
  "photoshop.image.resize",
  "photoshop.document.list_created",
  "photoshop.document.close_created",
  // 보기 · 재기
  "photoshop.document.capture",
  "photoshop.layer.capture",
  "photoshop.selection.capture",
  "photoshop.window.capture",
  "photoshop.document.statistics",
  "photoshop.document.analyze",
  "photoshop.document.compare",
  "photoshop.document.compare_with",
  "photoshop.measure.tilt",
  // 레이어
  "photoshop.layer.list",
  "photoshop.layer.get",
  "photoshop.layer.get_active",
  "photoshop.layer.create",
  "photoshop.layer.duplicate",
  "photoshop.layer.rename",
  "photoshop.layer.select",
  "photoshop.layer.select_multiple",
  "photoshop.layer.set_visibility",
  "photoshop.layer.set_opacity",
  "photoshop.layer.set_fill_opacity",
  "photoshop.layer.set_blend_mode",
  "photoshop.layer.reorder",
  "photoshop.layer.stamp_visible",
  "photoshop.layer.from_background",
  "photoshop.layer.delete",
  "photoshop.layer.list_created",
  "photoshop.layer.delete_created",
  "photoshop.group.create",
  "photoshop.group.move_layer",
  // 조정 · Camera Raw
  "photoshop.adjustment.get",
  "photoshop.adjustment.update",
  "photoshop.adjustment.curves",
  "photoshop.adjustment.levels",
  "photoshop.adjustment.brightness_contrast",
  "photoshop.adjustment.hue_saturation",
  "photoshop.adjustment.vibrance",
  "photoshop.adjustment.color_balance",
  "photoshop.adjustment.exposure",
  "photoshop.adjustment.black_white",
  "photoshop.adjustment.photo_filter",
  "photoshop.adjustment.channel_mixer",
  "photoshop.camera_raw.apply",
  "photoshop.smart_object.convert",
  "photoshop.smart_object.get_info",
  // 마스크
  "photoshop.mask.create",
  "photoshop.mask.enable",
  "photoshop.mask.disable",
  "photoshop.mask.dab",
  "photoshop.mask.gradient",
  "photoshop.mask.invert",
  "photoshop.mask.select",
  "photoshop.mask.summary",
  // 선택 · 채널
  "photoshop.selection.set",
  "photoshop.selection.clear",
  "photoshop.selection.invert",
  "photoshop.selection.subject",
  "photoshop.selection.sky",
  "photoshop.selection.color_range",
  "photoshop.selection.luminosity",
  "photoshop.selection.modify",
  "photoshop.selection.save_channel",
  "photoshop.selection.load_channel",
  "photoshop.channel.list",
  "photoshop.channel.get",
  // 필터 · 국소
  "photoshop.filter.gaussian_blur",
  "photoshop.filter.high_pass",
  "photoshop.filter.unsharp_mask",
  "photoshop.dodge_burn.dab",
  "photoshop.retouch.remove_spots",
  // 되돌리기
  "photoshop.history.undo",
  "photoshop.history.redo",
  "photoshop.history.create_snapshot",
  "photoshop.history.restore_snapshot",
  "photoshop.history.list_snapshots",
]);

/** `PHOTOSHOP_MCP_PROFILE` 값을 읽는다. 생략은 `full`, 모르는 값은 `unknown` 에 담는다. */
export function parseToolProfile(raw: string | undefined): {
  profile: ToolProfile;
  unknown: string | null;
} {
  const value = raw?.trim().toLowerCase() ?? "";
  if (value === "") {
    return { profile: DEFAULT_TOOL_PROFILE, unknown: null };
  }
  const found = TOOL_PROFILES.find((profile) => profile === value);
  return found === undefined
    ? { profile: DEFAULT_TOOL_PROFILE, unknown: raw?.trim() ?? value }
    : { profile: found, unknown: null };
}

/**
 * 이 프로필에서 Tool 이 보이는가.
 *
 * Extension 이 등록한 Tool(`photoshop.` 밖)은 `retouch` 에서 가리지 않는다 — 사용자가 직접
 * 켠 것이고 `PHOTOSHOP_MCP_EXTENSIONS_ENABLED` 가 이미 그 스위치다. `readonly` 는 권한으로 가른다.
 */
export function isToolVisible(profile: ToolProfile, tool: ProfiledTool): boolean {
  switch (profile) {
    case "full":
      return true;
    case "readonly":
      return tool.permission === "read";
    case "retouch":
      return !tool.name.startsWith("photoshop.") || RETOUCH_TOOLS.has(tool.name);
  }
}
