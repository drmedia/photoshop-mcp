# PhotoshopMCP

Photoshop를 MCP(Model Context Protocol)로 제어하기 위한 모노레포입니다.

> **현재 상태: Phase 2 (Photoshop Bridge) 구현 완료, 실기 검증 대기.**
> WebSocket Bridge · UXP 플러그인 · 실제 `DOCUMENT_GET` / `LAYER_LIST` 를 구현했습니다.
> Photoshop DOM 호출부는 Photoshop 실기 확인이 필요합니다. 아래 [검증 상태](#검증-상태) 참고.

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

MCP Tool 3개가 **Mock Bridge** 와 **실제 Photoshop Bridge** 양쪽에서 동작합니다.

| MCP Tool | 내부 Command | 결과 |
|---|---|---|
| `photoshop.ping` | `PING` | 서버 상태와 Bridge 연결 여부 |
| `photoshop.document.get` | `DOCUMENT_GET` | 활성 문서 정보 |
| `photoshop.layer.list` | `LAYER_LIST` | 레이어 목록 |

호출 경로는 항상 다음과 같습니다. Tool 은 Bridge 를 직접 호출하지 않습니다.

```text
MCP Client → Tool Handler → Command Engine → Photoshop Bridge
                                                   │
                            ┌──────────────────────┴───────────────────┐
                            │                                          │
                   MockPhotoshopBridge                      UXPPhotoshopBridge
                   (Photoshop 불필요)                                  │
                                                          WebSocketBridgeTransport
                                                                   ═ WebSocket ═
                                                              Photoshop UXP Plugin
                                                                       │
                                                                   Photoshop
```

Photoshop 이 실행 중이 아니어도 MCP 서버는 정상 기동합니다.
이때 Photoshop 이 필요한 Tool 은 `PHOTOSHOP_NOT_CONNECTED` 를 반환합니다.

Bridge 는 환경 변수로 고릅니다.

```bash
npm run dev                              # UXP Bridge (기본). ws://127.0.0.1:8765 대기
PHOTOSHOP_MCP_BRIDGE=mock npm run dev    # Mock Bridge. Photoshop·플러그인 불필요
```

## Photoshop 연결

1. MCP 서버를 띄웁니다. `npm run build && npm start`
2. `npm run build` 로 `photoshop-uxp/dist/` 를 만듭니다.
3. Adobe UXP Developer Tool 에서 `photoshop-uxp/manifest.json` 을 Add → Load 합니다.
4. Photoshop 패널 `플러그인 > Photoshop MCP` 에서 Bridge 상태를 확인합니다.

순서는 상관없습니다. 플러그인이 지수 백오프로 재접속합니다.
자세한 내용은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 를 참고하세요.

## 검증 상태

| 계층 | 상태 |
|---|---|
| MCP 서버 · Tool · Command Engine | 단위 + 통합 테스트 통과 |
| `MockPhotoshopBridge` | 단위 테스트 통과 |
| `WebSocketBridgeTransport` | 통합 테스트 통과 (요청/응답 · 타임아웃 · 끊김 · 재접속 · 버전 협상) |
| `UXPPhotoshopBridge` | 통합 테스트 통과 (가짜 플러그인 대상) |
| UXP `CommandDispatcher` · 열거형 매핑 | 단위 테스트 통과 |
| **Photoshop DOM 호출부** | **미검증.** Photoshop 실기 확인 필요 |
| **manifest · 패널 · UXP WebSocket 클라이언트** | **미검증.** Photoshop 실기 확인 필요 |

통합 테스트는 PROTOCOL.md 를 구현한 가짜 UXP 플러그인을 실제 WebSocket 으로 붙여
서버 측 전 구간을 검증합니다. Photoshop 런타임이 필요한 부분은 그 범위 밖입니다.

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

Phase 2 범위 밖이라 의도적으로 구현하지 않았습니다.

- 레이어 생성·복제·이름 변경·불투명도·그룹 (Phase 3)
- 마스크·선택 영역·Curves·Levels·필터·저장 (Phase 4)
- Extension Manifest / Manager / Context, namespace 검증, Permission 모델 (Phase 5)
- MCP Resource, Event, Job 시스템
- 레이어의 Opacity 와 Parent (Phase 3 에서 `LAYER_LIST` 에 추가)
- 임의 `batchPlay` descriptor 실행, 임의 JavaScript 실행 — **비목표**입니다 (ARCHITECTURE §23, §33)

## 다음 단계 (Phase 3)

1. `LAYER_CREATE` · `LAYER_DUPLICATE` · `LAYER_RENAME` · `LAYER_SELECT`
2. `LAYER_VISIBILITY` · `LAYER_OPACITY`
3. `GROUP_CREATE` · `GROUP_MOVE_LAYER`
4. `photoshop.history.undo`

destructive 명령(`layer.delete`, `flatten`)은 Permission System 과 함께 이후 Phase 에 추가합니다.
