import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolRegistry } from "@photoshop-mcp/photoshop-bridge";
import { createBrightnessContrastTool, createCurvesTool, createLevelsTool } from "./adjustment.js";
import { createDocumentGetTool } from "./document-get.js";
import { createGaussianBlurTool } from "./filter.js";
import {
  createHueSaturationTool,
  createLayerBlendModeTool,
  createSelectionSetTool,
  createVibranceTool,
} from "./gap-tools.js";
import {
  createMaskCreateTool,
  createMaskDisableTool,
  createMaskApplyTool,
  createMaskInvertTool,
  createMaskSelectTool,
  createMaskEnableTool,
  createSelectionClearTool,
  createSelectionInvertTool,
} from "./mask-selection.js";
import { createGroupCreateTool, createGroupMoveLayerTool } from "./group.js";
import { createHistoryRedoTool, createHistoryUndoTool } from "./history.js";
import {
  createLayerCreateTool,
  createLayerDuplicateTool,
  createLayerFillOpacityTool,
  createLayerOpacityTool,
  createLayerRenameTool,
  createLayerSelectTool,
  createLayerVisibilityTool,
} from "./layer-edit.js";
import { createCapabilityListTool, type CapabilityLister } from "./capability.js";
import { createDiagnosticsTool, type DiagnosticsSource } from "./diagnostics.js";
import { createEventRecentTool, type EventReader } from "./event.js";
import { createDocumentCropTool } from "./document-crop.js";
import { createImageResizeTool } from "./image-resize.js";
import { createCanvasResizeTool } from "./canvas-resize.js";
import { createDocumentTrimTool } from "./document-trim.js";
import { createDocumentRotateTool } from "./document-rotate.js";
import { createDocumentCloseTool, createDocumentFlattenTool } from "./document-lifecycle.js";
import { createDocumentOpenTool } from "./document-open.js";
import { createSmartObjectConvertTool } from "./smart-object.js";
import { createDodgeBurnDabTool } from "./dodge-burn.js";
import { createMaskDabTool, createPaintDabTool } from "./paint.js";
import { createFontListTool, createTextCreateTool, createTextSetTool } from "./text.js";
import { createActionDeclaredTool, createActionListTool, createActionRunTool } from "./action.js";
import { createLayerReorderTool } from "./layer-reorder.js";
import { createMeasureTiltTool } from "./measure-tilt.js";
import { createDocumentStatisticsTool } from "./document-statistics.js";
import { createCameraRawApplyTool } from "./camera-raw.js";
import { createLayerDeleteTool } from "./layer-delete.js";
import { createRemoveSpotsTool } from "./retouch.js";
import { createWindowCaptureTool, type WindowCapturer } from "./window-capture.js";
import { createWorkflowListTool, createWorkflowRunTool, type WorkflowRunner } from "./workflow.js";
import {
  createJobCancelTool,
  createJobListTool,
  createJobStatusTool,
  type JobReader,
} from "./job.js";
import {
  createExportTool,
  createSaveAsTool,
  createSaveTool,
  createSelectionExportMaskTool,
  createWorkspaceStatusTool,
} from "./document-save.js";
import { createLayerGetActiveTool } from "./layer-active.js";
import {
  createCaptureDocumentTool,
  createCaptureLayerTool,
  createCaptureSelectionTool,
} from "./capture.js";
import { createSelectionSkyTool, createSelectionSubjectTool } from "./selection-auto.js";
import {
  createColorBalanceTool,
  createColorRangeTool,
  createLuminosityTool,
  createHighPassTool,
  createLayerFromBackgroundTool,
  createLoadChannelTool,
  createMaskGradientTool,
  createMinimumMaximumTool,
  createSaveChannelTool,
  createSelectionModifyTool,
  createStampVisibleTool,
} from "./workflow-gaps.js";
import { createLayerListTool } from "./layer-list.js";
import { createLayerPlaceTool } from "./layer-place.js";
import { createWorkspaceDeleteTool, createWorkspaceUsageTool } from "./workspace-files.js";
import { createDocumentCreateTool } from "./document-create.js";
import { createDocumentDuplicateTool } from "./document-duplicate.js";
import { createDocumentListTool } from "./document-list.js";
import { createHostGetTool } from "./host.js";
import { createLayerGetTool } from "./layer-get.js";
import { createLayerSelectMultipleTool } from "./layer-select-multiple.js";
import { createPingTool } from "./ping.js";

export { DocumentGetInputSchema, createDocumentGetTool } from "./document-get.js";
export { createLayerGetActiveTool } from "./layer-active.js";
export { createSelectionSkyTool, createSelectionSubjectTool } from "./selection-auto.js";
export * from "./capture.js";
export * from "./workflow-gaps.js";
export {
  LayerListInputSchema,
  createLayerListTool,
  type LayerListToolResult,
} from "./layer-list.js";
export * from "./adjustment.js";
export * from "./filter.js";
export * from "./capability.js";
export * from "./window-capture.js";
export * from "./document-crop.js";
export * from "./document-duplicate.js";
export * from "./image-resize.js";
export * from "./canvas-resize.js";
export * from "./document-trim.js";
export * from "./document-rotate.js";
export * from "./measure-tilt.js";
export * from "./layer-reorder.js";
export * from "./document-lifecycle.js";
export * from "./document-open.js";
export * from "./smart-object.js";
export * from "./dodge-burn.js";
export * from "./paint.js";
export * from "./text.js";
export * from "./action.js";
export * from "./document-statistics.js";
export * from "./retouch.js";
export * from "./camera-raw.js";
export * from "./layer-delete.js";
export * from "./job.js";
export * from "./diagnostics.js";
export * from "./event.js";
export * from "./workflow.js";
export * from "./document-save.js";
export * from "./layer-place.js";
export * from "./workspace-files.js";
export * from "./gap-tools.js";
export * from "./group.js";
export * from "./mask-selection.js";
export * from "./history.js";
export * from "./layer-edit.js";
export { PingInputSchema, createPingTool, type PingToolResult } from "./ping.js";

/** Photoshop Core Tool 을 레지스트리에 등록한다. (ROADMAP §5.6, §7.1) */
export function registerPhotoshopTools(registry: ToolRegistry, engine: CommandEngine): void {
  // Phase 1 — 조회
  registry.register(createPingTool(engine));
  registry.register(createHostGetTool(engine));
  registry.register(createDocumentGetTool(engine));
  registry.register(createDocumentListTool(engine));
  registry.register(createDocumentCreateTool(engine));
  registry.register(createDocumentDuplicateTool(engine));
  registry.register(createLayerListTool(engine));
  registry.register(createLayerGetTool(engine));
  registry.register(createLayerSelectMultipleTool(engine));
  registry.register(createLayerGetActiveTool(engine));
  registry.register(createSelectionSkyTool(engine));
  registry.register(createSelectionSubjectTool(engine));
  registry.register(createDocumentStatisticsTool(engine));
  registry.register(createRemoveSpotsTool(engine));
  registry.register(createCameraRawApplyTool(engine));
  registry.register(createLayerDeleteTool(engine));
  registry.register(createDocumentCropTool(engine));
  registry.register(createCanvasResizeTool(engine));
  registry.register(createDocumentTrimTool(engine));
  registry.register(createImageResizeTool(engine));
  registry.register(createDocumentRotateTool(engine));
  registry.register(createLayerReorderTool(engine));
  registry.register(createSmartObjectConvertTool(engine));
  registry.register(createDodgeBurnDabTool(engine));
  registry.register(createActionListTool(engine));
  registry.register(createActionDeclaredTool(engine));
  registry.register(createActionRunTool(engine));
  registry.register(createTextCreateTool(engine));
  registry.register(createTextSetTool(engine));
  registry.register(createFontListTool(engine));
  registry.register(createPaintDabTool(engine));
  registry.register(createMaskDabTool(engine));
  registry.register(createDocumentOpenTool(engine));
  registry.register(createDocumentFlattenTool(engine));
  registry.register(createDocumentCloseTool(engine));
  registry.register(createMeasureTiltTool(engine));
  registry.register(createCaptureDocumentTool(engine));
  registry.register(createCaptureLayerTool(engine));
  registry.register(createCaptureSelectionTool(engine));
  registry.register(createLayerFromBackgroundTool(engine));
  registry.register(createColorBalanceTool(engine));
  registry.register(createHighPassTool(engine));
  registry.register(createMinimumMaximumTool(engine));
  registry.register(createSaveChannelTool(engine));
  registry.register(createLoadChannelTool(engine));
  registry.register(createSelectionModifyTool(engine));
  registry.register(createColorRangeTool(engine));
  registry.register(createLuminosityTool(engine));
  registry.register(createStampVisibleTool(engine));
  registry.register(createMaskGradientTool(engine));

  // Phase 3 — 레이어 편집 (비파괴)
  registry.register(createLayerCreateTool(engine));
  registry.register(createLayerDuplicateTool(engine));
  registry.register(createLayerRenameTool(engine));
  registry.register(createLayerSelectTool(engine));
  registry.register(createLayerVisibilityTool(engine));
  registry.register(createLayerOpacityTool(engine));
  registry.register(createLayerFillOpacityTool(engine));

  // Phase 3 — 그룹
  registry.register(createGroupCreateTool(engine));
  registry.register(createGroupMoveLayerTool(engine));

  // Phase 3 — History
  registry.register(createHistoryUndoTool(engine));
  registry.register(createHistoryRedoTool(engine));

  // Phase 4 — 조정 레이어 (비파괴)
  registry.register(createCurvesTool(engine));
  registry.register(createLevelsTool(engine));
  registry.register(createBrightnessContrastTool(engine));

  // Phase 4 — 마스크 (비파괴)
  registry.register(createMaskCreateTool(engine));
  registry.register(createMaskEnableTool(engine));
  registry.register(createMaskDisableTool(engine));
  // 마스크 중 이것 하나만 파괴적이다 — 굽고 나면 가려 둔 것이 없어진다.
  registry.register(createMaskApplyTool(engine));
  registry.register(createMaskSelectTool(engine));
  registry.register(createMaskInvertTool(engine));

  // Phase 4 — 선택 영역
  registry.register(createSelectionClearTool(engine));
  registry.register(createSelectionInvertTool(engine));

  // Phase 4 — 필터 (기본 스마트 필터로 비파괴)
  registry.register(createGaussianBlurTool(engine));

  // ROADMAP §8.6 — 실기에서 드러난 공백
  registry.register(createLayerBlendModeTool(engine));
  registry.register(createSelectionSetTool(engine));
  registry.register(createHueSaturationTool(engine));
  registry.register(createVibranceTool(engine));

  // Phase 9 — 파일 저장 (ROADMAP §8.5)
  //
  // 기본 정책에서는 external · destructive 가 막혀 있으므로 status 만 동작한다.
  // 목록에는 노출한다. 무엇이 있고 왜 막혔는지 클라이언트가 알아야 한다.
  registry.register(createWorkspaceStatusTool(engine));
  registry.register(createSaveAsTool(engine));
  registry.register(createExportTool(engine));
  registry.register(createSelectionExportMaskTool(engine));
  registry.register(createSaveTool(engine));
  registry.register(createLayerPlaceTool(engine));

  // ROADMAP §17 — 임시 파일 관리
  registry.register(createWorkspaceUsageTool(engine));
  registry.register(createWorkspaceDeleteTool(engine));
}

/**
 * Capability 조회 Tool 을 등록한다. (ROADMAP §12)
 *
 * `registerPhotoshopTools` 와 분리한 이유: Capability 레지스트리는 Command Engine 이
 * 아니라 별도 구성 요소다. 선택 인자로 받으면 주지 않았을 때 Tool 이 조용히 빠진다.
 * 호출을 나누면 빠뜨린 것이 보인다.
 */
export function registerCapabilityTools(
  registry: ToolRegistry,
  capabilities: CapabilityLister,
): void {
  registry.register(createCapabilityListTool(capabilities));
}

/**
 * Job 조회 Tool 을 등록한다. (ROADMAP §14)
 *
 * Capability 와 같은 이유로 분리했다. Job 저장소는 Command Engine 이 아니라
 * 별도 구성 요소이며, 선택 인자로 받으면 주지 않았을 때 조용히 빠진다.
 */
export function registerJobTools(registry: ToolRegistry, jobs: JobReader): void {
  registry.register(createJobStatusTool(jobs));
  registry.register(createJobListTool(jobs));
  registry.register(createJobCancelTool(jobs));
}

/** 이벤트 조회 Tool 을 등록한다. (ROADMAP §15) */
export function registerEventTools(registry: ToolRegistry, events: EventReader): void {
  registry.register(createEventRecentTool(events));
}

/** 진단 Tool 을 등록한다. (ROADMAP §17) */
export function registerDiagnosticsTool(registry: ToolRegistry, source: DiagnosticsSource): void {
  registry.register(createDiagnosticsTool(source));
}

/**
 * 창 캡처 Tool 을 등록한다. (ROADMAP §17.11)
 *
 * 다른 캡처 셋과 달리 Command Engine 을 거치지 않는다. Photoshop 에 닿지 않고
 * OS 에게 묻기 때문이다 — `capability.list` · `diagnostics` 와 같은 부류다.
 * 권한은 Tool 레지스트리가 강제한다.
 *
 * 플랫폼과 무관하게 등록한다. 지원하지 않는 곳에서는 목록에 있되 이유를 말하며
 * 실패한다 — 파일 저장 Tool 을 막힌 채로 노출하는 것과 같은 이유다. 무엇이 있고
 * 왜 안 되는지 클라이언트가 알아야 한다.
 */
export function registerWindowCaptureTool(registry: ToolRegistry, capturer: WindowCapturer): void {
  registry.register(createWindowCaptureTool(capturer));
}

/** 워크플로 Tool 을 등록한다. (ROADMAP §11) */
export function registerWorkflowTools(registry: ToolRegistry, workflows: WorkflowRunner): void {
  registry.register(createWorkflowListTool(workflows));
  registry.register(createWorkflowRunTool(workflows));
}
