# PhotoshopMCP

Photoshop를 MCP(Model Context Protocol)로 제어하기 위한 모노레포입니다.

> **현재 상태: Phase 1 (MCP Core) 완료.**
> 실제 Photoshop 연결은 없습니다. `MockPhotoshopBridge` 로 동작합니다.
> 실제 연결(WebSocket + UXP 플러그인)은 Phase 2 범위입니다.

## 빠른 시작

```bash
npm install
```

### 개발

빌드 없이 TypeScript 소스를 바로 실행합니다. (`tsx` + `development` export 조건)

```bash
npm run dev          # 1회 실행
npm run dev:watch    # 파일 변경 시 재시작
```

### 프로덕션

```bash
npm run build
npm start
```

`bin/photoshop-mcp.js` 는 `dist/` 를 참조하므로 빌드 없이 `npm start` 하면 실패합니다.
`npm start` 에 자동 빌드를 걸지 않는 것은 의도된 선택입니다.

### 검증

```bash
npm run check        # lint + build + test
npm test
npm run lint
npm run format
```

## 지금 동작하는 것

Mock Bridge 위에서 MCP Tool 3개가 동작합니다.

| MCP Tool | 내부 Command | 결과 |
|---|---|---|
| `photoshop.ping` | `PING` | 서버 상태와 Bridge 연결 여부 |
| `photoshop.document.get` | `DOCUMENT_GET` | 활성 문서 정보 |
| `photoshop.layer.list` | `LAYER_LIST` | 레이어 목록 |

호출 경로는 항상 다음과 같습니다. Tool 은 Bridge 를 직접 호출하지 않습니다.

```text
MCP Client → Tool Handler → Command Engine → Photoshop Bridge
```

## 패키지 구성

의존은 단방향입니다.

```text
mcp-server → mcp-core → photoshop-tools → command-engine → photoshop-bridge (contracts)
                                                                   ↑
                                                            photoshop-uxp (Phase 2)
```

| 경로 | 역할 | 직접 의존 |
|---|---|---|
| `packages/photoshop-bridge` | **contracts.** Bridge 인터페이스, 프로토콜 타입, 에러 모델, Tool 계약, Mock 구현 | 없음 |
| `packages/command-engine` | `CommandRegistry`, `CommandEngine`. MCP 를 알지 못함 | photoshop-bridge |
| `packages/photoshop-tools` | Photoshop Core Tool / Command 정의 | command-engine, photoshop-bridge |
| `packages/mcp-core` | `PhotoshopMcpServer`, `createPhotoshopMcp()`. **라이브러리 (bin 없음)** | photoshop-tools, command-engine, photoshop-bridge |
| `packages/mcp-server` | 실행 진입점 `bin/photoshop-mcp` | mcp-core |
| `packages/extension-sdk` | Extension 용 Core public API 표면 | command-engine, photoshop-bridge |

`ToolDefinition` / `ToolRegistry` 는 contracts 계층에 있습니다. MCP 서버 구현과 Tool 정의가
서로를 참조하지 않게 하기 위한 것입니다.

Extension 은 별도 계통입니다. Core 는 Extension 을 참조하지 않습니다.

```text
extensions → extension-sdk → Core public API
```

자세한 규칙은 [CLAUDE.md](CLAUDE.md#의존-방향) 를 참고하세요.

그 밖에:

- `photoshop-uxp/` — Photoshop UXP 플러그인. contracts 만 의존합니다 (Phase 2)
- `extensions/example-extension/` — 예제 확장 (Phase 5)
- `tests/` — 단위/통합 테스트

## 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [로드맵](docs/ROADMAP.md) — Phase 별 진행 상황
- [프로토콜](docs/PROTOCOL.md) — Phase 2에서 작성
- [확장 SDK](docs/EXTENSION_SDK.md) — Phase 5에서 작성

## 아직 없는 것

Phase 1 범위 밖이라 의도적으로 구현하지 않았습니다.

- WebSocket transport, UXP 플러그인, 실제 Photoshop 연결 (Phase 2)
- 레이어 생성·복제·마스크·Curves 등 편집 Command (Phase 3~4)
- Extension Manifest / Manager / Context, namespace 검증, Permission 모델 (Phase 5)
- MCP Resource, Event, Job 시스템
- 임의 `batchPlay` descriptor 실행, 임의 JavaScript 실행 — **비목표**입니다 (ARCHITECTURE §23, §33)

## 다음 단계 (Phase 2)

1. `docs/PROTOCOL.md` 작성
2. `packages/photoshop-bridge/src/transport/` — WebSocket 서버, 요청 ID, 타임아웃, 재연결
3. `photoshop-uxp/` — 플러그인 부트스트랩, WebSocket 클라이언트, Command Dispatcher
4. `MockPhotoshopBridge` → `UXPPhotoshopBridge` 교체 (인터페이스 유지)
