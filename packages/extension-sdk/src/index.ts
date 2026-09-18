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
 * Command 를 호출할 뿐, 서버를 직접 기동하지 않는다. 같은 이유로 Command 등록
 * 함수(`registerPhotoshopCommands` 등)도 노출하지 않는다 — Extension 은 Core 의
 * Command 를 **호출**할 수 있을 뿐 Core 의 구성을 바꿀 수 없다. (ARCHITECTURE §17)
 */

// ---------------------------------------------------------------------------
// Extension 작성에 필요한 계약
// ---------------------------------------------------------------------------

export {
  ExtensionManifestSchema,
  NamespaceSchema,
  PermissionSchema,
  RESERVED_NAMESPACES,
  type ExtensionContext,
  type ExtensionManifest,
  type ExtensionToolRegistry,
  type Logger,
  type Permission,
  type PhotoshopMcpExtension,
} from "@photoshop-mcp/photoshop-bridge";

// ---------------------------------------------------------------------------
// Tool · 오류 · 도메인 타입
// ---------------------------------------------------------------------------

export {
  ErrorCode,
  PhotoshopMcpError,
  isPhotoshopMcpError,
  type BlendMode,
  type DocumentInfo,
  type LayerInfo,
  type LayerType,
  type PhotoshopCommand,
  type ToolContext,
  type ToolDefinition,
  type ToolHandler,
} from "@photoshop-mcp/photoshop-bridge";

/**
 * Core Command 이름 상수.
 *
 * Extension 은 `context.commands.execute({ type: DOCUMENT_GET, params: {} })` 처럼
 * 이 상수로 Core Command 를 호출한다. 문자열을 직접 적으면 Core 가 이름을 바꿀 때
 * 조용히 깨진다.
 *
 * Command **핸들러**는 노출하지 않는다. Extension 은 Command 를 호출할 뿐
 * 구현을 바꾸거나 대체할 수 없다. (ARCHITECTURE §23)
 */
export {
  ADJUSTMENT_BRIGHTNESS_CONTRAST,
  ADJUSTMENT_CURVES,
  ADJUSTMENT_HUE_SATURATION,
  ADJUSTMENT_LEVELS,
  ADJUSTMENT_VIBRANCE,
  DOCUMENT_GET,
  FILTER_GAUSSIAN_BLUR,
  GROUP_CREATE,
  GROUP_MOVE_LAYER,
  HISTORY_UNDO,
  LAYER_BLEND_MODE,
  LAYER_CREATE,
  LAYER_DUPLICATE,
  LAYER_LIST,
  LAYER_OPACITY,
  LAYER_RENAME,
  LAYER_SELECT,
  LAYER_VISIBILITY,
  MASK_CREATE,
  MASK_DISABLE,
  MASK_ENABLE,
  PING,
  SELECTION_CLEAR,
  SELECTION_INVERT,
  SELECTION_SET,
} from "@photoshop-mcp/photoshop-tools";
