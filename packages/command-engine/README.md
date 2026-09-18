# @photoshop-mcp/command-engine

Photoshop 작업의 내부 실행 계층. MCP 에 의존하지 않습니다. (ARCHITECTURE §6, §7)

- `registry/command-registry.ts` — `CommandRegistry`, 중복 등록 거부
- `dispatcher/command-engine.ts` — `CommandEngine`, 검증 · 라우팅 · 오류 정규화

의존은 `@photoshop-mcp/photoshop-bridge` 추상화까지만입니다.

`validation/` 은 파라미터를 받는 Command 가 생기는 Phase 3 이후에 채웁니다. 현재 비어 있습니다.
