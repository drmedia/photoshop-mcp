import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolRegistry } from "@photoshop-mcp/photoshop-bridge";
import { createDocumentGetTool } from "./document-get.js";
import { createLayerListTool } from "./layer-list.js";
import { createPingTool } from "./ping.js";

export { DocumentGetInputSchema, createDocumentGetTool } from "./document-get.js";
export {
  LayerListInputSchema,
  createLayerListTool,
  type LayerListToolResult,
} from "./layer-list.js";
export { PingInputSchema, createPingTool, type PingToolResult } from "./ping.js";

/** Phase 1 Core Tool 을 레지스트리에 등록한다. (ROADMAP §5.6) */
export function registerPhotoshopTools(registry: ToolRegistry, engine: CommandEngine): void {
  registry.register(createPingTool(engine));
  registry.register(createDocumentGetTool(engine));
  registry.register(createLayerListTool(engine));
}
