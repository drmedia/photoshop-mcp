# PhotoshopMCP

Photoshop를 MCP(Model Context Protocol)로 제어하기 위한 모노레포입니다.

> **현재 상태: Phase 5 (Extension SDK) 완료.**
> Core Tool 25개가 실제 Photoshop 27.8 에서 동작하고, `extensions/` 에 디렉터리를 추가하는
> 것만으로 Core 수정 없이 Tool 을 늘릴 수 있습니다.
> 문서 저장은 UXP 샌드박스 제약으로 Phase 9 (Permission System) 로 이관했습니다.

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

Core Tool 25개가 **Mock Bridge** 와 **실제 Photoshop Bridge** 양쪽에서 동작합니다.

**조회**

| MCP Tool | Command | 결과 |
|---|---|---|
| `photoshop.ping` | `PING` | 서버 상태와 Bridge 연결 여부 |
| `photoshop.document.get` | `DOCUMENT_GET` | 활성 문서 정보 |
| `photoshop.layer.list` | `LAYER_LIST` | 레이어 목록 (opacity · parentId 포함) |

**편집** — 전부 비파괴입니다. 삭제·병합은 Permission System 과 함께 이후 Phase 에서 추가합니다.

| MCP Tool | Command | 파라미터 |
|---|---|---|
| `photoshop.layer.create` | `LAYER_CREATE` | `name?` |
| `photoshop.layer.duplicate` | `LAYER_DUPLICATE` | `layerId?`, `name?` |
| `photoshop.layer.rename` | `LAYER_RENAME` | `layerId?`, `name` |
| `photoshop.layer.select` | `LAYER_SELECT` | `layerId` |
| `photoshop.layer.set_visibility` | `LAYER_VISIBILITY` | `layerId?`, `visible` |
| `photoshop.layer.set_opacity` | `LAYER_OPACITY` | `layerId?`, `opacity` |
| `photoshop.group.create` | `GROUP_CREATE` | `name?`, `layerIds?` |
| `photoshop.group.move_layer` | `GROUP_MOVE_LAYER` | `layerId`, `groupId` |
| `photoshop.history.undo` | `HISTORY_UNDO` | 없음 |

**조정 · 마스크 · 선택 · 필터** — 전부 비파괴입니다.

| MCP Tool | Command | 비고 |
|---|---|---|
| `photoshop.adjustment.curves` | `ADJUSTMENT_CURVES` | 조정 레이어. `points` 는 {input, output} 제어점 |
| `photoshop.adjustment.levels` | `ADJUSTMENT_LEVELS` | 조정 레이어 |
| `photoshop.adjustment.brightness_contrast` | `ADJUSTMENT_BRIGHTNESS_CONTRAST` | 조정 레이어 |
| `photoshop.mask.create` | `MASK_CREATE` | `revealAll` / `hideAll` / `fromSelection` |
| `photoshop.mask.enable` · `disable` | `MASK_ENABLE` · `MASK_DISABLE` | 마스크 유지한 채 전환 |
| `photoshop.selection.clear` · `invert` | `SELECTION_CLEAR` · `SELECTION_INVERT` | |
| `photoshop.filter.gaussian_blur` | `FILTER_GAUSSIAN_BLUR` | 기본 스마트 필터 |
| `photoshop.selection.set` | `SELECTION_SET` | rectangle · ellipse · canvas · layerTransparency |
| `photoshop.layer.set_blend_mode` | `LAYER_BLEND_MODE` | |
| `photoshop.adjustment.hue_saturation` | `ADJUSTMENT_HUE_SATURATION` | 조정 레이어 |
| `photoshop.adjustment.vibrance` | `ADJUSTMENT_VIBRANCE` | 조정 레이어 |

`layerId` 를 생략하면 활성 레이어를 대상으로 합니다.
편집 Tool 은 변경 후 레이어 상태를 돌려주므로 결과 확인에 목록 재조회가 필요 없습니다.

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

Photoshop 27.8 + UXP Developer Tool 실기 검증 완료.

| 계층 | 상태 |
|---|---|
| MCP 서버 · Tool · Command Engine | 단위 + 통합 테스트 |
| `MockPhotoshopBridge` | 단위 테스트 |
| `WebSocketBridgeTransport` | 통합 테스트 (핸드셰이크 · 타임아웃 · 끊김 · 재접속 · 버전 협상) |
| `UXPPhotoshopBridge` | 통합 테스트 + **실기** |
| UXP 플러그인 | **실기** — Load · 패널 · 연결 · 핸드셰이크 · 조회 · 오류 · 재연결 |

실기 확인 결과 예시:

```json
{ "id": 128, "name": "verify.psd", "width": 3000, "height": 2000,
  "bitDepth": 8, "colorMode": "RGB" }
```

문서를 모두 닫으면 `DOCUMENT_NOT_FOUND` (`recoverable: true`) 를 반환합니다.

`bitDepth` 는 8비트·16비트 문서에서 모두 확인했습니다.
Plugin 이 Photoshop 의 값을 해석하지 못하면 기본값으로 덮지 않고
`bitDepth: null` 과 원본 `rawBitDepth` 를 함께 반환합니다.

자세한 UXP 제약은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 를 참고하세요.

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
| `packages/extension-sdk` | Extension 용 Core public API 표면 | photoshop-tools, command-engine, photoshop-bridge |

`ToolDefinition` / `ToolRegistry` 는 contracts 계층에 있습니다. MCP 서버 구현과 Tool 정의가
서로를 참조하지 않게 하기 위한 것입니다.

Extension 은 별도 계통입니다. Core 는 Extension 을 참조하지 않습니다.

```text
extensions → extension-sdk → Core public API
```

자세한 규칙은 [CLAUDE.md](CLAUDE.md#의존-방향) 를 참고하세요.

그 밖에:

- `photoshop-uxp/` — Photoshop UXP 플러그인. contracts 만 의존합니다 (Phase 2)
- `extensions/example-extension/` — 예제 확장. `example.hello`, `example.document_summary`
- `tests/` — 단위/통합 테스트

## Extension

서버는 기동할 때 `extensions/` 를 한 단계 훑어 `<name>/extension.json` 을 찾아 적재합니다.
`PHOTOSHOP_MCP_EXTENSIONS` 로 다른 디렉터리를 지정할 수 있습니다.

Extension 은 자신의 namespace 로만 Tool 을 등록할 수 있습니다. `photoshop.*` 이나 다른
Extension 의 namespace 를 쓰면 적재가 거부됩니다. 하나가 잘못되어도 나머지 Extension 과
서버는 계속 기동합니다.

작성법은 [`packages/extension-sdk/README.md`](packages/extension-sdk/README.md) 를 보세요.

## 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [로드맵](docs/ROADMAP.md) — Phase 별 진행 상황
- [프로토콜](docs/PROTOCOL.md) — Bridge 메시지 규약과 3단계 핸드셰이크
- [확장 SDK](packages/extension-sdk/README.md) — Extension 작성법과 공개 API 표면

## 아직 없는 것

현재 Phase 범위 밖이라 의도적으로 구현하지 않았습니다.

- destructive 명령(`layer.delete`, `flatten`)과 문서 저장 — Permission System 과 함께 (Phase 9)
- Permission **강제** — manifest 의 `permissions` 는 선언만 받습니다 (Phase 9)
- Capability Registry (Phase 8), MCP Resource (Phase 12), Event · Job 시스템
- Extension 의 Command 등록 — Extension 은 Core Command 를 호출만 합니다
- Extension hot reload — 서버 재시작 없이 다시 적재하는 기능은 없습니다
- 임의 `batchPlay` descriptor 실행, 임의 JavaScript 실행 — **비목표**입니다 (ARCHITECTURE §23, §33)

## 다음 단계

[docs/ROADMAP.md](docs/ROADMAP.md) 가 Phase 의 유일한 기준입니다.
