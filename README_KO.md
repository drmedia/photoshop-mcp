# PhotoshopMCP

Photoshop를 MCP(Model Context Protocol)로 제어하기 위한 모노레포입니다.

> 영어: [README.md](README.md)

## 필요한 것

| | |
|---|---|
| Photoshop | 24.0 이상. **27.8 에서 실기 검증** |
| Node | 22.12 이상 (런타임 자체는 18+ 로 돌지만 개발·테스트 도구가 요구) |
| OS | Windows. macOS 는 `window.capture` 만 미지원이고 나머지는 미검증 |
| 플러그인 | UXP 플러그인을 Photoshop 에 적재해야 합니다 ([연결](#photoshop-연결)) |

MCP 클라이언트는 Claude Code · VS Code Copilot Chat 에서 확인했습니다.

> **현재 상태: Phase 13 (Production Hardening) 까지 완료. Phase 14 (Distribution) 는 준비만 되어 있습니다.**
> Core Tool 95개, Resource 6개. Extension 4개(`example` 2 · `graxpert` 2 · `rcastro` 3 ·
> `starnet` 1)를 포함해 Photoshop 27.8 에서 실기 검증했습니다.
> 모든 Tool 과 Command 가 권한 레벨을 선언하며, 기본값은 `read` · `edit` 만 허용합니다.
> npm 에는 아직 올리지 않았습니다 — 클론해서 쓰십시오.

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
npm run check        # format + lint + build + typecheck:tests + test
npm test
npm run lint
npm run typecheck:tests   # tests/ 타입체크
npm run format
```

`tests/` 는 `tsc -b` 대상이 아니라 `tsconfig.test.json` 으로 따로 타입체크합니다.
테스트가 패키지 소스를 직접 참조하기 때문입니다.

## 권한

모든 Tool 과 Command 가 권한 레벨을 선언합니다. 기본 허용은 `read` 와 `edit` 뿐입니다.

| Level | 내용 | 해당 |
|---|---|---|
| `read` | 읽기만 합니다 | `ping`, `document.get`, `layer.list`, `workspace.status` |
| `edit` | 문서를 바꾸지만 되돌릴 수 있습니다 | 레이어 · 그룹 · 조정 · 마스크 · 선택 · 필터 (21개) |
| `external` | Photoshop 밖에 씁니다. **덮어쓰지 않습니다** | `document.save_as`, `document.export` |
| `destructive` | 되돌릴 수 없습니다 | `document.save` (원본 덮어쓰기) |

```bash
PHOTOSHOP_MCP_ALLOW=read                    # 읽기 전용 서버
PHOTOSHOP_MCP_ALLOW=read,edit,external      # 저장까지 허용 (덮어쓰기는 제외)
PHOTOSHOP_MCP_ALLOW=all                     # 전부
```

값을 주면 그것이 **전체 목록**입니다. 기본값에 더하지 않습니다.

강제 지점은 Command Engine 입니다. Extension 이 Tool 을 거치지 않고 Command 를 직접
호출할 수 있기 때문입니다. Tool 의 레벨은 `tools/list` 노출용이자 빠른 실패용입니다.

## 파일 저장

저장 폴더는 **사용자가 Photoshop 의 'Photoshop MCP' 패널에서 승인**합니다.
`getFolder()` 가 사용자 제스처를 요구하므로 서버가 대신할 수 없습니다.

이것은 제약이자 안전장치입니다 — LLM 은 저장 폴더를 고를 수 없고 파일 이름만 줍니다.
경로 구분자와 `..` 는 스키마가 거부합니다.

`save_as` (psd · psb, 레이어 유지) 와 `export` (png · jpg · tiff, 평탄화) 는 같은 이름이
있으면 덮어쓰지 않고 실패합니다.

TIFF 는 16비트를 유지할 수 있어 외부 천체사진 처리기의 교환 형식으로 씁니다.
`bitDepth: 16` 으로 지정하거나 생략해 문서 심도를 따를 수 있으며, 결과의 `bitDepth` 에
**실제로 쓰인** 심도가 담깁니다. 덮어쓰기는 `document.save` 하나뿐이며 `destructive` 입니다.

## 외부 처리기 (Capability)

Extension 은 특정 프로그램이 아니라 **기능**을 요청합니다 — `gradientRemoval`, `starRemoval`.

처리기가 요청한 이름·형식으로 만들어 주지 않으면 그 보정도 설정에 선언합니다.
GraXpert 3.0.2 는 `-output out.tif` 를 줘도 `out.tif.fits` 를 만들고 Photoshop 은 FITS 를
읽지 못합니다. `outputSuffix` 와 `convert` 를 선언하면 실제 파일을 찾아 16비트 TIFF 로
바꾸고 중간 파일을 지웁니다. 호출하는 쪽은 요청한 파일이 나온다고만 알면 됩니다.

```bash
cp capabilities.example.json capabilities.json   # 실행 파일 경로를 고쳐서 쓰세요
```

`photoshop.capability.list` 로 무엇이 설정되어 있고 쓸 수 있는지 확인합니다.
쓸 수 없으면 이유(`실행 파일을 찾을 수 없습니다` 등)를 함께 줍니다.

**실행 Tool 은 없습니다.** Capability 실행은 "내보내기 → 외부 처리 → 되돌리기" 흐름의
가운데 토막이라, LLM 이 직접 부르면 앞뒤가 빠집니다. 실행은 Extension 이 합니다.

안전 규칙은 batchPlay 와 같습니다 — 임의의 프로그램과 인자를 실행할 수 없습니다.
실행 파일은 설정 파일에서만 오고(절대 경로), 인자는 선언된 파라미터로만 조립되며,
shell 을 거치지 않고, 입출력은 승인된 작업 폴더 안의 파일 이름뿐입니다.

## 리소스

문서·레이어·선택 영역·History·외부 처리기·Extension 을 MCP Resource 로 노출합니다.
Tool 이 **행동**이라면 Resource 는 **맥락**입니다 — 클라이언트가 미리 읽어 대화에
붙일 수 있습니다.

```
photoshop://document/current   photoshop://layers
photoshop://selection          photoshop://history
photoshop://capabilities       photoshop://extensions
```

구독하면 문서를 바꾸는 작업이 끝날 때 `notifications/resources/updated` 가 옵니다.
폴링이 필요 없습니다. 읽기 작업은 알리지 않습니다.

## 문제가 생기면

```
photoshop.diagnostics
```

Bridge 연결·권한·외부 처리기·Extension·워크플로·Job 을 한 번에 보고하고,
막힌 것은 **고치는 방법을 함께** 알려줍니다.

## 임시 파일

외부 처리기는 한 번 돌 때마다 16비트 TIFF 를 여러 개 만듭니다 — 4032×6048 이면
파일 하나가 140MB 입니다.

```
photoshop.workspace.usage    # 무엇이 얼마나 쌓였는지 (큰 것부터)
photoshop.workspace.delete   # 이름을 명시한 것만 삭제 (destructive)
```

패턴이나 와일드카드를 받지 않습니다. 승인된 폴더는 사용자의 폴더이고 우리가 만든
파일만 있다는 보장이 없습니다.

## 이벤트

`photoshop.event.recent` 로 최근에 일어난 일을 조회합니다. `after: lastSeq` 를 넘기면
새로 생긴 것만 받습니다. MCP 에는 임의 이벤트를 밀어주는 통로가 없어 폴링 방식입니다.
Extension 은 `context.events.on()` 으로 구독할 수 있습니다.

```
command.started   / command.completed / command.failed
```

**Photoshop 변경 알림(`photoshop.*`)도 동작합니다.** 한동안 "오지 않는다" 고 적어
두었는데 틀렸습니다 — 이름 있는 이벤트로만 시험했기 때문입니다. `startNotifications`
를 `["all"]` 로 등록해야 옵니다. 아는 액션만 이름을 붙이고 나머지는
`photoshop.unknown` 으로 원본과 함께 나갑니다.

## 워크플로

자주 하는 Tool 순서를 `workflows.json` 에 선언합니다. Extension 을 만들려면 TypeScript 를
쓰고 빌드해야 하는데, 순서만 바꾸고 싶을 때는 과합니다.

```json
{
  "workflows": [{
    "id": "starless-sharpen",
    "name": "별 분리 후 선명화",
    "steps": [
      { "tool": "starnet.remove_stars", "label": "별 분리", "awaitJob": true },
      { "tool": "photoshop.layer.select",
        "input": { "layerId": "{{steps.0.result.starless.id}}" } },
      { "tool": "rcastro.bxt", "awaitJob": true,
        "input": { "sharpenNonstellar": 0.4 } }
    ]
  }]
}
```

값 전달은 `{{steps.N.result.<경로>}}` 형태만 허용합니다. **임의 식을 평가하지 않습니다** —
`{{1 + 1}}` 은 등록 시점에 거부됩니다. 식을 평가하는 순간 워크플로가 실행 엔진이 됩니다.

한 단계가 실패하면 멈추고 뒤 단계는 건너뜁니다. **앞 단계가 만든 것은 되돌리지 않습니다** —
되돌리려면 History 를 되감아야 하는데 그 사이 사용자가 한 편집까지 날아갑니다.

## 긴 작업 (Job)

**MCP 기본 요청 타임아웃은 60초**인데 외부 처리기는 더 걸립니다. 실기에서 StarNet2가
4032×6048 이미지를 67초에 처리했고, 그대로 부르면 `-32001 Request timed out` 이 납니다.

그래서 오래 걸리는 Tool 은 **즉시 jobId 를 반환**하고 상태를 따로 조회합니다.

```
starnet.remove_stars →  { jobId: "09f3ad43-..." }    0초
photoshop.job.status →  running | 25% StarNet2 로 별 분리 중
photoshop.job.status →  completed | result: {...}    75초
```

`photoshop.job.cancel` 은 외부 프로세스를 실제로 종료합니다. 서버를 정지하면 진행 중인
Job 이 모두 취소됩니다 — 그러지 않으면 외부 프로세스가 서버보다 오래 삽니다.

Job 은 메모리에만 있어 서버를 다시 띄우면 사라집니다.

## 지금 동작하는 것

Core Tool 95개, Resource 6개가 **Mock Bridge** 와 **실제 Photoshop Bridge** 양쪽에서 동작합니다.
전체 목록과 Permission 기준은 [docs/CORE_API.md](docs/CORE_API.md) 에 있습니다.

**조회**

| MCP Tool | Command | 결과 |
|---|---|---|
| `photoshop.ping` | `PING` | 서버 상태와 Bridge 연결 여부 |
| `photoshop.document.get` | `DOCUMENT_GET` | 활성 문서 정보 |
| `photoshop.layer.list` | `LAYER_LIST` | 레이어 목록 (opacity · parentId 포함) |
| `photoshop.layer.get_active` | `LAYER_GET_ACTIVE` | 지금 선택된 레이어. 여러 개일 수 있다 |

**편집** — 아래는 전부 비파괴입니다. 삭제(`layer.delete`)와 평탄화(`document.flatten`)도 있으며 `destructive` 로 분류되어 기본 허용 밖입니다.

| MCP Tool | Command | 파라미터 |
|---|---|---|
| `photoshop.layer.create` | `LAYER_CREATE` | `name?` |
| `photoshop.layer.duplicate` | `LAYER_DUPLICATE` | `layerId?`, `name?` |
| `photoshop.layer.rename` | `LAYER_RENAME` | `layerId?`, `name` |
| `photoshop.layer.select` | `LAYER_SELECT` | `layerId` |
| `photoshop.layer.set_visibility` | `LAYER_VISIBILITY` | `layerId?`, `visible` |
| `photoshop.layer.set_opacity` | `LAYER_OPACITY` | `layerId?`, `opacity` |
| `photoshop.layer.set_fill_opacity` | `LAYER_FILL_OPACITY` | `layerId?`, `fillOpacity` |
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
| `photoshop.mask.apply` | `MASK_APPLY` | 픽셀에 굽고 없앤다. **DESTRUCTIVE** |
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

제대로 붙었는지는 한 번에 확인할 수 있습니다.

```bash
npm run build && npm run verify:live
```

실제 MCP 클라이언트를 stdio 로 붙여 서버 기동 · Photoshop 연결 · Resource 읽기 ·
권한 경계 · stdout 오염을 확인합니다. 실패하면 서버 로그를 함께 출력하고 종료 코드
1 로 끝납니다. Photoshop 이 필요하므로 `npm test` 에는 들어 있지 않습니다.

## 검증 상태

Photoshop 27.8 + UXP Developer Tool 실기 검증 완료.

| 계층 | 상태 |
|---|---|
| MCP 서버 · Tool · Command Engine | 단위 + 통합 테스트 |
| `MockPhotoshopBridge` | 단위 테스트 |
| `WebSocketBridgeTransport` | 통합 테스트 (핸드셰이크 · 타임아웃 · 끊김 · 재접속 · 버전 협상) |
| `UXPPhotoshopBridge` | 통합 테스트 + **실기** |
| UXP 플러그인 | **실기** — Load · 패널 · 연결 · 핸드셰이크 · 조회 · 오류 · 재연결 |
| 파일 왕복 (`export` → 외부 처리기 → `place`) | **실기** — 4032×6048 16비트, 전 구간 16비트 유지 |
| Capability (StarNet2 · BXT · GraXpert) | **실기** — 67초 · 10초 · 7초 |
| Job · Workflow | **실기** — 실제 MCP 클라이언트로 81초 워크플로 완주 (60초 타임아웃 없음) |
| Resource | **실기** — `resources/list` 6개, 구독 후 변경 알림 도착 |
| 진단 · 임시 파일 정리 | **실기** — `usage`/`delete` 로 1.7GB → 5KB |

Photoshop 변경 알림도 실기에서 수신을 확인했습니다 — `startNotifications` 를
`["all"]` 로 등록해야 합니다. 이름으로 등록하면 오지 않습니다.

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
| `packages/extension-api` | Extension 용 Core public API 표면 | photoshop-tools, command-engine, photoshop-bridge |

`ToolDefinition` / `ToolRegistry` 는 contracts 계층에 있습니다. MCP 서버 구현과 Tool 정의가
서로를 참조하지 않게 하기 위한 것입니다.

Extension 은 별도 계통입니다. Core 는 Extension 을 참조하지 않습니다.

```text
extensions → extension-api → Core public API
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

작성법은 [`packages/extension-api/README.md`](packages/extension-api/README.md) 를 보세요.

## 문서

- [아키텍처](docs/ARCHITECTURE.md)
- [Core API](docs/CORE_API.md) — 구현된 Tool 61개와 후보 목록, Permission 기준
- [로드맵](docs/ROADMAP.md) — Phase 별 진행 상황
- [프로토콜](docs/PROTOCOL.md) — Bridge 메시지 규약과 3단계 핸드셰이크
- [확장 SDK](packages/extension-api/README.md) — Extension 작성법과 공개 API 표면

## 아직 없는 것

현재 Phase 범위 밖이라 의도적으로 구현하지 않았습니다.

- Capability 진행률의 실제 퍼센트 — 지금은 단계만 보고합니다
  (StarNet2 의 `--machine-progress` 출력을 파싱하면 가능합니다)
- Job 의 영속성 — 메모리에만 있어 서버를 다시 띄우면 사라집니다
- Extension 의 Command 등록 — Extension 은 Core Command 를 호출만 합니다
- Extension hot reload — 서버 재시작 없이 다시 적재하는 기능은 없습니다
- 임의 `batchPlay` descriptor 실행, 임의 JavaScript 실행 — **비목표**입니다 (ARCHITECTURE §23, §33)

## 다음 단계

[docs/ROADMAP.md](docs/ROADMAP.md) 가 Phase 의 유일한 기준입니다.

## 라이선스

[MIT](LICENSE). 의존하는 패키지도 모두 허용적입니다 — `ws` · `zod` ·
`@modelcontextprotocol/sdk` 는 MIT, `zod-to-json-schema` 는 ISC 입니다.
