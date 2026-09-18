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
  createMaskEnableTool,
  createSelectionClearTool,
  createSelectionInvertTool,
} from "./mask-selection.js";
import { createGroupCreateTool, createGroupMoveLayerTool } from "./group.js";
import { createHistoryUndoTool } from "./history.js";
import {
  createLayerCreateTool,
  createLayerDuplicateTool,
  createLayerOpacityTool,
  createLayerRenameTool,
  createLayerSelectTool,
  createLayerVisibilityTool,
} from "./layer-edit.js";
import { createCapabilityListTool, type CapabilityLister } from "./capability.js";
import { createDiagnosticsTool, type DiagnosticsSource } from "./diagnostics.js";
import { createEventRecentTool, type EventReader } from "./event.js";
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
  createWorkspaceStatusTool,
} from "./document-save.js";
import { createLayerGetActiveTool } from "./layer-active.js";
import { createSelectionSkyTool } from "./selection-auto.js";
import {
  createColorBalanceTool,
  createColorRangeTool,
  createHighPassTool,
  createLayerFromBackgroundTool,
  createLoadChannelTool,
  createMinimumMaximumTool,
  createSaveChannelTool,
  createSelectionModifyTool,
  createStampVisibleTool,
} from "./workflow-gaps.js";
import { createLayerListTool } from "./layer-list.js";
import { createLayerPlaceTool } from "./layer-place.js";
import { createWorkspaceDeleteTool, createWorkspaceUsageTool } from "./workspace-files.js";
import { createPingTool } from "./ping.js";

export { DocumentGetInputSchema, createDocumentGetTool } from "./document-get.js";
export { createLayerGetActiveTool } from "./layer-active.js";
export { createSelectionSkyTool } from "./selection-auto.js";
export * from "./workflow-gaps.js";
export {
  LayerListInputSchema,
  createLayerListTool,
  type LayerListToolResult,
} from "./layer-list.js";
export * from "./adjustment.js";
export * from "./filter.js";
export * from "./capability.js";
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
  registry.register(createDocumentGetTool(engine));
  registry.register(createLayerListTool(engine));
  registry.register(createLayerGetActiveTool(engine));
  registry.register(createSelectionSkyTool(engine));
  registry.register(createLayerFromBackgroundTool(engine));
  registry.register(createColorBalanceTool(engine));
  registry.register(createHighPassTool(engine));
  registry.register(createMinimumMaximumTool(engine));
  registry.register(createSaveChannelTool(engine));
  registry.register(createLoadChannelTool(engine));
  registry.register(createSelectionModifyTool(engine));
  registry.register(createColorRangeTool(engine));
  registry.register(createStampVisibleTool(engine));

  // Phase 3 — 레이어 편집 (비파괴)
  registry.register(createLayerCreateTool(engine));
  registry.register(createLayerDuplicateTool(engine));
  registry.register(createLayerRenameTool(engine));
  registry.register(createLayerSelectTool(engine));
  registry.register(createLayerVisibilityTool(engine));
  registry.register(createLayerOpacityTool(engine));

  // Phase 3 — 그룹
  registry.register(createGroupCreateTool(engine));
  registry.register(createGroupMoveLayerTool(engine));

  // Phase 3 — History
  registry.register(createHistoryUndoTool(engine));

  // Phase 4 — 조정 레이어 (비파괴)
  registry.register(createCurvesTool(engine));
  registry.register(createLevelsTool(engine));
  registry.register(createBrightnessContrastTool(engine));

  // Phase 4 — 마스크 (비파괴)
  registry.register(createMaskCreateTool(engine));
  registry.register(createMaskEnableTool(engine));
  registry.register(createMaskDisableTool(engine));

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

/** 워크플로 Tool 을 등록한다. (ROADMAP §11) */
export function registerWorkflowTools(registry: ToolRegistry, workflows: WorkflowRunner): void {
  registry.register(createWorkflowListTool(workflows));
  registry.register(createWorkflowRunTool(workflows));
}
