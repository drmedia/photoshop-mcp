export type { PhotoshopBridge } from "./bridge.js";
export {
  DEFAULT_MOCK_DOCUMENT,
  DEFAULT_MOCK_LAYERS,
  MockPhotoshopBridge,
  type MockPhotoshopBridgeOptions,
} from "./mock-bridge.js";
export {
  ErrorCode,
  PhotoshopMcpError,
  isPhotoshopMcpError,
  type PhotoshopMcpErrorOptions,
  type SerializedPhotoshopMcpError,
} from "./protocol/errors.js";
export { SERVER_NAME, SERVER_VERSION } from "./protocol/server-info.js";
export type { DocumentInfo, LayerInfo, LayerType, PhotoshopCommand } from "./protocol/types.js";
export { ToolRegistry, type ToolContext, type ToolDefinition, type ToolHandler } from "./tool.js";
