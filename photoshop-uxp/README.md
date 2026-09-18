# photoshop-uxp

Photoshop 안에서 실행되는 UXP 플러그인입니다. Photoshop MCP 의 실행 Agent 역할을 합니다.
(ARCHITECTURE §11)

의존 방향:

```text
photoshop-uxp  →  photoshop-bridge (contracts)
```

contracts(프로토콜 타입 · 에러 모델)만 의존하며 MCP 로직을 넣지 않습니다.
Node API 는 사용할 수 없습니다.

> **미구현 (Phase 2).** `manifest.json` 의 entrypoints 와 requiredPermissions,
> WebSocket 클라이언트, Command Dispatcher 는 Phase 2 에서 작성합니다.
