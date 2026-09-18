import type { CommandRegistry } from "@photoshop-mcp/command-engine";
import { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
import { LAYER_LIST, layerListCommand } from "./layer-list.js";
import { PING, pingCommand } from "./ping.js";

export { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
export { LAYER_LIST, layerListCommand } from "./layer-list.js";
export { PING, pingCommand, type PingResult } from "./ping.js";

/** Phase 1 Core Command 를 레지스트리에 등록한다. (ROADMAP §5.3) */
export function registerPhotoshopCommands(registry: CommandRegistry): void {
  registry.register(PING, pingCommand);
  registry.register(DOCUMENT_GET, documentGetCommand);
  registry.register(LAYER_LIST, layerListCommand);
}
