/**
 * Extension 이 사용할 수 있는 Core public API 표면.
 *
 * 의존 방향은 한 방향만 허용한다.
 *
 * ```text
 * extensions  →  extension-sdk  →  Core public API
 * ```
 *
 * Core 패키지는 Extension 을 참조하지 않는다.
 * Extension 은 Core 내부 모듈을 직접 import 하지 않고 이 패키지만 사용한다.
 *
 * MCP 서버 구현(`mcp-core`)은 노출하지 않는다. Extension 은 Tool 을 등록하고
 * Command Engine 을 호출할 뿐, 서버를 직접 기동하지 않는다.
 *
 * Phase 1 에서는 재노출만 제공한다.
 * Extension Manifest · Extension Manager · ExtensionContext · namespace 검증 ·
 * Permission 모델은 Phase 5 범위이므로 아직 포함하지 않는다.
 */

export {
  CommandEngine,
  CommandRegistry,
  type CommandContext,
  type CommandHandler,
} from "@photoshop-mcp/command-engine";

export {
  ErrorCode,
  PhotoshopMcpError,
  ToolRegistry,
  isPhotoshopMcpError,
  type DocumentInfo,
  type LayerInfo,
  type LayerType,
  type PhotoshopBridge,
  type PhotoshopCommand,
  type ToolContext,
  type ToolDefinition,
  type ToolHandler,
} from "@photoshop-mcp/photoshop-bridge";
