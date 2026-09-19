export type { PhotoshopBridge } from "./bridge.js";
export {
  BUILTIN_PLACEHOLDERS,
  CapabilityConfigSchema,
  CapabilityIdSchema,
  ParameterSpecSchema,
  ProviderConfigSchema,
  ProviderIdSchema,
  type CapabilityConfig,
  type CapabilityRequest,
  type CapabilityResult,
  type ExtensionCapabilityRegistry,
  type ParameterSpec,
  type ProviderAvailability,
  type ProviderConfig,
} from "./capability.js";
export { assertConfigConsistent, buildArgs, placeholdersIn } from "./capability-args.js";
export { describeZodIssues } from "./protocol/zod-message.js";
export {
  CapturedImageSchema,
  isCapturedImage,
  isCapturedImageList,
  type CapturedImage,
} from "./capture.js";
export {
  COMMAND_COMPLETED,
  COMMAND_FAILED,
  COMMAND_STARTED,
  EventNameSchema,
  PHOTOSHOP_UNKNOWN,
  type EventQuery,
  type EventRecord,
  type ExtensionEventBus,
  type Unsubscribe,
} from "./event.js";
export {
  WorkflowConfigSchema,
  WorkflowDefinitionSchema,
  WorkflowIdSchema,
  WorkflowStepSchema,
  type WorkflowConfig,
  type WorkflowDefinition,
  type WorkflowResult,
  type WorkflowStep,
  type WorkflowStepResult,
} from "./workflow.js";
export { assertWorkflowConsistent, referencesIn, resolveInput } from "./workflow-refs.js";
export {
  JobStateSchema,
  TERMINAL_STATES,
  isTerminal,
  type ExtensionJobRegistry,
  type JobContext,
  type JobProgress,
  type JobRecord,
  type JobState,
  type ReportProgress,
} from "./job.js";
export {
  ExtensionManifestSchema,
  NamespaceSchema,
  PermissionSchema,
  RESERVED_NAMESPACES,
  type ExtensionCommandEngine,
  type ExtensionContext,
  type ExtensionManifest,
  type ExtensionResourceRegistry,
  type ExtensionToolRegistry,
  type Logger,
  type Permission,
  type PhotoshopMcpExtension,
} from "./extension.js";
export {
  DEFAULT_ALLOWED_LEVELS,
  PERMISSION_LEVELS,
  PermissionLevelSchema,
  PermissionPolicy,
  parsePermissionLevels,
  permissionToLevel,
  type PermissionSubject,
  type PermissionLevel,
} from "./permission.js";
export {
  DEFAULT_MOCK_DOCUMENT,
  DEFAULT_MOCK_LAYERS,
  MockPhotoshopBridge,
  type MockFileSystem,
  type MockPhotoshopBridgeOptions,
} from "./mock-bridge.js";
export {
  ErrorCode,
  PhotoshopMcpError,
  isPhotoshopMcpError,
  type PhotoshopMcpErrorOptions,
  type SerializedPhotoshopMcpError,
} from "./protocol/errors.js";
export {
  DEFAULT_COMMAND_TIMEOUT_MS,
  EventMessageSchema,
  HelloMessageSchema,
  InboundMessageSchema,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  ReadyMessageSchema,
  ResponseMessageSchema,
  type CommandMessage,
  type ConnectionState,
  type EventMessage,
  type HelloAckAccepted,
  type HelloAckMessage,
  type HelloAckRejected,
  type HelloMessage,
  type InboundMessage,
  type OutboundMessage,
  type ReadyMessage,
  type ResponseMessage,
} from "./protocol/messages.js";
export { SERVER_NAME, SERVER_VERSION } from "./protocol/server-info.js";
export {
  FilenameSchema,
  FlatFormatSchema,
  LayeredFormatSchema,
  SaveResultSchema,
  WorkspaceStatusSchema,
  withExtension,
  type FlatFormat,
  type LayeredFormat,
  type SaveResult,
  type WorkspaceStatus,
} from "./protocol/workspace.js";
export {
  BlendModeSchema,
  DocumentInfoSchema,
  LayerInfoListSchema,
  LayerInfoSchema,
  LayerTypeSchema,
  type BlendMode,
  type DocumentInfo,
  type LayerInfo,
  type LayerType,
  type PhotoshopCommand,
} from "./protocol/types.js";
export { ToolRegistry, type ToolContext, type ToolDefinition, type ToolHandler } from "./tool.js";
export type { BridgeTransport, SendOptions } from "./transport/transport.js";
export {
  DEFAULT_HOST,
  DEFAULT_PORT,
  WebSocketBridgeTransport,
  type PluginInfo,
  type WebSocketBridgeTransportOptions,
} from "./transport/websocket-transport.js";
export {
  DOCUMENT_GET,
  LAYER_LIST,
  UXPPhotoshopBridge,
  type UXPPhotoshopBridgeOptions,
} from "./uxp-bridge.js";
