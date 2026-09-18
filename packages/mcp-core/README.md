# @photoshop-mcp/mcp-core

MCP 외부 인터페이스 계층과 Core 조립. **라이브러리이며 실행 진입점을 갖지 않습니다.**
`bin` 은 `@photoshop-mcp/mcp-server` 에만 있습니다.

- `server/mcp-server.ts` — `PhotoshopMcpServer`. `tools/list` · `tools/call` 처리와 오류 응답 변환
- `create-core.ts` — `createPhotoshopMcp()`. Bridge → Command Engine → Tool Registry → Server 조립

Photoshop 구현 로직을 포함하지 않습니다. (ARCHITECTURE §4.1)

`ToolRegistry` 는 이 패키지가 아니라 contracts 계층(`@photoshop-mcp/photoshop-bridge`)에 있습니다.

`resources/` 는 MCP Resource 를 도입하는 Phase 12 에서 채웁니다. 현재 비어 있습니다.
