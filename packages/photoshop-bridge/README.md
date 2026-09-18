# @photoshop-mcp/photoshop-bridge

**Contracts 계층.** 의존성이 없는 최하위 패키지이며, 모든 상위 계층이 여기에 의존합니다.

- `protocol/types.ts` — `PhotoshopCommand`, `DocumentInfo`, `LayerInfo`
- `protocol/errors.ts` — 공통 오류 모델 `PhotoshopMcpError` 와 표준 오류 코드
- `protocol/server-info.ts` — `SERVER_NAME`, `SERVER_VERSION` 단일 출처
- `bridge.ts` — `PhotoshopBridge` 인터페이스
- `tool.ts` — `ToolDefinition`, `ToolRegistry`
- `mock-bridge.ts` — `MockPhotoshopBridge` (Phase 1 전용)

Tool 계약을 여기에 두는 이유는 MCP 서버 구현(`mcp-core`)과 Tool 정의(`photoshop-tools`)가
서로를 참조하지 않게 하기 위함입니다. 의존 방향은 `mcp-core → photoshop-tools` 한쪽입니다.

`photoshop-uxp` 도 이 contracts 만 의존합니다.

`transport/` 는 Phase 2(WebSocket)에서 채웁니다. 현재 비어 있습니다.
