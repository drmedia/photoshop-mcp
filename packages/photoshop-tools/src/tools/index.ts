import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolRegistry } from "@photoshop-mcp/photoshop-bridge";
import { createBrightnessContrastTool, createCurvesTool, createLevelsTool } from "./adjustment.js";
import { createDocumentGetTool } from "./document-get.js";
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
import { createLayerListTool } from "./layer-list.js";
import { createPingTool } from "./ping.js";

export { DocumentGetInputSchema, createDocumentGetTool } from "./document-get.js";
export {
  LayerListInputSchema,
  createLayerListTool,
  type LayerListToolResult,
} from "./layer-list.js";
export * from "./adjustment.js";
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
}
