export {
  createPhotoshopMcp,
  type CreatePhotoshopMcpOptions,
  type PhotoshopMcp,
} from "./create-core.js";
export {
  CapabilityRegistry,
  spawnRunner,
  type CapabilityRegistryOptions,
  type ProcessOutcome,
  type ProcessRunner,
  type WorkspaceResolver,
} from "./capabilities/registry.js";
export { createConsoleLogger, createSilentLogger } from "./extensions/logger.js";
export {
  convertFitsToTiff,
  normalizationFor,
  readFitsHeader,
  type ConvertResult,
  type FitsMetadata,
  type Normalization,
} from "./capabilities/fits.js";
export {
  fillGroundWithSkyPlane,
  fitPlane,
  fitSkyModel,
  planeValue,
  type ChannelModel,
  type PlaneSample,
  type SkyFillResult,
} from "./capabilities/sky-fill.js";
export { EventBus, type EventBusOptions } from "./events/bus.js";
export {
  ResourceRegistry,
  affectedResources,
  type ResourceDefinition,
  type ResourceRegistryOptions,
} from "./resources/registry.js";
export { JobStore, type JobStoreOptions } from "./jobs/store.js";
export {
  PhotoshopWindowCapturer,
  describeCaptureFailure,
  parseCaptureOutput,
} from "./capture/window.js";
export { WorkflowRegistry, type WorkflowRegistryOptions } from "./workflows/registry.js";
export {
  ExtensionManager,
  type DiscoveredExtension,
  type ExtensionManagerOptions,
  type LoadedExtension,
} from "./extensions/manager.js";
export { PhotoshopMcpServer, type PhotoshopMcpServerOptions } from "./server/mcp-server.js";
