# Photoshop MCP Server Roadmap

## 1. Goal

Photoshop MCP Server의 목표는 LLM Client가 Adobe Photoshop을 MCP를 통해 안전하고 구조화된 방식으로 제어할 수 있도록 하는 범용 플랫폼을 구축하는 것이다.

이 프로젝트는 특정 도메인에 종속되지 않는다.

예를 들어 다음은 Core가 담당한다.

```text
photoshop.document.get
photoshop.layer.list
photoshop.layer.create
photoshop.layer.duplicate
photoshop.mask.create
photoshop.adjustment.curves
```

반면 다음과 같은 기능은 Extension으로 구현한다.

```text
rcastro.*
starnet.*
portrait.*
landscape.*
```

첫 번째 실제 Extension은 `MilkyScapeTools`를 사용한다.

---

# 2. Development Principles

개발은 반드시 Phase 단위로 진행한다.

다음 Phase로 넘어가기 전에 현재 Phase가 다음 조건을 만족해야 한다.

- Build 성공
- Unit Test 성공
- 기존 테스트 Regression 없음
- 주요 Error Case 테스트 완료
- 관련 문서 업데이트
- Git Commit 완료

현재 Phase가 완료되지 않은 상태에서 이후 Phase 기능을 선행 구현하지 않는다.

---

# 3. Phase Overview

이 목록이 Phase 의 유일한 기준이다. 아래 상세 섹션과 번호·이름이 일치해야 한다.
`docs/ARCHITECTURE.md` 는 구조와 원칙을 다루며, 진행 기준은 이 문서를 따른다.

```text
Phase 0   Project Bootstrap            완료
Phase 1   MCP Core                     완료
Phase 2   Photoshop Bridge             완료
Phase 3   Basic Photoshop Editing      완료
Phase 4   Extended Photoshop Tools     완료 (저장은 Phase 9 에서 처리)
Phase 5   Extension SDK                완료
Phase 6   MilkyScapeTools Extension    완료 (범위 축소 — §10 참조)
Phase 7   Workflow System              완료
Phase 8   Capability System            완료
Phase 9   Permission / Safety          완료
Phase 10  Job System                   완료
Phase 11  Events                       완료 (photoshop.* 는 UXP 미지원)
Phase 12  MCP Resources                완료
Phase 13  Production Hardening         완료
Phase 14  Distribution                 남음
```

각 Phase 의 항목별 진행 상황은 해당 섹션의 체크박스로 추적한다.

번호 순서대로 진행하지 않았다. Phase 6 의 Tool 이 외부 프로그램을 필요로 하는데
ROADMAP 자신이 "외부 도구는 Capability Provider 로 구현한다"(§12)고 정하고 있어,
실제로는 **9 → 8 → 6 → 10 → 7** 순으로 진행했다.

각 Phase 가 다음 Phase 의 필요를 실측으로 드러냈다.

- Phase 9 가 파일 접근을 풀어 외부 프로그램에 픽셀을 넘길 통로가 생겼다
- Phase 6 이 StarNet2 실측 67초를 만들었고, MCP 기본 타임아웃 60초를 넘겨 Phase 10 이
  필요하다는 것이 증명되었다
- Phase 10 의 Job 이 있어야 Phase 7 의 긴 워크플로가 성립한다

남은 것: Phase 14 Distribution.

GraXpert 연동을 막던 FITS → TIFF 변환은 Phase 12 뒤에 붙였다. (§10, §12)

---

# 4. Phase 0 — Project Bootstrap

## Objective

개발 프로젝트의 기본 구조와 규칙을 만든다.

## Tasks

- [x] Git repository 생성
- [x] Node.js / TypeScript 프로젝트 초기화
- [x] Package Manager 결정
- [x] Monorepo 구조 생성
- [x] TypeScript 설정
- [x] Lint 설정
- [x] Formatter 설정
- [x] Unit Test Framework 설정
- [x] `CLAUDE.md` 작성
- [x] `docs/ARCHITECTURE.md` 작성
- [x] `docs/ROADMAP.md` 작성
- [x] `README.md` 작성
- [x] 기본 CI script 작성

권장 구조:

```text
PhotoshopMCP/
│
├─ CLAUDE.md
├─ README.md
├─ package.json
│
├─ docs/
│   ├─ ARCHITECTURE.md
│   ├─ ROADMAP.md
│   ├─ PROTOCOL.md
│   └─ EXTENSION_API.md
│
├─ packages/
│   ├─ mcp-core/
│   ├─ command-engine/
│   ├─ photoshop-tools/
│   ├─ photoshop-bridge/
│   └─ extension-api/
│
├─ photoshop-uxp/
│
├─ extensions/
│
└─ tests/
```

## Completion Criteria

```text
npm install

npm run build

npm test
```

가 오류 없이 실행되어야 한다.

아직 Photoshop 연결은 하지 않는다.

---

# 5. Phase 1 — MCP Core

## Objective

Photoshop 없이도 실행 가능한 MCP Core를 만든다.

이 단계에서는 실제 Photoshop과 연결하지 않는다.

Mock Photoshop Bridge를 사용한다.

---

## 5.1 MCP Server Bootstrap

구현:

- [x] MCP Server 시작
- [x] Tool 등록
- [x] Tool 목록 반환
- [x] Tool 호출 처리
- [x] Error Response 처리

초기 Tool:

```text
photoshop.ping
```

예상 결과:

```json
{
  "status": "ok",
  "server": "PhotoshopMCP"
}
```

---

## 5.2 Tool Registry

구현:

- [x] Tool registration
- [x] Duplicate name validation
- [x] Tool lookup
- [x] Tool listing
- [x] Input schema validation

Interface 예:

```typescript
interface ToolRegistry {
  register(tool: ToolDefinition): void;

  get(name: string): ToolDefinition | undefined;

  list(): ToolDefinition[];
}
```

---

## 5.3 Command Registry

구현:

- [x] Command 등록
- [x] Command 조회
- [x] Duplicate Command 방지
- [x] Command 실행

초기 Command:

```text
PING

DOCUMENT_GET

LAYER_LIST
```

---

## 5.4 Command Engine

구현:

- [x] Command validation
- [x] Command routing
- [x] Command execution
- [x] Error normalization

흐름:

```text
Tool Handler
   ↓
Command Engine
   ↓
Command Registry
   ↓
Bridge
```

---

## 5.5 Mock Photoshop Bridge

구현:

- [x] `MockPhotoshopBridge`
- [x] Document Mock
- [x] Layer Mock
- [x] Error simulation

Mock document:

```json
{
  "id": 1,
  "name": "test.psd",
  "width": 6048,
  "height": 4024,
  "bitDepth": 16,
  "colorMode": "RGB"
}
```

Mock layers:

```json
[
  {
    "id": 10,
    "name": "Background",
    "type": "pixel",
    "visible": true
  }
]
```

---

## 5.6 Initial Core Tools

구현:

- [x] `photoshop.ping`
- [x] `photoshop.document.get`
- [x] `photoshop.layer.list`

---

## 5.7 Tests

필수 테스트:

- [x] Tool 등록
- [x] Duplicate Tool 방지
- [x] Command 등록
- [x] Unknown Command 처리
- [x] Mock Document 조회
- [x] Mock Layer 조회
- [x] Invalid parameter 처리
- [x] Bridge error 처리

---

## Phase 1 Completion Criteria

다음 호출이 Mock Bridge에서 정상 동작해야 한다.

```text
photoshop.ping

photoshop.document.get

photoshop.layer.list
```

실제 Photoshop 없이 테스트가 가능해야 한다.

---

# 6. Phase 2 — Photoshop Bridge

## Objective

실제 Photoshop과 MCP Server를 연결한다.

구조:

```text
MCP Server

    ↓

Photoshop Bridge

    ↓

WebSocket

    ↓

UXP Plugin

    ↓

Photoshop
```

---

## 6.1 Bridge Protocol

작성:

- [x] `docs/PROTOCOL.md`

Request 형식:

```json
{
  "id": "req-001",
  "type": "command",
  "command": "DOCUMENT_GET",
  "payload": {}
}
```

Response:

```json
{
  "id": "req-001",
  "success": true,
  "result": {}
}
```

Error:

```json
{
  "id": "req-001",
  "success": false,
  "error": {
    "code": "DOCUMENT_NOT_FOUND",
    "message": "No active document."
  }
}
```

---

## 6.2 WebSocket Transport

구현:

- [x] WebSocket Server
- [x] UXP Connection tracking
- [x] Request ID
- [x] Timeout
- [x] Response routing
- [x] Reconnect handling

---

## 6.3 Photoshop UXP Project

생성:

```text
photoshop-uxp/
```

구현:

- [x] manifest
- [x] plugin bootstrap
- [x] WebSocket Client
- [x] Command Dispatcher
- [x] Response Sender
- [x] Connection Status UI

---

## 6.4 Document Get

실제 Photoshop 연결:

```text
photoshop.document.get
```

반환:

```text
Document ID
Document name
Width
Height
Bit depth
Color mode
Active layer
```

---

## 6.5 Layer List

실제 Photoshop 연결:

```text
photoshop.layer.list
```

반환:

```text
Layer ID
Layer name
Layer type
Visibility
Opacity
Parent
```

---

## 6.6 Tests

- [x] WebSocket Request / Response
- [x] Timeout
- [x] Disconnect
- [x] Reconnect
- [x] Unknown command
- [x] Photoshop not connected
- [x] No active document

---

## Phase 2 Completion Criteria

Claude Code 또는 MCP Client에서:

```text
현재 Photoshop 문서 정보 보여줘.
```

요청 시 실제 Photoshop의 문서 정보가 반환되어야 한다.

---

# 7. Phase 3 — Basic Photoshop Editing

## Objective

Photoshop의 기본적인 비파괴 작업을 MCP로 수행한다.

---

## 7.1 Layer Commands

구현:

- [x] `LAYER_CREATE`
- [x] `LAYER_DUPLICATE`
- [x] `LAYER_RENAME`
- [x] `LAYER_SELECT`
- [x] `LAYER_VISIBILITY`
- [x] `LAYER_OPACITY`

Tools:

```text
photoshop.layer.create

photoshop.layer.duplicate

photoshop.layer.rename

photoshop.layer.select

photoshop.layer.set_visibility

photoshop.layer.set_opacity
```

---

## 7.2 Group Commands

구현:

```text
photoshop.group.create

photoshop.group.move_layer
```

---

## 7.3 History

구현:

```text
photoshop.history.undo
```

초기에는 복잡한 History 관리보다 Undo 1단계를 우선 지원한다.

---

## 7.4 Safety

이 Phase에서는 기본적으로 destructive 명령을 넣지 않는다.

예:

```text
layer.delete
flatten
close_without_save
```

는 이후 Phase에서 Permission System과 함께 추가한다.

---

## Phase 3 Completion Criteria

다음 자연어 요청을 처리할 수 있어야 한다.

```text
현재 레이어를 복제하고
이름을 "MCP Test"로 바꾼 다음
불투명도를 50%로 설정해줘.
```

---

# 8. Phase 4 — Extended Photoshop Tools

## Objective

실제 이미지 보정에 필요한 Photoshop 기본 기능을 추가한다.

---

## 8.1 Mask

구현:

```text
photoshop.mask.create

photoshop.mask.enable

photoshop.mask.disable
```

---

## 8.2 Selection

구현:

```text
photoshop.selection.clear

photoshop.selection.invert
```

---

## 8.3 Adjustment

구현:

```text
photoshop.adjustment.curves

photoshop.adjustment.levels

photoshop.adjustment.brightness_contrast
```

가능하면 Adjustment Layer 방식 사용을 우선한다.

---

## 8.4 Filters

초기 Filter:

```text
photoshop.filter.gaussian_blur
```

이후 필요한 Filter를 점진적으로 추가한다.

---

## 8.5 Document — Phase 9 에서 해결

저장은 Phase 4 범위에서 제외한다. UXP 샌드박스 제약 때문이다.

실기에서 확인한 내용:

```text
storage.createEntryWithUrl("file:///C:/Temp/a.png")
  → Could not find an entry of 'file:///C:/Temp'
    (localFileSystem: "fullAccess" 를 주어도 동일)

batchPlay save 에 경로 문자열 전달
  → invalid file token used
```

Photoshop 의 save 액션은 UXP 세션 토큰을 요구하고, 토큰은 storage API 로 얻은
entry 에서만 만들 수 있다. 그런데 그 API 가 임의 경로를 열지 못한다.

자동화와 맞는 유일한 방법은 **사용자가 폴더를 한 번 승인하고 그 토큰을 보관**하는 것이다.
승인 UI · 토큰 보관 · 만료 처리가 필요하며, 이는 Permission System 설계 그 자체다.
그래서 Phase 9 에서 다음과 함께 다룬다.

```text
photoshop.document.save        원본 덮어쓰기 (destructive)
photoshop.document.save_as
photoshop.document.export
```

Phase 9 에서 구현했다. 실제 해법:

- 승인은 **플러그인 패널의 버튼**으로만 한다. `getFolder()` 가 사용자 제스처를 요구하므로
  서버가 소켓으로 띄울 수 없다. 이것은 제약이자 안전장치다 — LLM 은 저장 폴더를 고를 수 없다.
- `createPersistentToken` 으로 얻은 토큰을 플러그인의 `localStorage` 에 보관한다.
  Photoshop 재시작 후에도 남는다. 폴더가 사라지면 토큰을 지운다.
- 저장은 batchPlay 가 아니라 UXP DOM 의 `document.saveAs.*` 를 쓴다. (ARCHITECTURE §13)
  이 API 는 경로 문자열이 아니라 File entry 를 받으므로, 승인된 폴더 안에서만 파일을
  만들 수 있다는 성질이 그대로 유지된다.
- Tool 은 **파일 이름만** 받는다. 경로 구분자와 `..` 를 스키마가 거부한다.

실기 검증 (Photoshop 27.8, 승인 폴더 `E:	est01`):

- [x] 패널 ≡ 메뉴 / 버튼에서 폴더 승인 → persistent token 보관
- [x] 재연결 후에도 `workspace.status` 가 `approved: true` 와 경로를 보고
- [x] `export` png · jpg(quality 12) — 실제 파일 생성. 문서 제목이 바뀌지 않음 (asCopy)
- [x] `save_as` psd · psb — 실제 파일 생성. 문서가 새 파일로 전환됨
- [x] 같은 이름 재시도 → `FILE_ALREADY_EXISTS` (export · save_as 양쪽)
- [x] `../탈출` → `INVALID_PARAMETER` (스키마에서 차단, Plugin 까지 가지 않음)
- [x] `save` — `save_as` 이후 그 파일을 덮어씀
- [x] `PHOTOSHOP_MCP_ALLOW=read,edit` → export · save 는 `PERMISSION_DENIED`,
      `workspace.status` 는 허용

실기에서 드러난 것:

- **TIFF 를 `save_as` 에서 뺐다.** UXP DOM 에 `document.saveAs.tif` 가 없다
  (`document.saveAs.tif is not a function`). 타입 선언에 검증 없이 적어둔 것이 원인이다.

  이후 `export` 쪽에 batchPlay 경로로 다시 넣었다. 외부 천체사진 처리기
  (GraXpert · StarNet2 · BXT)가 **16비트 TIFF** 를 교환 형식으로 쓴다는 것을
  기존 CEP 패널 코드에서 확인했기 때문이다. PNG 8비트로는 계조가 무너진다.

  `save_as`(레이어 유지 원본 형식)가 아니라 `export`(평탄화 교환 파일)에 둔 것은
  용도가 그쪽이기 때문이다. 절차는 CEP 패널이 검증해 둔 것과 같다 —
  복제본을 만들어 평탄화하고 비트 심도를 맞춘 뒤 저장하고 닫는다.

  실기 검증: 파일 헤더를 직접 파싱해 `BitsPerSample = 16,16,16`, RGB 3채널,
  무압축을 확인했다. 보고값이 아니라 실제 파일을 확인한 것이다.
  8비트 요청 시 `8,8,8`, 생략 시 문서 심도(16)를 따르는 것도 함께 확인했다.
- 플러그인이 contracts 를 **값으로** import 하면 산출물에 `require("@photoshop-mcp/...")`
  가 남아 **플러그인 전체가 로드되지 않는다.** 패널이 빈 채로 열린다.
  타입 검사·빌드는 통과하므로 `tests/uxp-bundle.test.ts` 로 막는다.
- 도킹된 패널은 사용자가 높이를 못 늘릴 수 있다. 승인 버튼을 맨 위에 두고
  플라이아웃 메뉴에도 넣었다.

## 8.6 실기에서 드러난 공백

Phase 4 를 마치고 Phase 5 로 넘어가기 전에 채운다.
아래는 "기능이 부족한 것" 이 아니라 **이미 있는 기능이 쓸 수 없는 상태**다.

### 선택 영역을 만들 수 없다

`photoshop.mask.create` 에 `from: "fromSelection"` 을 넣어두었지만, 선택 영역을
**만드는** Tool 이 없어 이 옵션은 실행될 수 없는 코드다. `selection.invert` 도 마찬가지다.

* [x] `photoshop.selection.set` — 사각형 / 타원 / 전체 / 레이어 투명도 기준

### 혼합 모드를 바꿀 수 없다

비파괴 보정에서 혼합 모드는 불투명도만큼 기본이다.
Phase 6 의 `milky.restore_stars` 는 screen/lighten 혼합이 전제다.

* [x] `photoshop.layer.set_blend_mode`
* [x] `LayerInfo` 에 `blendMode` 추가

### 색보정 조정이 없다

Curves · Levels · Brightness/Contrast 만으로는 색을 다루지 못한다.
`makeAdjustmentLayer` 틀에 descriptor 만 더하면 되므로 함께 처리한다.

* [x] `photoshop.adjustment.hue_saturation`
* [x] `photoshop.adjustment.vibrance`

### 왜 지금인가

Phase 6 의 MilkyScapeTools 가 ROADMAP 이 정한 첫 실제 Extension 인데,
`create_sky_mask` 는 선택 영역이, `restore_stars` 는 혼합 모드가 있어야 한다.
Phase 5 에서 Extension SDK 계약을 세운 뒤에 Core 를 고치면 그 계약이 흔들린다.

---

## Phase 4 Completion Criteria

LLM에서 다음과 같은 기본 보정을 실행할 수 있어야 한다.

```text
레이어를 복제하고
Curves Adjustment Layer를 만든 다음
중간톤 대비를 조금 올려줘.
```

---

# 9. Phase 5 — Extension SDK

## Objective

Photoshop MCP Server를 특정 도메인에서 확장할 수 있도록 한다.

---

## 9.1 Extension Manifest

구현:

```text
extension.json
```

필드:

```text
id

name

version

namespace

main

description

requires

permissions
```

- [x] `ExtensionManifestSchema` (zod, `.strict()`) — `packages/photoshop-bridge/src/extension.ts`
- [x] `main` — 진입점 경로. manifest 만으로 적재할 수 있어야 하므로 추가했다.
- [x] `permissions` — **선언만 받고 강제하지 않는다.** Permission System 은 Phase 9 다.

---

## 9.2 Extension Manager

구현: `packages/mcp-core/src/extensions/manager.ts`

- [x] discover — `extensions/<name>/extension.json` 한 단계 스캔. 디렉터리가 없어도 오류가 아니다.
- [x] validate — JSON · 스키마 · namespace 검증
- [x] load — 진입점 import → activate → 등록
- [x] activate — namespace 를 강제하는 `ExtensionContext` 주입
- [x] deactivate — `deactivate()` 호출. 실패해도 등록 해제는 진행한다.
- [x] unload — 등록한 Tool 되돌리기

적재 실패 격리: 하나가 실패해도 나머지 Extension 과 서버는 계속 기동한다.
activate 도중 실패하면 그 Extension 이 등록한 Tool 을 되돌린다.

---

## 9.3 Extension Context

구현: `packages/photoshop-bridge/src/extension.ts`

```typescript
interface ExtensionContext {
  manifest: ExtensionManifest;

  tools: ExtensionToolRegistry;

  commands: ExtensionCommandEngine;

  logger: Logger;
}
```

원안과 달라진 점:

- [x] `tools` 는 `ToolRegistry` 전체가 아니라 `register` · `has` 만 있는 좁은 인터페이스다.
      전체를 주면 Extension 이 Core Tool 을 조회·해제·호출할 수 있다. 최소 권한 원칙. (ARCHITECTURE §17)
- [x] `commands` 는 `execute` 만 노출한다. Extension 은 Core Command 를 **호출**할 수 있을 뿐
      등록하거나 대체할 수 없다.
- [x] `manifest` 추가 — Extension 이 자기 id·version 을 알아야 한다.
- [x] `capabilities` — Phase 8 에서 런타임이 생겨 추가했다.
- [x] `jobs` — Phase 10 에서 추가했다.
- [x] `events` — Phase 11 에서 추가했다. unload 하면 구독이 함께 해제된다.
- [x] `resources` — Phase 12 에서 추가했다. 자기 namespace 의 URI 만 등록할 수 있다.
- [ ] `photoshop` — `PhotoshopService` 는 아직 정의된 적이 없다. 정의될 때 추가한다.

대응하는 런타임이 없는 필드는 넣지 않았다. 동작하지 않는 껍데기를 두면 Extension 작성자가
있는 줄 알고 쓴다. **이 원칙이 실제로 지켜졌다** — 위 네 개는 전부 런타임이 먼저 생긴
뒤에 들어갔고, `photoshop` 은 정의된 적이 없어 지금도 비어 있다.

---

## 9.4 Namespace Validation

Core:

```text
photoshop.*
```

Extension:

```text
<namespace>.*
```

Extension이 다음 namespace를 사용할 수 없도록 한다.

```text
photoshop.*
```

또한 다른 Extension namespace를 덮어쓸 수 없도록 한다.

- [x] `NamespaceSchema` — `/^[a-z][a-z0-9-]*$/`. 점을 쓸 수 없다.
- [x] `RESERVED_NAMESPACES = ["photoshop"]` — manifest 검증 단계에서 거부
- [x] namespace 중복 — 나중에 적재된 쪽을 거부한다. 먼저 적재된 쪽이 살아남는다.
- [x] Tool 등록 시 `<namespace>.` 접두사 강제 — 어기면 `EXTENSION_NAMESPACE_VIOLATION`
      (`demo` 가 `demoevil.tool` 을 등록하는 경우도 막는다)

---

## 9.5 Example Extension

테스트 Extension:

```text
extensions/example-extension
```

Tool:

```text
example.hello
example.document_summary
```

- [x] `example.hello` — Photoshop 연결 없이 동작. 적재 확인용.
- [x] `example.document_summary` — `DOCUMENT_GET` + `LAYER_LIST` 를 조합한다.
      Extension 이 Bridge 에 직접 닿지 않고 Core Command 만 쓰는 예다.

---

## Phase 5 Completion Criteria

Photoshop MCP Core 코드를 수정하지 않고 Extension Tool을 추가할 수 있어야 한다.

예:

```text
example.hello
```

- [x] `extensions/` 에 디렉터리를 추가하는 것만으로 Tool 이 늘어난다. Core 소스 수정 없음.
- [x] `PHOTOSHOP_MCP_EXTENSIONS` 로 스캔 디렉터리를 바꿀 수 있다. (기본 `<cwd>/extensions`)
- [x] 서버가 `tools/list` 를 노출하기 전에 적재하므로 Extension Tool 도 첫 응답에 포함된다.

실기 검증 (Photoshop 27.8, UXP Bridge, 문서 "제목 없음-1" / 레이어 33개):

- [x] 빌드된 `dist` 로 Extension 적재 — Tool 27개 (Core 25 + Extension 2)
- [x] `example.hello` — Extension manifest 의 id · version 반환
- [x] `example.document_summary` — 문서 이름 · 레이어 총수(33) · 보이는 레이어(31)가
      `photoshop.document.get` · `photoshop.layer.list` 결과와 일치
- [x] Extension → Core Command → 실제 UXP Bridge 경로 동작. Extension 은 Bridge 에 닿지 않는다.
- [x] `stop()` 이 Extension 을 unload 하고 Tool 등록을 되돌린다.

Plugin 이 지수 백오프로 재연결 중이면 서버 기동 후 붙기까지 30초 가까이 걸릴 수 있다.

Phase 5 에 포함하지 않은 것:

- Permission 강제 — Phase 9. manifest 의 `permissions` 는 선언만 받는다.
- Extension 의 Command 등록 — Extension 은 Core Command 를 호출만 한다.
- Hot reload — 서버 재시작 없이 다시 적재하는 기능은 없다.

가 Extension 설치만으로 MCP Tool 목록에 나타나야 한다.

---

# 10. Phase 6 — MilkyScapeTools Extension

## Objective

MilkyScapeTools를 첫 번째 실제 Photoshop MCP Extension으로 사용한다.

MilkyScapeTools 로직은 Photoshop MCP Core에 넣지 않는다.

## 범위 결정 (2026-09-18)

**기존 MilkyScape CEP 패널의 기능을 옮기지 않는다.** 이 프로젝트의 목적은
PhotoshopMCP 자체이고, MilkyScape 는 아키텍처를 검증하는 소재다.

두 인터페이스는 성격이 다르다. 패널은 사람이 슬라이더를 보며 조절하는 도구이고
(경계 캔버스 미리보기 · 450ms 디바운스 · 상세 설정 창), MCP 는 언어로 지시하는
통로다. 미리보기 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다.

Phase 6 의 Tool 은 **아키텍처가 실제로 도는지 확인하는 데까지**다.
Extension 계약 · Capability · 파일 왕복 · 권한 상한이 모두 실기에서 동작하는 것을
확인했으므로 목적을 달성했다. 더 늘리지 않는다.

이후 작업은 Core · Job · Workflow 쪽이다.

---

## Initial Tools

1차 후보였던 목록과 실제 결과:

- [x] `milky.get_state` — 문서·작업 폴더·처리기·기존 결과 + **막힌 이유**
- [x] `milky.remove_stars` — TIFF 내보내기 → StarNet2 → 별 제거본·별 두 레이어
- [x] `milky.restore_stars` — 별 레이어 스크린 혼합 + 불투명도
- [x] `milky.enhance` — BlurXTerminator 선명화
- [x] `milky.remove_gradient` — GraXpert CLI 의 FITS 출력을 Provider 설정으로 보정해서 붙였다
- [ ] ~~`milky.create_sky_mask`~~ · ~~`milky.create_foreground_mask`~~ — **범위에서 뺀다**

> `extensions/milkyscape` 는 §18.3 에서 **제거했다.** 위 기록은 그때 한 일이고,
> 외부 처리기를 부르던 셋은 `rcastro.bxt` · `starnet.remove_stars` ·
> `gx.run_gradient` 로 옮겼다.

### 하늘/전경 마스크를 빼는 이유

이 두 항목은 실제 도메인을 보기 전에 쓰인 추정이었다. 기존 MilkyScape 패널에는
대응물이 없다.

패널 코드는 `"하늘 선택 영역이나 현재 레이어 마스크가 없습니다"` 라고 말한다 —
하늘 마스크를 **만들지 않고 사용자가 만든 것을 소비한다.** 실제 워크플로는 사용자가
하늘·전경 두 사진을 정렬해 합성 마스크를 만들고, 패널은 거기서 경계 띠를 유도한다.
(MilkyScape 개발계획서 §6.9, §15~§18)

Photoshop 자체 '하늘 선택' 기능은 별개다. 그것은 **Photoshop 기능이지 이 도메인의
지식이 아니므로** Core 에 속한다. (ARCHITECTURE §1)

짐작으로 마스크 생성 알고리즘을 만들면 그럴듯하지만 틀린 결과가 나온다.

### 기존 패널에서 옮긴 원칙

MilkyScape 개발계획서 §2, §5.2 를 따른다. 셋 다 테스트로 고정했다.

- 매번 **새 결과 레이어**를 만든다. 기존 결과와 사용자 수정을 덮어쓰거나 지우지 않는다
- 이름에 도구·기능·실행 번호를 넣는다 — `StarNet2_별제거_01`
- **자동 연쇄 처리하지 않는다.** `enhance` 가 `remove_stars` 결과를 알아서 먹지 않는다

---

## External Tools

연결 대상:

```text
GraXpert

StarNet2

BXT
```

이들은 Core가 아니라 MilkyScapeTools 또는 Capability Provider로 구현한다.

Phase 8 의 Capability Provider 로 구현했다. 실기에서 확인한 것:

| 도구 | 입출력 | 상태 |
|---|---|---|
| StarNet2 | `.tif` → `.tif` ×2 | 동작. 4032×6048 16비트에서 67초 |
| BlurXTerminator | `.tif` → `.tif` | CLI 2.6.9, ML5 정식 라이선스 |
| GraXpert | `.tif` → `.fits` → `.tif` | 동작. 4032×6048 16비트에서 7초(GPU) |

GraXpert 3.0.2 CLI 에는 출력 형식 옵션이 없다(`-h` 로 확인). `-output out.tif` 를 줘도
`out.tif.fits` 가 나오고 Photoshop 은 FITS 를 못 읽는다.

이 보정을 **Provider 설정에 둔다.** `outputSuffix: ".fits"` 와 `convert: "fitsToTiff"` 를
선언하면 Capability Registry 가 실제 파일을 찾아 변환하고 중간 파일을 지운다.
Command 나 Extension 은 요청한 TIFF 가 나온다고만 알면 된다 — 처리기마다 다른 버릇을
도메인 코드가 알게 하면 처리기를 바꿀 때마다 도메인 코드가 따라 바뀐다.

변환에서 가장 조심한 것은 **정규화**다. min/max 로 무조건 늘리면 그래디언트를 제거한
결과의 계조가 조용히 바뀐다 — 배경을 뺀 이미지는 원래 어둡고, 그것을 1.0 까지 늘리면
다른 그림이 된다. 그래서 값 범위로 의도한 인코딩을 추정만 하고 늘리지 않는다.
기존 CEP 패널(`GraXpert-Photoshop-Panel/client/main.js`)이 검증해 둔 규칙을 따랐다.

실기 확인(4032×6048 16비트): GraXpert 가 `..._flat.tif.fits` 를 만들고, 변환기가
`0..1 float` 로 판정해 늘리지 않은 채 16비트 TIFF 로 옮겼다. 표본 픽셀 범위는
7844–25656 이었다. 늘렸다면 0–65535 가 되었을 것이다.

---

## 실기 검증

Photoshop 27.8, 문서 `새비재01_04.tif` 4032×6048 16비트 RGB.

```text
milky.get_state    문서·폴더·처리기·결과 + 막힌 이유 2건 정확히 보고
milky.remove_stars StarNet2 67초 → StarNet2_별제거_01 · StarNet2_별_01(screen)
milky.restore_stars opacity 80 적용
milky.enhance      BXT 10초 → BXT_선명화_01
```

FITS → TIFF 변환을 붙인 뒤 같은 문서로 추가 확인:

```text
milky.remove_gradient GraXpert 7초(GPU) → GraXpert_그래디언트제거_01
                      ..._flat.tif.fits 를 찾아 16비트 TIFF 로 변환하고 중간 파일 삭제
                      0..1 float 판정, 늘리지 않음 (표본 픽셀 7844–25656)
```

BlurXTerminator CLI 2.6.9, ML5 정식 라이선스. 예제 설정의 인자가 `--help` 와 일치하는
것을 확인했다.

### 실기가 잡은 설계 결함

**실패한 실행이 이름을 영구히 오염시켰다.**

내보내기는 성공했는데 Capability 단계에서 실패하면 TIFF 는 남고 레이어는 만들어지지
않는다. 레이어 번호가 그대로이므로 재시도할 때마다 같은 파일 이름으로 내보내려다
`FILE_ALREADY_EXISTS` 로 막힌다. 사용자 입장에서는 **한 번 실패하면 그 기능을 다시 쓸
수 없는** 상태다.

원인은 임시 파일 이름을 레이어 번호에서 파생한 것이었다. 임시 파일은 중간 산출물이고
레이어 이름은 사용자가 보는 결과인데, 둘을 같은 카운터에서 뽑으니 하나의 실패가 다른
하나를 오염시켰다. 임시 파일은 실행마다 고유 토큰을 쓰도록 고쳤다.

Mock 테스트는 이것을 잡지 못했다 — 실패 후 재시도를 검증하는 테스트가 없었다.
그 테스트를 함께 추가했다.

## Phase 6 Completion Criteria

예:

```text
전경은 보호하고
하늘의 Gradient를 제거한 다음
별을 분리해줘.
```

를 MilkyScape Extension Tool을 통해 처리할 수 있어야 한다.

---

# 11. Phase 7 — Workflow System

## Objective

여러 Command와 Tool을 하나의 고수준 작업으로 묶는다.

예:

```text
milky.workflow.prepare

milky.workflow.basic_process

milky.workflow.starless_process

milky.workflow.finish
```

예:

```text
milky.workflow.basic_process
```

내부:

```text
Duplicate Original

↓

Create Sky Mask

↓

Gradient Removal

↓

Star Separation

↓

Milky Way Enhancement

↓

Star Restore
```

---

## 범위 재검토 (2026-09-18)

위 예시는 실제 도메인을 보기 전에 쓰였다. `Create Sky Mask` 는 범위에서 뺐다.
`Gradient Removal` 은 GraXpert 에 막혀 있었으나 FITS → TIFF 변환으로 풀었다. (§10 참조)

그리고 **Extension 이 이미 워크플로다.** `milky.remove_stars` 는 문서 조회 → 내보내기 →
외부 처리 → 가져오기 ×2 → 혼합까지 5단계를 한 Job 으로 묶고 진행률도 보고한다.

그래서 이 계층이 실제로 더하는 것은 **코드를 쓰지 않고 선언으로 정의하는 것**이다.
Extension 을 만들려면 TypeScript 를 쓰고 빌드해야 하는데, 자주 하는 순서만 바꾸고
싶을 때는 과하다.

## Requirements

- [x] Workflow Definition — `workflows.json` 에 JSON 으로 적는다
- [x] Sequential Command execution — 단계를 순서대로 실행하고 앞 단계 결과를 넘긴다
- [x] Failure handling — 실패하면 멈추고 뒤 단계는 `skipped`. 어느 단계가 왜
      실패했는지 결과에 담는다
- [x] Rollback strategy 검토 — **되돌리지 않기로 했다.** 아래에 근거를 적었다
- [x] Workflow result — 단계별 상태·결과·오류·소요 시간
- [x] Progress event — Job 진행률로 `3/5 별 분리` 처럼 보고한다.
      진짜 이벤트(push)는 Phase 11 이다

## 값 전달의 안전 원칙

batchPlay descriptor · Capability argv 와 같다. (ARCHITECTURE §23.2)

`{{steps.0.result.layer.id}}` 형태만 허용한다. 앞 단계 결과에서 **경로로 꺼내는
것**뿐이며 임의 식을 평가하지 않는다. `{{1 + 1}}` 이나 `{{env.PATH}}` 는 등록 시점에
거부한다 — 식을 평가하는 순간 워크플로가 실행 엔진이 되고, "LLM 이 임의 코드를
실행할 수 없다" 는 규칙이 무너진다.

값 전체가 참조 하나면 **타입을 유지한다.** `"{{steps.0.result.id}}"` 는 숫자 `42` 가
되지 문자열 `"42"` 가 되지 않는다. 문자열로 바꾸면 Tool 의 스키마 검증이 엉뚱하게
실패한다.

## Rollback 을 하지 않는 이유

되돌리려면 Photoshop History 를 되감아야 하는데, 워크플로가 도는 동안 사용자가 한
편집까지 함께 날아간다. 워크플로는 몇 분씩 걸리고 그 사이 사용자는 Photoshop 을
쓸 수 있다.

대신 **무엇이 어디까지 됐는지 정확히 알려주고 판단은 사용자에게 맡긴다.**
앞 단계가 만든 레이어와 파일은 그대로 남는다. 이는 기존 MilkyScape 패널의
"기존 결과 및 사용자가 수정한 레이어를 덮어쓰거나 자동 삭제하지 않는다" 와 같은 태도다.
(개발계획서 §2-9)

## Job 을 부르는 단계

`awaitJob: true` 를 **명시적으로** 적어야 안쪽 Job 을 기다린다. 결과에 `jobId` 가
있다고 알아서 기다리면, 우연히 그 이름의 필드를 가진 결과까지 기다리게 된다.

적었는데 Tool 이 `jobId` 를 돌려주지 않으면 그 단계는 실패한다. 조용히 넘기면 다음
단계가 아직 없는 결과를 참조한다.

워크플로를 취소하면 안쪽 Job 도 취소한다. 그러지 않으면 외부 프로세스가 워크플로보다
오래 산다.

## 실기 검증

Photoshop 27.8, 4032×6048 16비트. 실제 MCP 클라이언트로 전 구간을 확인했다.

```text
[0초]  workflow.run → jobId 8d0d7774        즉시 반환
[3초]  running | 0%  1/3 별 분리
[72초] running | 67% 3/3 선명화
[81초] completed | ok=true 총 81초
       0 별 분리 → completed (70초)          awaitJob 으로 안쪽 Job 대기
       1 별 없는 레이어 선택 → completed      {{steps.0.result.starless.id}} 해석
       2 선명화 → completed (11초)
```

`workflows.example.json` 의 `starless-sharpen` 을 그대로 썼다.

---

# 12. Phase 8 — Capability System

## Objective

Extension이 특정 프로그램 이름 대신 기능 단위로 외부 Processor를 사용할 수 있게 한다.

예:

```text
gradientRemoval

starRemoval

denoise

deconvolution
```

Provider:

```text
gradientRemoval
  └─ GraXpert

starRemoval
  ├─ StarNet2
  └─ StarXTerminator
```

---

## Tasks

- [x] Capability Registry — `packages/mcp-core/src/capabilities/registry.ts`
- [x] Provider Registration — 설정 파일(`capabilities.json`) 또는 `register()`
- [x] Provider Availability — 실행 파일 존재·실행 권한 확인. **안 되는 이유를 함께 준다.**
- [x] Provider Selection — `priority` 내림차순. `provider` 로 지정도 가능
- [x] Provider Configuration — `executable` · `args` 템플릿 · `params` 선언 · `timeoutMs`

## 안전 설계

ARCHITECTURE §23.2 와 같은 원칙이다. LLM 이 임의 batchPlay 를 실행할 수 없듯
**임의의 프로그램과 인자도 실행할 수 없다.**

- 실행 파일 경로는 **설정에서만** 온다. 절대 경로를 요구한다 — 상대 경로는 서버의
  작업 디렉터리에 따라 달라진다.
- argv 는 Provider 정의가 **선언된 파라미터로 조립한다.** 호출자가 argv 를 넘기는
  통로가 없다. enum 은 허용 목록 밖의 값을 거부하므로 자유 문자열이 argv 에 닿지 않는다.
- `shell: false` 로 실행한다. 값 안의 `&&` 나 따옴표는 한 인자의 내용일 뿐이다.
- 입출력은 **승인된 작업 폴더 안의 파일 이름**만 받는다 (§8.5 와 같은 규칙).
  경로를 받으면 `external` 권한이 임의 파일 읽기·쓰기로 넓어진다.
- `{{...}}` 는 무엇이든 자리표시자로 보고 선언되지 않았으면 등록 시점에 거부한다.
  이름을 ASCII 로 좁혔더니 `{{오타}}` 가 검사를 빠져나가 그대로 인자가 되었다.

## Tool 노출

`photoshop.capability.list` (read) 하나만 노출한다. **실행 Tool 은 만들지 않는다.**

Capability 실행은 "파일을 내보내고 → 외부 처리기를 돌리고 → 되돌려 놓는" 흐름의 가운데
토막이다. 그 흐름을 아는 것은 Extension 이고(ARCHITECTURE §1), LLM 이 토막을 직접 부르면
앞뒤가 빠진 채로 실행된다. 실행은 `ExtensionContext.capabilities` 로만 한다.

Extension 의 Capability 실행에는 manifest 에 `photoshop.external` 선언이 필요하다.
Command 와 같은 상한이다.

## 아직 없는 것

- **동기 실행만 한다.** 진행률 보고와 취소는 Job System (Phase 10) 이다.
  `timeoutMs` 로 무한정 매달리는 것만 막는다.
- **동기 실행만 한다.** 진행률과 취소는 Job System (Phase 10) 이다.

`photoshop.layer.place` 를 함께 추가해 돌아오는 길을 냈다. 내보내기 → 외부 처리 →
가져오기 왕복이 이어진다. 권한은 `export` 와 같은 `external` 이다 — 하나는 쓰기로,
하나는 읽기로 Photoshop 경계를 넘는다.

실기에서 확인한 `place` 의 동작 (셋 다 처음 가정과 달랐다):

- 문서 맨 위가 아니라 **활성 레이어 바로 위**에 놓인다
- 활성 레이어가 그룹 안이면 **같은 그룹**으로 들어간다
- 활성 레이어의 **opacity 를 물려받는다** (기준 40 → 결과 40)

Mock 만 보고 만들었으면 조용히 어긋난 채로 남았을 것들이다. Mock 을 실기에 맞췄다.
## 실기 검증 — 왕복 전체

Photoshop 27.8, 문서 4032×6048 16비트 RGB, StarNet++ v2 로 확인했다.

```text
export(tiff, 16bit) → StarNet2(68초) → layer.place ×2
레이어 1 → 3 (별 제거 · 별만, 둘 다 smartObject)
```

파일 헤더를 직접 파싱해 **16비트가 전 구간 유지**되는 것을 확인했다.

| 파일 | 크기 | BitsPerSample | 압축 |
|---|---|---|---|
| 입력 | 139.6MB | 16,16,16 | 없음 |
| starless | 120.2MB | 16,16,16 | LZW |
| stars | 49.2MB | 16,16,16 | LZW |

Provider 설정은 기존 CEP 패널에서 가져온 실제 인자다. `capabilities.example.json` 의
두 Provider 모두 실행 파일이 존재하는 것을 확인했다.

**GraXpert 는 처음에 예제에서 뺐다.** 3.0.2 CLI 에는 출력 형식 옵션이 없고 항상 FITS 를
쓰는데(`-h` 로 확인) Photoshop 이 못 여는 형식이라 왕복이 성립하지 않았기 때문이다.
동작하지 않는 설정을 예제에 두면 복사해서 쓰는 사람이 속는다.

Phase 12 뒤에 FITS → TIFF 변환을 붙이면서 예제에 되돌렸다. 자세한 것은 §10 을 본다.

첫 검증에서 StarNet2 가 `Image size is too small for the window!` 로 거부했다.
319×226 테스트 문서였기 때문이다. 오류 설계가 의도대로 동작해 stderr 가 그대로
전달되어 원인이 바로 보였다.

---

# 13. Phase 9 — Permission / Safety

## Objective

위험한 Photoshop 작업을 안전하게 제어한다.

Permission:

```text
READ

EDIT

EXTERNAL

DESTRUCTIVE
```

---

## READ

예:

```text
document.get

layer.list
```

---

## EDIT

예:

```text
layer.create

curves

mask.create
```

---

## EXTERNAL

예:

```text
GraXpert

StarNet2
```

---

## DESTRUCTIVE

예:

```text
layer.delete

flatten

close_without_save
```

---

## Tasks

- [x] Permission metadata — `PermissionLevel` 을 Tool · Command 의 **필수** 필드로.
      선택 필드로 두면 새로 추가한 것이 조용히 관대한 기본값을 갖는다.
- [x] Tool Permission — `tools/list` 에 요구 권한을 노출하고 호출 전에 빠른 실패
- [x] Command Permission — **여기가 강제 지점이다.** Extension 은 Tool 을 거치지 않고
      Command 를 직접 호출한다. (ARCHITECTURE §3.2)
- [x] Extension Permission — manifest 의 `permissions` 가 선언에서 강제로 바뀌었다.
      선언 밖의 Tool 은 등록 자체를 막고, Command 호출에도 같은 상한을 씌운다.
      선언하지 않으면 아무 권한도 없다.
- [x] User approval strategy — `PHOTOSHOP_MCP_ALLOW` 설정 기반. 대화형 승인은 하지 않는다.
      MCP 서버는 stdio 를 전송에 쓰므로 프롬프트를 띄울 수 없고, elicitation 은 클라이언트
      지원이 고르지 않아 안전장치로 삼으면 클라이언트가 무시할 때 보장이 사라진다.
      대화형 승인은 MCP 클라이언트의 역할로 둔다.
      파일 저장 폴더 승인만은 UXP 패널에서 사람이 직접 한다 (§8.5).
- [x] Destructive protection — 기본값은 `read` · `edit` 만 허용.
      `external` · `destructive` 는 명시적으로 켜야 한다.

Level 배정:

| Command | Level | 근거 |
|---|---|---|
| `PING` · `DOCUMENT_GET` · `LAYER_LIST` · `WORKSPACE_STATUS` | `read` | 읽기만 한다 |
| 레이어 · 그룹 · History · 조정 · 마스크 · 선택 · 필터 (21개) | `edit` | 전부 비파괴 |
| `DOCUMENT_SAVE_AS` · `DOCUMENT_EXPORT` | `external` | Photoshop 밖에 쓴다. **덮어쓰지 않는다** |
| `DOCUMENT_SAVE` | `destructive` | 원본을 덮어쓴다 |

덮어쓰기 옵션을 `save_as` 에 두지 않았다. Permission 은 Command 단위로 정적이라 옵션에
따라 레벨이 달라질 수 없고, 옵션으로 두면 `external` 만 받은 호출자가 파일을 지울 수 있다.
덮어쓰기는 `save` 하나로 모아 `destructive` 로 분류한다.

아직 남은 것:

- [x] `layer.delete` (§17.18) · `document.flatten` · `document.close` (§17.25) — 분류 체계는 섰지만
      각각의 구현은 아직 없다.

---

# 14. Phase 10 — Job System

## 왜 필요한지 — 실측

MCP 의 기본 요청 타임아웃은 **60초**다 (`DEFAULT_REQUEST_TIMEOUT_MSEC`).

실기에서 StarNet2 가 4032×6048 이미지를 67초에 처리했다. 실제 MCP 클라이언트로
`milky.remove_stars` 를 부르니 정확히 60초에 `-32001 Request timed out` 이 났다.

처음에는 `tools.invoke` 로 서버 내부를 직접 불러 검증해서 이것을 놓쳤다.
**MCP 서버를 만들면서 MCP 경로로 확인하지 않은 것**이 검증 설계의 결함이었다.

## 설계

- [x] 상태 기계 — `queued → running → completed | failed | cancelled`
- [x] `photoshop.job.status` · `.list` · `.cancel` — **전부 즉시 반환.**
      완료를 기다리면 타임아웃 문제가 그대로 돌아온다
- [x] `ExtensionContext.jobs` — Extension 이 긴 작업을 등록. namespace 로 격리되어
      다른 Extension 의 Job 을 보거나 취소할 수 없다
- [x] 취소 — `AbortSignal` 이 자식 프로세스까지 내려가 `SIGKILL` 한다
- [x] 서버 정지 시 진행 중인 Job 을 모두 취소한다
- [x] 끝난 Job 이 100개를 넘으면 오래된 것부터 버린다

### 반환 타입을 상황에 따라 바꾸지 않는다

"짧으면 결과, 길면 Job" 으로 두면 호출자가 매번 어느 쪽인지 판단해야 한다.
긴 작업은 짧게 끝나도 **항상** Job 을 돌려준다.

### 취소는 실제로 죽여야 한다

신호만 받고 프로세스가 계속 돌면 취소가 거짓말이 된다 — 상태는 `cancelled` 인데
CPU 는 계속 먹고 파일도 계속 쓴다. 2초 뒤 마커 파일을 남기는 프로세스를 띄워
취소하고 마커가 생기지 않는 것을 테스트로 고정했다.

### 서버 정지 시 Job 방치

Job System 을 만들자마자 드러났다. `stop()` 이 진행 중인 Job 을 그냥 두면 외부 처리기
프로세스가 **서버보다 오래 산다.** StarNet2 가 몇 분씩 도는데 서버는 이미 없어서
결과를 받을 곳도 없다. `cancelAll()` 을 `stop()` 이 먼저 부른다.

### 서버가 죽으면 Job 도 사라진다

Job 은 메모리에만 있다. 외부 프로세스는 이미 파일을 만들었을 수 있으므로 작업 폴더를
확인하면 된다. `job.status` 가 없는 Job 에 대해 이 사실을 안내한다.

## 실기 검증

실제 MCP 클라이언트(`client.callTool`)로 전 구간을 확인했다. 내부 API 우회가 아니다.

```text
[0초]  remove_stars → jobId 09f3ad43        즉시 반환
[3초]  running | 25% StarNet2 로 별 분리 중
[75초] completed | 100% 완료                60초를 넘겼으나 타임아웃 없음
       결과: StarNet2_별제거_02 / 별_02, 처리 72초
[75초] job.list: 1건
```


## Objective

장시간 실행되는 작업을 관리한다.

예:

```text
GraXpert

StarNet2

대형 이미지 처리
```

Job State:

```text
QUEUED

RUNNING

COMPLETED

FAILED

CANCELLED
```

---

## Features

- [x] Job ID — UUID. `start()` 가 **먼저 ID 를 돌려주고** 다음 틱에 실행을 시작한다.
      그래야 호출자가 그 ID 로 바로 조회할 수 있다.
- [x] Progress — `{percent, message}`. percent 는 모를 때 `null` 이다. 0 으로 채우지 않는다.
- [x] Result — 완료 시 `result`, 실패 시 `error`. 종료 상태는 덮어쓰지 않는다 —
      취소한 Job 이 뒤늦은 완료로 되살아나면 취소가 거짓말이 된다.
- [x] Cancel — `AbortSignal` 이 자식 프로세스까지 내려가 `SIGKILL` 한다. 신호만 받고
      계속 돌면 취소가 아니다. `stop()` 은 진행 중인 Job 을 모두 취소한다.
- [x] Cleanup — 끝난 Job 이 상한을 넘으면 오래된 것부터 버린다.
- [ ] Timeout — **Job 자체에는 없다.** 외부 처리기 프로세스에 `ProviderConfig.timeoutMs`
      가 걸려 있어 무한정 매달리는 것은 막히지만, Photoshop 쪽이 응답하지 않는 Job 을
      끊는 장치는 없다. 필요가 확인되면 연다.

---

# 15. Phase 11 — Events

Photoshop 변경 사항을 시스템에서 감지할 수 있도록 한다.

## 설계

### LLM 은 구독하지 않고 조회한다

MCP 에는 임의 이벤트를 클라이언트로 밀어주는 통로가 없다. `notifications/progress`
처럼 정해진 알림만 있고, LLM 이 구독할 수 있는 일반 이벤트 채널은 스펙에 없다.

- **Extension** — `context.events.on(...)` 으로 구독한다. 서버 안에서 즉시 받는다.
- **LLM** — `photoshop.event.recent` 로 조회한다. `after: lastSeq` 로 새 것만 받는다.

조회 결과가 비어 있어도 `lastSeq` 를 함께 준다. 그러지 않으면 폴링이 앞으로 못 간다.

### 이름을 짐작하지 않는다

UXP 알림은 batchPlay 액션 이름(`make` · `delete` · `set`)으로 오지 `layer.created`
같은 친절한 이름으로 오지 않는다. 같은 `make` 가 레이어일 수도 문서일 수도 있고
구분은 descriptor 안에 있다.

확신할 수 있는 조합만 해석하고 나머지는 `photoshop.unknown` 으로 두되 **원본을
보존한다.** 이 프로젝트는 `bitDepth` · `layer.kind` · `blendMode` 에서 같은 방식으로
세 번 실제 버그를 잡았다.

### 구독은 Extension 과 함께 사라진다

리스너를 남기면 unload 된 Extension 의 코드가 계속 불린다. namespace 로 묶어두고
unload 때 한꺼번에 해제한다.

### 구독자 오류를 삼킨다

한 Extension 의 버그가 다른 구독자와 이벤트 흐름 전체를 막으면 안 된다.

## 상태

**Command 수명 이벤트는 실기 검증했다.**

```text
photoshop.layer.create → command.started, command.completed
photoshop.layer.rename → command.started, command.completed
```

Photoshop 연결이 없어도 발생한다. 권한으로 거부된 호출은 `started` 를 내지 않는다 —
거부된 것까지 기록하면 로그가 시끄러워진다.

**Photoshop 알림은 이 환경에서 동작하지 않는다.** 실기로 확인하고 여기서 멈췄다.

| 확인 | 결과 |
|---|---|
| `action.addNotificationListener` 존재 | 있음 |
| 문자열 배열(`["make"]`)로 등록 | 예외 없이 성공 |
| 객체 배열(`[{event:"make"}]`)로 등록 | 예외 없이 성공 |
| 플러그인 자신의 동작에 대한 알림 | **0건** |
| 사용자 직접 편집에 대한 알림 | **0건** |

Photoshop 27.8 / manifestVersion 4 기준이다. 등록은 성공하는데 전달이 되지 않는다.
원인을 찾지 못했고 **추측으로 코드를 더 넣지 않았다.**

진단이 좁혀진 과정을 남겨둔다. 처음 구현은 등록 실패를 조용히 삼켜 아무것도 알 수
없었다 — Bridge 를 보호하려던 것이 원인 파악을 막았다. 상태를 이벤트로 보고하게
고치고 나서야 "API 없음" 을 배제하고 "등록 성공 + 전달 없음" 까지 좁힐 수 있었다.

배선은 남겨둔다. 자기 상태를 `photoshop.notifications.registered` 로 보고하므로
해가 없고, 다른 환경이나 이후 버전에서 전달이 되면 그대로 동작한다.
그 이벤트에 `delivery: "unverified"` 를 담아 동작하는 것처럼 읽히지 않게 했다.

**쓸 수 있는 것은 `command.*` 뿐이다.** Tool 설명에도 적었다.

예:

```text
document.opened

document.closed

layer.created

layer.deleted

layer.selected

selection.changed

command.started

command.completed

command.failed
```

---

# 16. Phase 12 — MCP Resources

## Tool 과 무엇이 다른가

Tool 은 **행동**이고 Resource 는 **맥락**이다. 데이터가 겹쳐도 쓰임이 다르다 —
클라이언트가 미리 읽어 대화에 붙일 수 있고, LLM 이 매번 Tool 을 부르지 않아도 된다.

## Phase 11 에서 못 한 것을 되찾았다

Phase 11 에서 "MCP 에 push 통로가 없다" 고 적었는데 정확하지 않았다.
**임의 이벤트** 통로가 없는 것이고 `notifications/resources/updated` 는 있다.

문서를 바꾸는 Command 가 끝나면 관련 리소스가 낡았다고 알린다. 구독한 클라이언트는
폴링 없이 안다. Photoshop 알림이 동작하지 않는 환경에서도 **우리가 만든 변경**은
알릴 수 있다 — 우리는 언제 무엇을 바꿨는지 알기 때문이다.

읽기 Command 는 알리지 않는다. 알림 범위는 `affectedResources` 가 정한다.
모르는 Command 는 바꿨다고 본다 — 덜 보내면 클라이언트가 낡은 값을 계속 쓴다.

작업 중 버그 하나를 잡았다. 접두사 검사를 먼저 해서 `SELECTION_GET`(읽기)이
`SELECTION_` 에 걸려 변경으로 분류되었다. 읽기 목록을 먼저 거르도록 고쳤다.

## 데이터 없는 리소스를 만들지 않는다

`photoshop://selection` 과 `photoshop://history` 를 만들다가 뒷받침할 Command 가
없다는 것을 알았다 — 선택 영역과 History 는 **바꾸는** Command 만 있고 **읽는**
Command 가 없었다. `SELECTION_GET` 과 `HISTORY_LIST` 를 추가했다.

있는 척하면 호출자가 쓰다가 빈 것을 받는다.

## Extension Resource

Phase 5 에서 "Phase 12 에 추가한다" 며 비워둔 `ExtensionContext.resources` 를 채웠다.

Extension 은 자기 namespace 의 URI 만 등록할 수 있다 (`milky://state`). Tool 이름
규칙과 같은 이유다. unload 하면 함께 해제되고, 남의 리소스가 바뀌었다고 알릴 수 없다.

## 실기 검증

Photoshop 27.8, 문서 4032×6048 16비트. 실제 MCP 클라이언트로 확인했다.

```text
resources/list                 6개 노출
document/current → {"name":"새비재01_04.tif","width":4032,"bitDepth":16,...}
selection        → {"hasSelection":false,"bounds":null}
history          → 항목 29개, 현재 28 = "선택 해제"

구독 후 layer.create → 알림 ["photoshop://layers"]
구독 후 layer.list   → 알림 [] (읽기는 알리지 않음)
```

Core:

```text
photoshop://document/current

photoshop://layers

photoshop://selection

photoshop://history

photoshop://capabilities

photoshop://extensions
```

Extension:

```text
milky://state

milky://workflow
```

---

# 17. Phase 13 — Production Hardening

## Error Handling

공통 Error Model 구현:

```text
PHOTOSHOP_NOT_CONNECTED

DOCUMENT_NOT_FOUND

LAYER_NOT_FOUND

COMMAND_NOT_SUPPORTED

INVALID_PARAMETER

PERMISSION_DENIED

COMMAND_TIMEOUT

EXTENSION_LOAD_FAILED
```

---

## Logging

Correlation ID:

```text
MCP Request

↓

Tool

↓

Command

↓

Bridge

↓

UXP
```

예:

```text
[req-001] MCP photoshop.layer.duplicate

[req-001] LAYER_DUPLICATE

[req-001] Bridge Send

[req-001] UXP Complete
```

---

## Stability

- [x] Crash recovery — 잡히지 않은 예외·거부를 stderr 에 남기고 진행 중인 Job 을
      정리한 뒤 종료한다. **삼키지 않는다** — MCP 서버는 클라이언트가 다시 띄우므로
      죽는 편이 맞고, 오류를 감추면 같은 문제가 반복된다
- [x] Bridge reconnect — Phase 2. 지수 백오프. 실기 확인
- [x] Request timeout — Phase 2. `COMMAND_TIMEOUT`
- [x] Process cleanup — Phase 10. `stop()` 이 진행 중인 Job 을 취소하고 자식 프로세스를
      SIGKILL 한다
- [x] Temporary file cleanup — 아래 참조
- [x] Invalid Extension isolation — Phase 5. 하나가 실패해도 나머지와 서버는 기동한다

## 진단 — `photoshop.diagnostics`

Bridge 연결 · 권한 · 외부 처리기 · Extension · 워크플로 · Job · 이벤트를 한 번에
보고하고, **막힌 것은 고치는 방법을 함께 준다.**

이 Tool 이 없던 동안 상태를 보려면 매번 임시 스크립트를 짜야 했다. Bridge 는 `ping`,
작업 폴더는 `workspace.status`, 처리기는 `capability.list`, Extension 은 서버 로그를
따로 봐야 했다.

상태만 나열하면 사용자가 스스로 조합해야 한다. `blocked` 에는 실행할 수 있는 문장을
넣는다 — `"PHOTOSHOP_MCP_ALLOW 에 external 을 넣으세요"` 처럼.

실기 확인:

```text
bridge: true | 권한: read,edit,external,destructive
Tool: 46 Command: 32
처리기: starnet2✓ bxt✓
Extension: example,milky | 워크플로: 2
막힌 것: 0건
```

`registry.tools` 는 **Extension Tool 까지 더한 수**다. 이때는 Core 40 + example 2 +
milky 4 였다. 이 값을 Core 개수로 옮겨 적어 "Core Tool 46개" 라는 틀린 문장이 문서
세 곳에 퍼졌다. Core 목록의 기준은 `docs/CORE_API.md` §4 다.

## 임시 파일 — `photoshop.workspace.usage` · `.delete`

외부 처리기를 한 번 돌릴 때마다 16비트 TIFF 가 여러 개 생긴다. 4032×6048 이면 파일
하나가 140MB 다. **실기 검증만으로 37개 1.7GB 가 쌓였는데 알 방법이 없었다.**

`usage` 는 큰 것부터 보고하고 사람이 읽을 크기(`1.7GB`)를 함께 준다. 바이트 숫자만
보면 알아채지 못한다.

`delete` 는 **파일 이름을 명시할 때만** 지운다. 패턴이나 와일드카드를 받지 않는다 —
`*.tif` 한 줄이 사용자의 원본을 지울 수 있고, 승인된 폴더는 우리 폴더가 아니다.
권한은 `destructive` 다.

실기 확인: 지울 34개와 남길 3개를 먼저 보고 확인한 뒤 실행해 **1.7GB → 5KB** 가 되었다.

## Logging

correlation ID 가 Tool → Command → Bridge 를 관통한다. Command 수명 이벤트를 받아
`[req-001] LAYER_DUPLICATE completed (12ms)` 형태로 남긴다.

기본은 조용하다 — stdout 은 MCP 전송이 점유하고 stderr 도 시끄러우면 진짜 오류가
묻힌다. `PHOTOSHOP_MCP_DEBUG=1` 일 때 나온다.

**실패만은 디버그가 아니어도 남긴다.** 조용히 실패하면 원인을 못 찾는다 —
Phase 11 에서 알림 등록 실패를 삼켰다가 진단이 불가능해진 일이 있었다.

---

# 17.5 `layer.get_active` — P0 공백 메우기

Phase 6 이후로 **P0 로 분류해 놓고 유일하게 구현되지 않은 채** 남아 있던 Tool 이다.
편집 Tool 이 `layerId` 를 생략하면 활성 레이어를 쓰는데 그것이 무엇인지 물어볼 방법이
없었다. `layer.list` 로 전체를 받아 훑는 것이 유일한 우회였고, 레이어가 33개인
문서에서도 그랬다. 없어도 돌기는 해서 늦어졌다.

## 구현하면서 드러난 것

**활성 레이어는 하나가 아니다.** `document.activeLayers` 는 배열이고 편집 Command 들은
그중 첫 번째만 쓴다. 첫 조회에서 이미 두 개가 선택되어 있었다 — 흔한 상태다.

그래서 `layer`(편집 Tool 이 실제로 쓰는 것)와 `layers`(사용자가 골라 둔 전부)를 함께
준다. 하나만 보여주면 `layer.rename` 이 나머지를 건드리지 않는다는 사실이 가려진다.

`layer` 는 **서버가** `layers[0]` 에서 뽑는다. Plugin 이 둘을 따로 보내면 어긋날 수
있고, 그러면 이 Tool 자체가 거짓말을 한다. 어긋날 수 있는 두 값을 검증하는 대신
어긋날 수 없게 만든다.

## 실기 검증 (Photoshop 27.8, 레이어 6개 문서)

```text
select(5) → 보고 5                       ✅
생략 rename → 5                          ✅ 보고한 것과 같은 레이어
그룹 안 레이어 → parentId 17 보고         ✅ (검증용 그룹 생성 후 undo 로 복원)
다중 선택 2개 → 보고 13, 생략 rename 13   ✅ (아래 수정 후)
```

## 실기가 잡은 버그 — `activeLayers` 순서

처음에는 평탄화 목록을 선택 집합으로 걸렀다. 그러면 결과가 레이어 순서(위→아래)로
정렬된다. 레이어 두 개를 선택해 확인하니:

```text
보고한 첫 번째:            id 14
생략 rename 이 건드린 것:  id 13     ❌
```

**Photoshop 의 `activeLayers` 순서는 레이어 순서가 아니다.** 문서에 순서 보장이 없어
주석에 "실기로 확인해야 한다" 고 표시해 두었던 가정이 실제로 틀렸다.

`activeLayers` 순서를 그대로 두고 `parentId` 만 평탄화 목록에서 가져오도록 고쳤다.
순서 규칙은 `photoshop-uxp/src/dom/active-order.ts` 로 떼어 단위 테스트로 고정했다 —
`dom/layers.ts` 는 `photoshop` 런타임이 필요해 테스트에서 부를 수 없다.

Mock 만 보고 만들었으면 조용히 어긋난 채로 남았을 버그다. `layer.place` 의 세 가지
잘못된 가정과 같은 종류다. (§13)

---

# 17.6 LLM 시점 테스트 — 배경 레이어 승격 버그

배선 검증(`npm run verify:live`)은 전부 통과하는데, **LLM 이 Tool 설명만 보고 쓰는**
방식으로 시험하니 바로 버그가 나왔다. 실패 경로를 실제로 밟아야만 드러나는 종류다.

## 무엇이 틀렸나

```text
layer.list                     id=1 "배경" op=100
layer.set_opacity {opacity:80} ❌ COMMAND_FAILED
                                  "The 레이어 with an id of 1 does not exist."
layer.list                     id=2 "레이어 0" op=80   ← 적용되어 있다
```

배경 레이어는 반투명할 수 없어 Photoshop 이 **일반 레이어로 승격**시킨다. 그건
Photoshop 의 올바른 동작이다. 문제는 그다음이다.

```ts
layer.opacity = params.opacity;        // 승격 발생. 변경은 이미 끝났다
return describeLayer(document, layer); // 무효가 된 참조를 읽다 throw
```

**변경은 성공, 결과 읽기가 실패, 보고는 COMMAND_FAILED.** 호출자는 아무 일도 없었다고
믿는데 문서는 바뀌어 있다. 안 했다고 말하고 뭔가를 하는 것이 가장 나쁜 실패다.

실제로 이 오해 때문에 "복구" 를 시도하다 엉뚱한 레이어를 건드렸다.

## 배경 레이어는 편집마다 다르게 반응한다

| 편집 | Photoshop 동작 | 문서 변경 |
|---|---|---|
| `set_opacity` | 승격(적용) 또는 **조용한 무시** | 경우에 따라 다름 |
| `rename` | 거부 | 없음 |
| `set_blend_mode` | 거부 | 없음 |

`rename` 을 처음에 범인으로 지목했다가 단독 실행으로 무죄를 확인했다. 두 호출을
연달아 돌려 놓고 앞엣것을 원인으로 본 것이 잘못이었다.

## 두 번째 실기 — 조용히 무시되는 변경

`isBackground` 를 붙이고 다시 돌리다 하나 더 나왔다.

```text
layer.list                            id=1 "배경" · id=2 "복제본"
set_opacity {layerId:1, opacity:60}   ✅ 성공  {"opacity":100}   ← 아무 일도 없었다
```

레이어가 둘 이상이면 배경의 불투명도 대입이 **예외 없이 무시된다.** 값도 그대로다.
배경이 유일한 레이어일 때는 승격되며 적용되었다. 어느 쪽이 될지 Photoshop 이 무엇을
기준으로 정하는지는 모른다 — 활성 여부도 `layerId` 지정 여부도 아니었다.

반환값의 `opacity: 100` 은 정직했다. 그러나 호출자는 **성공/실패 신호를 먼저 읽는다.**
그래서 쓴 값이 실제로 들어갔는지 확인하고, 아니면 실패로 보고한다.

비교에 함정이 있다. Photoshop 은 불투명도를 **0–255 로 저장**해 50 을 넣으면 50.196…
이 돌아온다. 정확히 비교하면 60.5 요청에 60 이 와서 오탐이 난다. 한 단계가 0.39 이고
양쪽 반올림 오차가 0.5 이하이므로 1 까지는 같은 값으로 본다. (`opacityApplied`)

**규칙을 짐작해 Mock 에 넣지 않았다.** 관찰한 사실(요청한 값이 안 들어갔다)만 보고한다.

실기 확인:

```text
set_opacity {layerId:1(배경), opacity:60}  ❌ "요청 60, 실제 100. 배경 레이어라서
                                              Photoshop 이 거부했습니다.
                                              layer.duplicate 로 복제본을 만들어 쓰세요."
set_opacity {layerId:2(복제본), opacity:60} ✅ opacity 60 적용
```

`isBackgroundLayer` 는 UXP 에 실제로 있었다. 배경은 `true`, 복제본은 `false` 다.

## 고친 방법

속성을 바꾸는 Command 를 `mutate()` 로 감쌌다. 변경 **전에** id 목록을 떠 두고, 변경
뒤 목록에서 "없던 id" 를 찾는다. 하나뿐이면 그것이 교체된 레이어다.

위치나 활성 레이어로 추정하지 않는다 — 승격된 레이어가 반드시 활성이라는 보장이 없고
위치도 바뀔 수 있다. 근거가 없으면 추측 대신 "변경은 적용되었지만 결과를 확인하지
못했습니다" 라고 말한다.

`describeLayer` 도 참조가 무효일 때 Photoshop 원문을 그대로 올리지 않는다. 원문은
"그런 레이어 없음" 으로 읽혀 **아무 일도 없었다고 오해**하게 만든다. 그것이 이 버그의
핵심 피해였다.

순수 판정 로직은 `photoshop-uxp/src/dom/mutation-result.ts` 로 떼어 단위 테스트로
고정했다. `dom/layer-edit.ts` 는 `photoshop` 런타임이 필요해 테스트에서 부를 수 없다.

## 실기 확인 (수정 후)

```text
set_opacity {opacity:80} → ✅ {"id":2,"name":"레이어 0","opacity":80}  바뀐 id 를 정확히 반환
일반 레이어 4종 편집     → ✅ id 유지, 값 정확
배경 set_blend_mode      → ✅ 거부되고 문서 그대로 (정직한 실패)
```

## 이어서 고친 것

**`LayerInfo.isBackground` 추가.** 호출자가 승격을 미리 알 방법이 없으면 피할 수도
없다. `isBackgroundLayer` 속성이 UXP 버전에 있는지 확인하지 않았으므로 **boolean 을
실제로 받았을 때만 담는다.** 없으면 필드가 아예 없다 — `false` 로 덮으면 "배경이
아니다" 라는 틀린 사실을 말하게 된다. (`rawBitDepth` · `rawKind` 와 같은 원칙)

**Mock 이 승격을 흉내낸다.** Mock 이 현실과 다르면 그 경로는 테스트에 영원히 나오지
않는다. 이 버그가 실기에서만 드러난 이유가 정확히 그것이었다. 배경 레이어에 100 미만을
주면 Mock 도 id 와 이름을 바꾼다. 배경의 복제본은 배경이 아니라는 것도 함께 넣었다.

이 변경으로 기존 테스트 4개가 깨졌다. 전부 **비현실적인 Mock 을 전제하던 자리**였다.
약화시키지 않고 배경 승격 단정을 오히려 추가했다.

**`milky.enhance` 를 Job 으로 바꿨다.** 외부 처리기를 부르는 Tool 셋 중 둘만 Job 이면
호출자가 매번 어느 쪽인지 판단해야 한다. BXT 가 실기에서 10초였지만 처리 시간은
이미지 크기에 따라 변하고, StarNet2 도 작은 이미지에서는 빨랐다가 4032×6048 에서
67초가 나와 MCP 기본 타임아웃을 넘겼다.

---

# 17.7 LLM 시점 테스트 — Core 기본 기능

외부 처리기가 아니라 **Core 편집 기능**을 Tool 설명만 보고 써 보았다. 조정·마스크·
선택·필터·그룹·되돌리기를 실제 문서에서 돌렸다.

## 가장 큰 것 — 검증 오류가 전부 같은 문장이었다

```text
bounds 누락      → "Tool 입력이 올바르지 않습니다: photoshop.selection.set"
제어점 순서 오류  → "Tool 입력이 올바르지 않습니다: photoshop.adjustment.curves"
반지름 범위 초과  → "Tool 입력이 올바르지 않습니다: photoshop.filter.gaussian_blur"
```

세 가지 다른 실수가 구분되지 않는다. 정확한 설명은 `details.issues` 에 있었지만
**호출자는 `message` 를 먼저 읽는다.**

검증 실패는 **호출자가 고칠 수 있는 유일한 종류의 오류**인데 정작 그것만 안내가
없었다. 게다가 `recoverable: false` 로 표시되어 "포기해라" 는 신호까지 주고 있었다.

Zod 메시지를 최상위로 올리고 `recoverable: true` 로 바꿨다. Tool 과 Command 두
계층이 같은 문제라 `describeZodIssues` 로 공유한다.

```text
Tool 입력이 올바르지 않습니다: photoshop.selection.set — bounds: rectangle 에는 bounds 가 필요합니다.
Tool 입력이 올바르지 않습니다: photoshop.adjustment.curves — points.1.input: 제어점의 input 은 오름차순이어야 하며 중복될 수 없습니다.
```

## 마스크 오류가 해독 불가였다

```text
mask.enable {layerId:1}  →  "Photoshop MCP: "설정" 명령은 현재 사용할 수 없습니다."
```

배경 레이어에 마스크가 없어 난 오류인데 원문만으로는 알 수 없다. 가장 흔한 원인을
앞에 붙이고 원문은 괄호로 남긴다.

## 설명에 없던 부작용 셋 — 전부 Tool 설명에 적었다

| 무엇 | 실기에서 확인한 동작 |
|---|---|
| 조정 레이어 생성 | **선택 영역을 소비한다.** Photoshop 이 자동으로 마스크를 붙인다 |
| `filter.gaussian_blur` | 대상을 **스마트 오브젝트로 바꾼다.** id 와 type 이 달라진다 |
| 배경 레이어 | `set_opacity` 는 승격 또는 무시, `rename`·`set_blend_mode` 는 거부 |

첫 번째가 특히 나빴다. `selection.set` 설명이 "만든 선택은 mask.create 의
fromSelection 으로 쓸 수 있다" 고만 해서 **오히려 오해를 부른다.** 그 순서대로 하면
조정 레이어가 선택을 먹은 뒤라 반드시 실패한다.

## 잘 동작한 것

조정 레이어 5종, `group.create` 의 중첩(`parentId` 정확), `history.undo`,
`selection.set` 과 `photoshop://selection` 의 일치, `LAYER_NOT_FOUND` 계열 메시지는
모두 정확하고 행동 가능했다.

## 다단계 과제와 나머지 Tool

UXP DevTools CLI 로 적재를 자동화한 뒤 사람을 기다리지 않고 전 구간을 돌렸다.

```text
복제 → 블러 → softLight → 불투명도 60      ✅ 스마트 오브젝트 변환으로 id 가
                                              바뀌어도 매 호출이 정확히 보고한다
선택(layerTransparency · canvas) → 레벨    ✅ 조정 레이어가 선택을 마스크로 받는 것이
                                              이제 hasMask 로 보인다
undo ×3 → 되돌아감, 목록은 안 줄어듦        ✅ currentIndex 11 → 8
undo 끝까지 → HISTORY_EMPTY                ✅ "되돌릴 작업이 없습니다."
export(png) → place → 재export             ✅ 왕복 성공, FILE_ALREADY_EXISTS 방어
save_as(psd) → workspace.usage/delete       ✅ 790MB → 6KB
```

Core Tool 은 사실상 전부 LLM 시점으로 지나갔다. 남은 것은 `document.save`(destructive)
뿐이며 원본을 덮어쓰므로 시험하지 않았다.

### `document.name` 이 전체 경로일 때가 있다

명령줄로 연 문서에서 확인했다. Photoshop 이 주는 값이라 그대로 전달하는 것이 맞지만,
임시 파일 이름을 여기서 파생하는 Extension 이 문제였다 — 40자로 자르면 앞의 경로가
다 차지해 `D-Dev-ClaudeCode-PhotoshopMCP-testimage-새` 가 된다. 어느 문서에서 나온
파일인지 알 수 없다. `slug()` 가 경로 구분자 뒤만 쓰도록 고쳤다.

## 남은 것

Zod 기본 메시지가 영어다 — `radius: Number must be less than or equal to 1000`.
직접 쓴 메시지는 한글이라 섞인다. 번역 정책을 정하면 `errorMap` 한 곳에서 처리한다.

---

# 17.8 실제 편집 워크플로가 드러낸 공백

사용자가 천체사진 보정 23단계를 주고 LLM 시점으로 돌려 보게 했다. 제약은
"Photoshop 네이티브만 · 외부 실행 파일 금지 · 비파괴 우선 · 원본 보존" 이었다.

처음 돌렸을 때 **11단계만 실행되고 9단계가 Tool 부재로 막혔다.** 개별 Tool 을
하나씩 눌러 보는 방식으로는 이런 목록이 나오지 않는다 — 실제 작업 순서를 따라가야
무엇이 없는지 드러난다.

## 채운 것

| 워크플로 단계 | 추가한 Tool |
|---|---|
| 2 (원본/작업 레이어 정리) | `photoshop.layer.from_background` |
| 4 (하늘 선택) | `photoshop.selection.sky` (§17.7 참조) |
| 8 · 22 (색 보정) | `photoshop.adjustment.color_balance` |
| 12–16 (High Pass 샤프닝) | `photoshop.filter.high_pass` |
| 18 (별 축소) | `photoshop.filter.minimum_maximum` |

`layer.from_background` 가 없어서 지금까지 배경 레이어 승격은 `set_opacity` 나
`mask.create` 의 **부작용으로만** 일어났다. 의도를 드러내지 않는 우회였다.

## 실기가 잡은 것 — 필터가 조정 레이어를 망가뜨렸다

`filter.high_pass` 를 조정 레이어가 활성인 상태에서 부르니:

```text
❌ COMMAND_FAILED | 선택 영역이 비어 있으므로 요청한 사항을 완료할 수 없습니다.
layer.list → "Sky Color"(adjustment) 가 (smartObject) 로 바뀌어 있다
```

스마트 오브젝트 변환이 **먼저 성공**한 뒤 필터가 실패한다. 실패로 보고되지만 조정
레이어는 이미 망가졌다. Photoshop 의 메시지로는 원인을 알 수 없다.

`gaussian_blur` 도 같은 구조였으므로 처음부터 있던 함정이다. 대상을 먼저 검사해
조정 레이어와 그룹을 거부한다.

```text
❌ INVALID_PARAMETER | 조정 레이어에는 필터를 적용할 수 없습니다.
                      픽셀 레이어나 스마트 오브젝트를 layerId 로 지정하세요.
```

수정 뒤 조정 레이어는 그대로 남는다.

## 실기 검증

```text
layer.from_background → 배경 "배경" → "Work"(배경 플래그 해제, id 변경)
color_balance          → Sky Color 조정 레이어
high_pass(15) → softLight → opacity 30   샤프닝 블록 성립
minimum(0.4)                             별 축소 성립
selection.sky → color_balance            하늘에만 적용 (bounds bottom 4507)
```

## 스마트 오브젝트 없이도 성립한다

`asSmartFilter: false` 경로는 그때까지 한 번도 시험하지 않았다. 사용자 요청으로
스마트 오브젝트를 배제하고 같은 워크플로를 돌렸다.

```text
13:"Sharpen"(pixel,op30,softLight)   High Pass 샤프닝
17:"Global Color"(adjustment,mask)
16:"Foreground"(adjustment,mask)
15:"Sky Color"(adjustment,mask)
14:"Sky Tone"(adjustment,mask)
12:"Work"(pixel)                     별 축소 적용
```

**레이어 id 가 전 구간에서 유지된다.** 스마트 필터 경로는 변환할 때마다 id 와 type 이
바뀌어 호출자가 매번 반환값을 다시 읽어야 하는데, 이쪽은 그럴 필요가 없다. 여러
단계를 이어갈 때는 이쪽이 추적하기 쉽다.

대신 픽셀에 구워진다. **비파괴는 복제본에서 온다** — `layer.duplicate` 한 레이어에
적용하면 원본이 남는다. 이 절충을 Tool 설명에 적었다.

### 그래서 기본값을 뒤집었다

`asSmartFilter` 의 기본이 `true` 였다. 세 가지 이유로 `false` 로 바꿨다.

1. **Photoshop 자신의 기본이 아니다.** Photoshop 에서 필터를 걸면 픽셀에 적용된다.
   스마트 필터는 `필터 > 고급 필터용으로 변환` 을 명시적으로 고를 때만이다.
2. **요청보다 큰 일을 한다.** 호출자는 "이 레이어에 블러" 를 요청했는데 레이어가
   스마트 오브젝트로 바뀐다. 실기 한 번에 id 가 세 번 바뀌어 추적을 놓쳤다.
3. **비파괴를 얻는 더 싼 방법이 있다.** `layer.duplicate` 다. 의도가 드러나고 원본
   id 가 그대로 남는다.

필수 파라미터로 만드는 안도 검토했으나 택하지 않았다. **조용한 기본값이 조용한
추측으로 바뀔 뿐**이기 때문이다 — LLM 이 무언가 고르긴 하는데 설명을 읽고 판단한
것인지 찍은 것인지 구분할 수 없다. 게다가 빠뜨렸을 때의 오류가 `radius: Required`
수준이라 무엇을 왜 넣어야 하는지 알려주지 못한다. 문제는 "호출자가 고르지 않았다"
가 아니라 "기본값이 놀라운 일을 한다" 였다.

## 남은 공백도 마저 채웠다

| 워크플로 단계 | 추가한 Tool |
|---|---|
| 5 · 6 (선택 저장/불러오기) | `selection.save_channel` · `selection.load_channel` |
| 20 (경계 다듬기) | `selection.modify` — feather · expand · contract · smooth |
| 10 (광도 마스크) | `selection.color_range` — highlights · midtones · shadows |
| 12 (병합본) | `layer.stamp_visible` |

`load_channel` 의 `invert` 는 **채널 하나로 전경까지 얻게** 한다. 하늘을 저장해 두면
반전해서 불러오는 것만으로 전경 선택이 된다 — 채널을 둘 만들 필요가 없다.

실기 확인:

```text
selection.sky → save_channel("Sky")            {"name":"Sky"}
clear → load_channel("Sky")                    bounds 0–4497  (하늘)
modify(feather 30)                             bounds 0–4515  (경계가 번진 만큼 넓어짐)
load_channel("Sky", invert)                    bounds 3862–6048 (전경)
color_range(midtones)                          bounds 134–4271
stamp_visible                                  22:"Merged"(pixel)
```

### 두 가지는 실패처럼 보였지만 정상이었다

`color_range(highlights)` 가 `hasSelection: false` 를 돌려줬다. descriptor 문제가
아니라 **어두운 야경에 highlights 가 실제로 없어서**다. fuzziness 를 200 까지 올려도
같다. 해당 픽셀이 없으면 비는 것이 맞고, 오류가 아니라는 것을 설명에 적었다.

`stamp_visible` 이 `"보이는 레이어 병합" 명령은 현재 사용할 수 없습니다` 로 실패했다.
보이는 레이어가 하나뿐이면 Photoshop 이 막는다. 원문으로는 왜인지 알 수 없으므로
먼저 세어 보고 안내한다.

```text
❌ 보이는 레이어가 1장뿐이라 병합할 것이 없습니다. 2장 이상이어야 합니다
   — 합칠 필요가 없으면 layer.duplicate 를 쓰세요.
```

## 그라디언트 마스크 — 성격이 다른 마지막 하나

9단계(지평선 쪽만 서서히 밝기를 낮추기)가 남아 있었다. 나머지 Tool 은 **선택 영역을
만드는데** 이것은 **마스크의 내용을 칠한다.** 그래서 마스크 채널을 편집 대상으로
잡았다가 끝나면 되돌려야 한다 — 안 되돌리면 이후 편집이 전부 마스크에 들어간다.

`photoshop.mask.gradient` 는 `from` 에서 `to` 로 검은색→흰색을 그린다. 마스크에서
검은색은 가려지는 쪽이므로, 지평선(아래)에서 위로 그으면 지평선 쪽에만 효과가 약해진다.

### 실기 확인 — Photoshop 이 직접 말해 준다

호출이 성공해도 **정말 마스크에 그려졌는지**는 픽셀을 읽을 수 없어 확인이 어렵다.
History 가 답을 줬다.

```text
photoshop://history
  → "새 곡선 레이어", "마스크에 클래식 그레이디언트 그리기"
```

Photoshop 자신이 "마스크에" 그렸다고 기록한다. 이어서 `layer.create` 가 정상
동작하는 것으로 합성 채널 복원도 확인했다.

### 오류 두 개도 다듬었다

```text
마스크 없는 레이어:  "선택" 명령은 현재 사용할 수 없습니다        (Photoshop 원문)
                  → 이 레이어에 마스크가 없습니다. mask.create 로 먼저 만드세요.
                    layer.list 의 hasMask 로 확인할 수 있습니다.

from == to:        그라디언트에는 길이가 필요합니다 (스키마에서 막는다)
```

같은 점을 주면 Photoshop 이 조용히 아무것도 안 할 수 있어 호출자가 적용된 줄 안다.

Core Tool 52개.

## 완주 시험 — 23단계를 처음부터 끝까지

Tool 을 다 채운 뒤 새 문서에서 전 구간을 순서대로 돌렸다. **35/35 성공.**

```text
1·2   from_background → duplicate("Work")
4·5   selection.sky → save_channel("Sky")
3     group.create("MilkyWay_Edit")
7     load_channel("Sky") → curves("Sky Tone")
8     load_channel("Sky") → color_balance("Sky Color")  midtones [0,-14,10]
9     curves("Light Pollution") → mask.gradient(아래→위)
10    color_range(midtones) → save_channel("MilkyWay")
11    curves("MW Contrast")
17    load_channel("MilkyWay") → hue_saturation(+10)
12    stamp_visible("Sharpen")
13-16 high_pass(15) → softLight → mask.create(fromSelection) → opacity 30
18    minimum(0.4)
19·20 load_channel("Sky", invert) → modify(feather 40) → curves("Foreground Lift")
21·22 clear → curves("Global Tone") → color_balance(highlights)
23    save_as(psd)
```

제약도 전부 지켜졌다 — Photoshop 네이티브만, 외부 실행 파일 없음, 조정 레이어 중심,
`Original` 레이어 무손상.

### 순서가 하나 걸렸다 — 그룹이 활성이면 하늘 선택이 막힌다

처음 돌릴 때 `group.create` 직후 `selection.sky` 가 실패했다.

```text
❌ "하늘 선택" 명령은 현재 사용할 수 없습니다.
```

**그룹이 활성 레이어일 때만** 그렇다. 조정 레이어는 괜찮다는 것을 레이어 종류별로
확인했다. 워크플로 순서상 흔히 걸리는 자리다 — 그룹을 만들면 그룹이 활성이 되고
바로 다음이 하늘 선택인 경우가 많다.

원문으로는 왜인지 알 수 없으므로 미리 검사해 안내한다.

```text
❌ 그룹이 활성 레이어면 하늘을 선택할 수 없습니다.
   layer.select 로 픽셀 레이어나 조정 레이어를 먼저 고르세요.
```

### 없는 채널을 부르면 Mock 이 실기보다 친절했다

```text
Mock: 채널 'Sky' 을 찾을 수 없습니다.
실기: "설정" 명령은 현재 사용할 수 없습니다.       ← 이름이 틀렸는지도 알 수 없다
```

실기를 Mock 에 맞췄다. 원래 첫 실행에서 `save_channel` 이 실패해 채널이 없는 상태로
불러오다 이 벽을 만났다.

### 같은 레이어인데 답이 둘이었다

```text
set_opacity 결과    50:"Sharpen"(pixel,op30,softLight)         ← mask 표시 없음
layer.list          50:"Sharpen"(pixel,op30,softLight,maskon)  ← mask 있음
```

마스크는 멀쩡한데 편집 결과만 그 정보를 안 담았다. `layer.list` 와 `mask.*` 만
마스크 상태를 채웠기 때문이다. 호출자는 마스크가 사라졌다고 읽는다.
`mutate()` 가 결과에 마스크 상태를 함께 담도록 했다.

# 17.9 실제 사용자 요청으로 시험

정해진 23단계가 아니라 **사용자가 자연어로 쓴 보정 요청**을 그대로 받아 처리했다.
레이어 이름 규칙(`00_Original` ~ `09_Final_Curves`)과 "자연스럽게, 과한 대비·채도
금지" 같은 판단 기준까지 포함된 요청이다.

호출 47건 전부 성공했고 요청한 구성이 나왔다. 그 과정에서 셋이 드러났다.

## 레이어 순서를 바꿀 수 없다

전역 조정(`08_Global_Color` · `09_Final_Curves`)을 만들었더니 하늘 조정들보다
**아래**에 생겼다. 조정 레이어는 아래쪽에만 영향을 주므로 전역 보정이 무력해진다.
활성 레이어 위에 쌓이기 때문인데, 만든 뒤에 옮길 방법이 없다.

`history.undo` 로 지우고 맨 위 레이어를 활성으로 둔 뒤 다시 만들어 해결했다.
회복은 되지만 **순서 변경 Tool 이 없다는 것이 진짜 공백**이다 —
`layer.move` · `move_above` · `move_below` · `move_top` · `move_bottom` 이
CORE_API §5.2 후보에만 있다.

## `mask.gradient` 가 기존 마스크를 덮어쓴다

하늘 선택에서 마스크를 받은 조정 레이어에 지평선 그라디언트를 그렸더니 하늘 제한이
지워졌다. 결과가 맞았던 것은 그라디언트의 검은 영역이 마침 전경을 덮었기 때문이지
마스크가 지켜져서가 아니다. 설명에 없던 사실이라 적었다.

## 결과를 볼 수 없다 — **틀렸다. §17.10 에서 정정한다**

요청은 "나무·능선 주변에 halo 가 생겼는지 확인하고 정리해줘" 를 포함했다.
픽셀을 읽을 수 없어 전경 마스크에 feather 80px 를 넣어 예방만 하고, 확인은
불가능하다고 보고했다.

그리고 **"이것은 Tool 을 더 만들어 풀 문제가 아니다"** 라고 적었다. 이 문장이 틀렸다.
UXP 에는 `imaging` API 가 있고 축소한 픽셀을 메모리로 준다. 없는 것은 능력이 아니라
그 능력을 쓰는 Tool 이었다. 없는 것을 불가능으로 바꿔 적으면 그 자리는 다시 보지
않게 된다 — 사용자가 "capture 하면 되는 것 아닌가?" 라고 묻지 않았으면 그대로
남았을 기록이다.

## 없어서 대체한 것

`Selective Color` 가 없어 Curves + Color Balance 로 처리했다. CORE_API §5.5 후보다.

---

# 17.10 캡처 — 호출자가 자기 결과를 본다

§17.9 의 "결과를 볼 수 없다" 를 정정하며 만들었다.

- [x] `photoshop.document.capture` — 합성 결과
- [x] `photoshop.layer.capture` — 레이어 하나
- [x] `photoshop.selection.capture` — 선택 영역의 경계 상자

권한은 셋 다 `read` 다. 파일을 만들지 않고 폴더 승인도 필요 없다.
`document.export` 로도 볼 수는 있지만 6000×4000 원본을 디스크에 쓰고 `external`
권한을 요구한다 — 확인하려고 파일을 만드는 것은 본말이 뒤집힌 것이다.

## 제안된 다섯 중 셋만 만들었다

```text
capture_canvas   ┐
                 ├→ 같은 것이다. document.capture 하나로 합쳤다
capture_document ┘
capture_layer     → 만들었다
capture_selection → 만들었다
capture_window    → 만들지 않는다
```

`capture_window` 는 UXP 로 할 수 없다. OS 수준 화면 캡처는 샌드박스 밖이다.

여기에 "설령 되더라도 찍히는 것은 픽셀이 아니라 패널과 툴바다. 보고 싶은 것이
아니다" 라고 덧붙였는데 **그 판단이 좁았다.** 패널과 툴바가 찍히는 것이 필요한
경우가 있다 — §17.11 에서 UXP 밖의 경로로 만들었다.

## 결과는 MCP image content block 으로 나간다

```ts
content: [
  { type: "image", data: base64, mimeType },
  { type: "text", text: JSON.stringify(meta) },  // width · height · source
]
```

base64 를 텍스트 JSON 에 담아 보내면 **LLM 은 그것을 볼 수 없고 토큰만 먹는다.**
서버가 결과를 알아보는 기준은 `CapturedImage` 계약(`photoshop-bridge/src/capture.ts`)
하나다. 크기는 텍스트로 함께 준다 — 이미지 블록만으로는 몇 픽셀을 받았는지 모른다.

긴 변은 기본 1024, 상한 2048 이다. 구도·색·노출 판단에는 충분하고 그보다 크면
토큰만 먹는다.

## Imaging API 실기 제약 넷

실기에서 하나씩 벽에 부딪혀 알아낸 것이다. 전부 `photoshop-uxp/src/dom/capture.ts`
에 주석으로 남겨 두었다.

| 시도 | 결과 |
|---|---|
| `getPixels({componentSize: 8})` | `-32005 선택 영역을 저장할 수 없습니다` |
| `encodeImageData` 에 16비트 그대로 | `Only 8 bit image data can be encoded as jpeg` |
| `format: "png"` 으로 회피 | 같은 오류. **이 옵션은 무시되는 듯하다** |
| 알파 포함 4채널 | `Image data with alpha cannot be encoded as jpeg` |

그래서 받은 픽셀을 **JS 에서 직접 8비트 RGB 로 낮춘 뒤** 새 ImageData 로 감싼다.

## **Photoshop 의 16비트는 0–65535 가 아니라 0–32768 이다**

가장 조용한 함정이었다. `>> 8` 로 낮췄더니 최대값이 128 이 되어 **딱 절반 밝기**로
나왔다. 오류는 나지 않는다. 캡처가 원본보다 어두운 것을 눈으로 보고 알았다.

```ts
const scale = 255 / 32768;   // 65535 가 아니다
```

`-32005` 를 처음 봤을 때는 modal 충돌로 짐작했다. 아니었다 — 원인은 위 표의
`componentSize: 8` 이고, 캡처도 다른 Command 와 똑같이 `runModal` 안에서 돈다.
오류 메시지가 실제 원인과 무관할 때가 있다.

## 남은 진짜 공백

§17.9 가 잡은 셋 중 **레이어 순서 변경**은 아직 없다. 캡처는 "결과를 본다" 를 풀었고
순서 변경은 "결과를 고친다" 쪽이다. 우선순위가 가장 높은 후보다.

**§17.23 에서 채웠다.**

---

# 17.11 창 캡처 — 멈췄을 때 왜 멈췄는지 본다

- [x] `photoshop.window.capture` — Photoshop 메인 창. Windows 전용

§17.10 을 만들고 나서 "`capture_window` 는 UXP 샌드박스 밖이고 되더라도 찍히는 것은
픽셀이 아니라 패널과 툴바다" 라고 적었다. 앞부분은 맞고 **뒷부분이 요점을 놓쳤다** —
패널과 툴바가 찍히는 것이 단점이 아니라 바로 그것이 필요한 경우가 있다.

## 쓸모는 하나다

**대화상자가 떠 있으면 Photoshop 이 명령을 받지 못한다.** batchPlay 가 응답하지 않고
호출자는 타임아웃만 본다. `photoshop.diagnostics` 도 이건 못 본다 — Bridge 가 응답을
못 하는 상태이므로 Photoshop 에게 물어볼 방법 자체가 없다. 밖에서 창을 찍는 것이
유일한 길이다.

보정 결과 확인용이 아니다. 그건 §17.10 의 캡처 셋이다.

## 헬퍼 실행 파일이 필요 없다

**서버가 Photoshop 과 같은 기계에 있다.** Bridge 가 localhost WebSocket 이라 그럴
수밖에 없다. UXP 를 거칠 것도, 바이너리를 따로 깔 것도 없이 Node 가 직접 찍는다.
Windows 는 PowerShell + `PrintWindow` 로 **의존성 0** 이다.

`capabilities.json` 에 헬퍼를 등록하는 길도 있었지만 택하지 않았다. 사용자가 바이너리를
따로 설치해야 하고, Capability 출력은 승인된 작업 폴더로 간다 — 진단용 스크린샷을
디스크에 쌓을 이유가 없다.

## 세 방법을 재고 골랐다

Photoshop 27.8, 창 3862×2099.

```text
PrintWindow flags=0              검정  1.2%  색 4341    창 내용이 나온다
PrintWindow RENDERFULLCONTENT=2  검정  2.6%  색 5000+   창 내용이 나온다
CopyFromScreen (화면 복사)        검정  1.0%  색  345    ← 위에 있던 딴 창이 찍혔다
```

둘이 갈렸다.

**GPU 캔버스가 검게 나오지 않는다.** 이것이 가장 걱정한 부분이었다. `PrintWindow` 가
GPU 가속 창에서 검은 사각형을 내놓는 경우가 있어서 짐작하지 않고 쟀다.
`PW_RENDERFULLCONTENT`(2) 쪽이 색이 더 풍부해 그것을 쓴다.

**가려져 있어도 그 창을 찍는다.** 화면 복사는 위에 있는 창을 찍는다 — 표의 "색 345"
가 그것이다(당시 위에 있던 에디터 화면). 진단 목적에는 이 차이가 결정적이다.
Photoshop 이 뒤에 있어도 대화상자를 볼 수 있어야 한다.

## `read` 가 아니라 `external` 이다

| | 찍는 대상 | Permission |
|---|---|---|
| §17.10 캡처 셋 | Photoshop **문서의 픽셀** | `read` |
| `window.capture` | **사용자의 화면** | `external` |

창에는 파일 경로, 최근 문서 목록, 계정 이름, 다른 대화상자가 보인다. 문서를 읽는
것과 승인 경계가 다르다. `external` 이면 기본 허용(`read` · `edit`) 밖이라 **기본적으로
꺼져 있고** 사용자가 `PHOTOSHOP_MCP_ALLOW` 로 켜야 한다.

Command Engine 을 거치지 않는다. Photoshop 에 닿지 않고 OS 에게 묻기 때문이다 —
`capability.list` · `diagnostics` 와 같은 부류이고, 권한은 Tool 레지스트리가 강제한다
(`photoshop-bridge/src/tool.ts`).

## 대상을 고르게 하지 않는다

Photoshop 메인 창으로 **고정**한다. 호출자가 창 제목이나 핸들을 고를 수 있으면 그것은
임의 창 캡처 도구이고, §23 이 막으려던 것과 같은 종류가 된다. 필요가 확인되면 그때
넓힌다.

같은 이유로 **LLM 이 준 값이 스크립트 문자열에 섞이지 않는다.** 스크립트는 고정
상수이고 `longEdge` 는 자식 프로세스의 환경 변수로만 간다. 문자열 조립이 한 군데도
없으므로 주입할 틈이 없다.

## 못 없애는 한계 둘

**최소화된 창.** `PrintWindow` 가 예전 내용이나 빈 화면을 내놓는데 오류는 나지 않는다.
그대로 돌려주면 호출자는 그것이 현재 화면이라고 믿는다. `IsIconic` 으로 미리 잡아
실패로 돌려준다 — 틀린 것을 맞다고 주는 것이 조용한 실패 중 가장 나쁘다.

**macOS.** `screencapture -l <windowid>` 에 사람이 화면 기록 권한을 승인해야 하는
별개 경로다. 미지원으로 명시한다. 목록에는 노출하되 이유를 말하며 실패한다 —
되는 척하는 것보다 낫다.

## 실기 검증

Tool 경로 전체로 통과시켰다. 4K 창이 1400×761 로 줄었는데 **레이어 이름까지 읽힌다** —
`00_Original` ~ `10_Final_Curves` 스택, 커브 패널, 플러그인 목록, 활성 도구가 모두
판독된다. 93KB · 723ms.

---

# 17.12 자르기 — 조정 레이어로는 할 수 없는 일

- [x] `photoshop.document.crop`

실기 보정(§17.13)에서 **가장 큰 문제를 손도 못 댔다.** 아웃포커스 전경 가지가
피사체를 덮고 있었는데 조정 레이어로는 구도를 바꿀 수 없다. 톤·색과 다른 종류의
일이라는 것이 그때 드러났다.

## **픽셀을 버리지 않는다**

batchPlay 에 `delete: false` 를 명시한다. 캔버스 경계만 줄고 바깥 픽셀은 레이어에
남는다. 그래서 `destructive` 가 아니라 `edit` 이다 — 되돌릴 수 있고 잃는 것이 없다.
대신 파일 크기는 줄지 않으며 결과의 `pixelsRetained` 가 그것을 알린다.

**버리는 자르기를 옵션으로 두지 않았다.** 파라미터 하나로 permission 이 `edit` 에서
`destructive` 로 올라가면 `tools/list` 의 정적 선언이 거짓이 된다. Permission 을
필수 정적 필드로 둔 이유가 그것이다(§22). 정말 버려야 하면 export 나 flatten 이 한다.

만약 `destructive` 로 뒀다면 기본 허용(`read` · `edit`) 밖이라 **기본 설정에서
자르기가 막혔을 것이다.** 되돌릴 수 있는 일을 막는 것은 과하다.

## 요청한 크기가 아니라 실제 크기를 돌려준다

Photoshop 이 반올림하거나 경계를 조정할 수 있다. 요청값을 그대로 돌려주면 호출자는
맞다고 믿고, 어긋난 것은 한참 뒤에 드러난다. 자르기 전 크기도 함께 담는다 —
무엇이 얼마나 줄었는지 알아야 한다.

## Mock 이 undo 로 크기를 되돌리지 못했다

테스트를 쓰다 잡았다. Mock 의 History 스냅샷이 **레이어만** 담고 문서를 담지 않아,
자르기를 undo 해도 크기가 돌아오지 않았다. 그대로 뒀으면 Mock 만 "자르기는 되돌릴
수 없다" 는 거짓을 말하게 된다 — 이 Command 의 핵심 주장이 바로 되돌릴 수 있다는
것이므로 정확히 그 자리가 검증되지 않았을 것이다.

스냅샷에 `document` 를 넣어 고쳤다. 배경 승격 때와 같은 교훈이다 — **Mock 이 현실과
다르면 그 경로는 테스트에 영원히 나오지 않는다.**

## `pixelsRetained` 가 뜻하는 것

**우리가 `delete: false` 로 실행했다는 사실**이다. Photoshop 이 실제로 픽셀을 들고
있는지는 **밖에서 확인할 방법이 없다** — 레이어 경계를 읽는 API 가 없고, 캔버스를
다시 넓혀 보려 해도 이 Command 가 확장을 거부한다.

값이 항상 `true` 인 상수라서 `isBackground` 처럼 "모르면 담지 않는" 규칙을 적용할지
따졌다. 담기로 했다. 저 둘은 다르다 — `isBackground` 는 **Photoshop 에게 물어본
결과**이고 이것은 **우리가 보낸 파라미터**다. 우리가 무엇을 했는지는 안다.
다만 확인하지 못했다는 사실을 여기에 적어 둔다.

## 실기 검증

Photoshop 27.8, 6048×4032 16비트 문서.

```text
범위 밖 요청    right 7048 → INVALID_PARAMETER "문서(6048×4032)를 벗어납니다"
자르기          6048×4032 → 5383×3104   요청 경계와 정확히 일치
history.undo    5383×3104 → 6048×4032   정확히 복원
다시 자르기     6048×4032 → 5473×3225   1.70 : 1
```

**되돌리기가 실기에서 확인됐다.** 이것이 `edit` 분류의 근거다.

첫 시도는 아래를 너무 잘라 교회 하부가 날아갔다. 도구가 아니라 경계 판단이 틀린
것이고, `document.capture` 로 바로 보여서 한 번에 고쳤다 — §17.10 이 없었으면
내보내기 전까지 몰랐을 일이다.

## 자르기로 안 되는 것도 있다

오른쪽 아래 아웃포커스 가지는 도시와 겹쳐 있어 사각형으로는 뺄 수 없다.
구도 도구가 생겼다고 구도 문제가 다 풀리지는 않는다.

---

# 17.13 통계 — 보는 것으로는 잡히지 않는 것

- [x] `photoshop.document.statistics`

`docs/RETOUCH_PROCESS.md` 를 세운 뒤 **실제로 막힌 것만** 골라 만든 첫 Tool 이다.
보정 세 번 중 **세 번 다** 막힌 유일한 공백이었다. 매번 내보낸 미리보기를
PowerShell 로 밖에서 쟀다.

## 근거

이 세션 최악의 버그 둘이 같은 원인이다.

```text
보라색 하늘   열 단계를 다 쌓고 내보내기로 확인하고서야 발견
초록색 하늘   미리보기를 보고 "좋다" 고 판단 → 수치를 재고서야 발견
```

둘 다 **눈으로는 통과했다.** §17.10 의 캡처가 "보는" 문제를 풀었지만 어두운 영역의
색 편향·미세한 캐스트·작은 클리핑은 봐서 잡히지 않는다.

## 미리보기를 재면 안 된다

밖에서 재던 것은 8비트로 낮춘 **축소** JPEG 였다. 축소하면 단일 픽셀 클리핑이
평균에 묻히고, 8비트로 내리면서 값이 바뀌며, ICC 가 없어 색 판단도 흔들린다.
전체 해상도 원본에서 재는 것이 이 Tool 의 존재 이유다.

실제로 차이가 드러났다. 미리보기로는 "crush 0.09%" 한 덩어리였던 것이
원본에서는 **채널마다 갈렸다.**

```text
clippedLow   R 0.102%   G 0.0545%   B 0.0081%
```

가장 깊은 그림자에서 빨강이 먼저 바닥을 친다는 사실은 미리보기로는 볼 수 없었다.

## 짐작하지 않고 경로를 골랐다

구현 경로가 둘이었다 — UXP DOM 의 `document.histogram`(Photoshop 이 계산, 빠름)과
`imaging.getPixels`(직접 계산). **첫 실행에서 둘 다 확인하도록 만들어 재 봤다.**

```text
getPixels 6048x4032 comp=4 size=16   docHistogram=undefined   432ms
```

**DOM histogram 은 이 환경에 없다.** 짐작으로 골랐으면 없는 API 를 썼을 것이다.
그리고 2440만 픽셀을 432ms 에 처리하므로 **표본 추출이 필요 없다** — 전수로 센다.
(캡처에서 Imaging API 제약을 하나씩 벽에 부딪혀 알아낸 것과 같은 방식이다)

## 값은 0–255, 클리핑은 원래 심도에서

문서가 8비트든 16비트든 같은 눈금으로 읽어야 비교가 되고, 사진하는 사람이
히스토그램을 읽는 눈금이기도 하다.

**클리핑 판정만은 원래 심도에서** 한다. 16비트를 먼저 8비트로 내리면 32768 과
32700 이 똑같이 255 가 되어 클리핑이 부풀려진다. (16비트 최대값이 32768 인 것은
§17.10 에서 이미 한 번 덴 자리다)

## 조정 레이어는 거절한다

실기에서 `layerId` 로 조정 레이어를 재 봤더니 이렇게 나왔다.

```text
layer:2 (Curves)        24,385,536 px   모든 채널 평균 255
layer:3 (Curves+마스크)  10,378,368 px   모든 채널 평균 255
```

픽셀이 아니라 **마스크 영역**을 잰 것이다. 픽셀 수까지 그럴듯하게 달라서 더
그럴듯하다. 그대로 돌려주면 호출자는 "이 레이어는 순백" 이라고 읽는다 —
**아무 값도 안 주는 것보다 나쁘다.**

막고 무엇을 하라고 말한다. "layerId 를 빼면 조정이 반영된 합성 결과를 잽니다."

## 실기 검증

Photoshop 27.8, 6048×4032 16비트.

```text
문서 전체        24,385,536 px   401ms
선택 영역        6,048,000 px    110ms   (6048×1000, 정확히 일치)
레이어 하나      24,385,536 px   380ms
선택 없이 selection   3ms 거절
없는 레이어           5ms 거절
조정 레이어          15ms 거절
```

**미리보기를 밖에서 잰 값과 교차 검증했다.**

```text
밖에서 (8비트 축소)   R 106.4  G  96.7  B  78.2   p5 13    p50 95    p95 212
안에서 (16비트 원본)  R 106.74 G  96.58 B  77.73  p5 12.9  p50 95.4  p95 212.4
```

거의 일치한다. 구현이 맞다는 뜻이고, 동시에 **이제 밖에서 잴 이유가 없다**는 뜻이다.

## 합성이 기본이다

`layerId` 를 생략하면 보이는 그대로를 잰다. 조정 레이어를 포함한 합성과 배경만
잰 값이 실제로 다르게 나와 이 구분이 동작함을 확인했다.

```text
합성        R 106.74   ← 01_Flat_Lift 가 올린 만큼 밝다
배경만      R 105.30
```

---

# 17.14 결함 제거 — 비어 있던 한 단계

- [x] `photoshop.retouch.remove_spots`

`RETOUCH_PROCESS` 3단계가 통째로 비어 있었다. 갯벌 사진에서 하늘의 센서 먼지를
찾아 놓고 **지우지 못했다.**

## 치유 브러시가 아니라 채우기다

치유 브러시는 붓질(획)을 요구한다. batchPlay 로 획을 흉내 내는 것은 좌표 목록을
보내는 일이 되고, 그러면 호출자가 descriptor 를 조립하는 것과 다를 바 없어진다.
(ARCHITECTURE §23)

먼지는 "점 하나" 라서 **타원 선택 + 내용 인식 채우기** 로 충분하다. 실기에서
그렇게 확인했다.

## **배경 레이어를 거절한다**

이 Command 의 가장 중요한 성질이다.

먼지 제거는 **원본 촬영 픽셀을 지우는 것이 목적인 유일한 작업**이다. 필터는 효과를
입히는 것이지만 이것은 있던 것을 없앤다. 배경에 바로 걸면 카메라가 본 것의 기록이
사라진다. RETOUCH_PROCESS 3단계가 "반드시 원본과 분리한다" 고 적은 자리다.

막으면서 **무엇을 하라고 말한다** — "layer.duplicate 로 복제한 뒤 그 레이어를
layerId 로 지정하세요." 한 번 더 부르는 비용으로 원본이 남는다.

`isBackgroundLayer` 는 Photoshop 이 알려줄 때만 담는 값이라 **모르면 막지 않는다.**
없는 것을 참으로 읽어 멀쩡한 호출을 막는 것이 더 나쁘다. (`isBackground` 와 같은 원칙)

## 그래서 `edit` 이다

픽셀을 직접 바꾸지만 배경을 막아 두었으므로 사라지는 것은 **이미 사본인 레이어**의
픽셀이고 History 로 되돌아간다. 필터와 같은 급이다.

`destructive` 로 뒀다면 기본 허용 밖이라 기본 설정에서 막혔을 것이다. 사본을 고치는
일을 막는 것은 과하다. (`document.crop` 과 같은 판단 — §17.12)

## 선택을 남기지 않는다

`finally` 에서 해제한다. 남기면 **다음 Command 가 조용히 그 범위에만 걸린다.**
이미 실패한 길이면 해제 실패까지 덮어쓰지 않는다.

## 실기 검증

Photoshop 27.8, 6048×4032. 갯벌 사진의 진짜 센서 먼지 셋.

```text
배경(id 1) 에 시도        7ms 거절 — "layer.duplicate 로 복제한 뒤…"
layer.duplicate          36ms  → 03_Spot_Removal (id 5, isBackground false)
remove_spots 3개         271ms → removed: 3
```

**성공 보고만 믿지 않고 쟀다.** 지점별로 주변 링 대비 중심의 어두움을 비교했다.

```text
지점            전 drop   후 drop
(500, 120)       13.4      0.6      95% 제거
(255, 435)        9.9      2.1      79%
(1100, 355)       4.0      2.1      원래 약했던 것
```

**주변 링 값이 그대로다** (157.2→157.1, 118.5→118.7, 145.1→145.1).
채우기가 선택 밖으로 새지 않았다 — 헤일로도 톤 이동도 없다.

## 먼지와 새를 구분하는 것은 자동화되지 않았다

검출기를 돌리면 새·비행기·구조물이 같이 걸린다. 실기에서 후보 16개가 전부 새였다.
**좌표는 사람이나 LLM 이 눈으로 확인해 준다** — Tool 은 주어진 좌표를 지울 뿐이다.
그 경계를 흐리지 않는다. (RETOUCH_PROCESS 3단계에 적었다)

---

# 17.15 노이즈 측정 — 눈대중이던 마지막 판단

- [x] `document.statistics` 의 채널마다 `noise`

**새 Tool 이 아니다.** 있던 것에 한 항목을 더했다. 권한도 그대로 `read` 다.

## 근거

실기 보정 **네 번 중 네 번** 노이즈만은 눈으로 판단했다. 히스토그램은 분포를 주지만
**인접 픽셀의 흔들림**은 주지 못한다.

그리고 천체사진 원본(§17.16)에서 처음으로 그것이 작업을 막았다 — 스트레치가 노이즈를
키웠는데 "얼마나 올려도 되는가" 를 정할 숫자가 없었고, 전경을 올리지 못한 채 끝냈다.

## 이웃 차의 **중앙값**이다

```text
σ ≈ median|I(x+1,y) − I(x,y)| / 0.954
```

평균이 아니라 중앙값인 것이 요점이다. 가장자리와 별은 큰 차를 만들지만 **소수**라서
중앙값을 움직이지 못한다. 평균을 쓰면 디테일이 노이즈로 읽힌다.

0.954 는 유도값이다 — 독립 잡음 두 표본의 차는 σ√2 로 퍼지고 정규분포의 중앙 절대
편차는 0.6745σ 이므로 `0.6745 × √2 = 0.954` 다.

완만한 그라디언트는 영향이 없다. 2000px 에 20단계면 픽셀당 0.01 이다.

## 실기 검증 — 이론값과 세 자리까지 맞았다

같은 하늘 영역에서 스트레치 레이어만 껐다 켰다.

```text
스트레치 끔    σ  6.689
스트레치 켬    σ 12.497        1.87 배
곡선 기울기    (75−45)/(60−44) = 1.875
```

노이즈 증폭 배율이 **곡선의 해당 구간 기울기와 유효숫자 세 자리까지 일치**한다.
추정기가 실제 노이즈를 재고 있다는 뜻이다.

산비탈(나무 질감, p50 10.7)은 σ 1.54 로 낮게 나왔다. 어둡고 그 구간의 곡선
기울기가 1에 가까우니 맞는 값이다.

## 평탄한 영역에서 재야 한다

이 추정기는 **촘촘한 질감과 노이즈를 구분하지 못한다.** 중앙값이 성긴 가장자리는
걸러내지만 나뭇잎처럼 화면을 메운 질감은 걸러내지 못한다.
`region: selection` 으로 하늘 같은 곳을 좁혀 지정한다. Tool 설명에 적어 두었다.

## 잴 수 없으면 `null` 이다

폭을 모르면 이웃이 누구인지 알 수 없다. **0 을 돌려주면 "노이즈가 없다" 는 틀린
사실**이 된다. (`rawBitDepth` · `isBackground` 와 같은 원칙)

---

# 17.16 조정 레이어는 `luminosity` 로 — 도구가 아니라 기법이었다

**코드를 한 줄도 바꾸지 않았다.** 이미 있던 `layer.set_blend_mode` 의 값 하나다.

## 두 번 같은 곳에서 넘어졌다

합성 채널에 톤 곡선을 걸면 **채도도 같이 오른다.** 색이 있는 영역에서 세 채널이
함께 곱해지기 때문이다. 야경(블루아워)과 천체사진에서 두 번 겪었고, 두 번 다
보정 레이어를 덧대어 되돌렸다 — `02_Saturation_Trim`, `03_Sky_Blue_Trim`.

## 재 보니 한 줄이면 됐다

같은 문서에서 스트레치 레이어의 블렌드 모드만 바꿔 쟀다.

```text
Stretch = normal       하늘 B−휘도  21.84
Stretch = luminosity   하늘 B−휘도  12.35
원본(스트레치 전)                    12.30    ← 사실상 동일
```

`luminosity` 는 곡선을 **휘도에만** 적용한다. 색은 원본 그대로 남는다.
덧댔던 보정 레이어가 통째로 필요 없어진다.

## 배운 것

**공백이라고 적기 전에 있는 것부터 확인한다.** 두 번 모두 "도구가 부족하다" 가
아니라 "쓸 줄 몰랐다" 였다. §17.13 에서 DOM histogram 유무를 짐작하지 않고 잰 것과
같은 태도가, 이미 가진 도구에도 필요했다.

`RETOUCH_PROCESS` 4단계에 적었다.

---

# 17.17 Camera Raw — 짐작하지 않고 키를 잡아냈다

- [x] `photoshop.camera_raw.apply`

## 세 번 틀렸다가 맞았다

처음엔 "batchPlay 로 실행은 되는데 아무것도 안 한다" 였고, 그 다음엔 "인자를 주는
방법을 모른다", 그 다음엔 "MCP 에서는 못 쓴다" 였다. **전부 틀렸다.**

```text
{_obj: "Adobe Camera Raw Filter"}            ok:true 인데 σ 변화 0
dialogOptions 로 UI 열기                      안 열림 (단, 위치를 틀리게 줬다)
메뉴 항목으로 호출                             이름 셋 다 "알 수 없음"
사람이 대화상자로 NR 36 적용 직후 인자 없이 호출   여전히 변화 0
```

막힌 것은 **descriptor 의 키 형식**이었고, 그것을 얻는 길을 몰랐던 것뿐이다.

## `addNotificationListener(["all"])` 가 답이었다

**ROADMAP §15 의 "Photoshop 알림은 동작하지 않는다" 가 틀렸다.** 그때는 **이름 있는
이벤트**로만 시험했다. `["all"]` 로 등록하면 온다 — 등록 직후 실제 수신까지 확인했다.

리스너를 걸어 두고 사람이 Camera Raw 를 한 번 돌리면, 움직인 슬라이더가 **한
descriptor 에 모여** 온다.

```json
{"$CrVe":"18.6","$PrVN":6,"$PrVe":251920384,
 "$WBal":{"_enum":"$WBal","_value":"customEnum"},"$Temp":-12,"$Tint":11,
 "$Ex12":0.4,"$Cr12":9,"$Hi12":11,"$Sh12":-17,"$Wh12":16,"$Bk12":9,
 "$CrTx":-10,"$Cl12":7,"$Dhze":-12,"$Vibr":-13,"saturation":9,
 "$LNR":25,"$LNRD":50,"$LNRC":0,"$CNR":32,"$CNRD":50,"$CNRS":50,
 "$GRNA":6,"$GRNS":25,"$GRNF":50,"$PCVA":11,"$PCVM":50,"$PCVF":50,"$PCVR":0,...}
```

Adobe 문서가 드는 네 가지 방법 중 하나다. **이름을 하나도 짐작하지 않았다.**

## **Tool 은 하나뿐이다**

슬라이더마다 Tool 을 두자는 안이 있었다. 재 보고 접었다.

같은 네 설정(`$Ex12 1.5` · `$Cr12 60` · `$Sh12 70` · `$Hi12 −60`)을 한 번에 건 것과
네 번 나눠 건 것이다.

```text
              p5      p50     p95     평균
원본          7.7    13.9    60.5    21.16
한 번에      11.7    30.8   130.4    44.77
네 번 나눠   13.9    36.6   124.0    48.01
```

p50 이 19% 어긋나고 하이라이트는 오히려 **덜** 눌렸다. Camera Raw 는 슬라이더들이 한
렌더링 파이프라인 안에서 함께 계산되는데, 나눠 걸면 이미 구워진 픽셀 위에 다시 거는
것이 된다. 24MP 를 네 번 처리하고 History 도 네 단계가 된다.

`basic` · `detail` 같은 묶음 Tool 도 두지 않는다. 둘을 이어 부르면 **똑같이 두 번
구워진다.** 도구가 그 실수를 못 하게 막는 편이 낫다.

## 실기에서 잡은 함정 넷

**정수는 조용히 무시된다.** `$Ex12` 는 실수여야 한다.

```text
$Ex12 = 2          정수 →  54.54 → 54.54    무동작 (ok:true 를 돌려준다)
$Ex12 = 2.000001   실수 →  54.54 → 145.02   적용
$Ex12 = 1          정수 → 145.02 → 145.02   무동작
$Ex12 = 1.0001     실수 → 145.02 → 197.42   적용
```

JSON 으로 나갈 때 `1.0` 이 `1` 이 되는 순간 사라진다. 빌더가 정수면 0.0001 만큼
밀어 실수로 만든다 — 노출의 표시 정밀도는 0.01 이라 보이지 않는다.
실기에서 `exposure: 1` 을 주고 평균이 52.26 → 87.23 으로 오르는 것을 확인했다.

**`saturation` 만 `$` 가 없다.** 규칙성을 가정하면 이 하나가 조용히 빠진다.

**`temperature` 는 켈빈이 아니다.** 실측값이 −12 였다. 필터는 RAW 가 아니라 픽셀에
걸리므로 −100 ~ +100 상대값이다. 켈빈은 RAW 를 열 때만 쓴다.

**버전 키는 필요 없다.** `$CrVe`·`$PrVN`·`$PrVe` 를 빼고도 동작한다(117 → 196.86).
박아 넣으면 다른 Camera Raw 버전에서 깨진다.

## 숨긴 레이어

Photoshop 은 "«Camera Raw 필터» 명령은 현재 사용할 수 없습니다" 라고만 답한다.
이유를 알 수 없는 메시지라 실기에서 한참 헤맸다. 미리 막고 무엇을 하라고 말한다.

## 노이즈 감소 — 원래 이 주제로 시작했다

`denoise`(Photoshop 노이즈 감소 필터)는 고운 센서 그레인에 거의 듣지 않는다.

```text
Reduce Noise (amount 6)        σ 12.497 → 12.065    3.5%
Reduce Noise (최대 강도)        → 11.608             7%
Surface Blur (r5 t12)          11.608 → 5.571      52%   별 보존
Camera Raw ($LNR 25 $CNR 32)   6.722 → 3.418       49%   별·성운 색 보존
사람이 대화상자로 (NR 36)        6.722 → 2.920       57%
```

Camera Raw 만 **색을 건드리지 않았다** — 평균 R/G/B 가 소수점 둘째 자리까지 같았고
`denoise colorNoise:100` 이 지워 버렸던 분홍 성운 색도 남았다.

## `openDialog` — 열리기는 한다. 쓸 수는 없다

**앞서 "안 열린다" 고 한 것은 틀렸다.** `dialogOptions` 를 옵션 객체에 넣어 시험한
탓이다. Adobe 문서대로 **descriptor 안의 `_options`** 에 주면 열린다.

```text
{_obj: "Adobe Camera Raw Filter", _options: {dialogOptions: "display"}}
  → Camera Raw 18.6 대화상자가 뜬다
  → Bridge 가 정확히 15007ms 에 COMMAND_TIMEOUT
```

그래도 쓸 수 없다. 대화상자가 열려 있는 동안 플러그인이 멈춰 **성공한 일을 실패로
보고**하고, 그 사이 Bridge 연결도 끊긴다. Job 시스템(§14)과 함께 다룰 일이다.

연결이 끊기는 것 자체는 회복된다 — 플러그인이 지수 백오프로 재접속하며 실기에서
**2초** 만에 붙었다. (매번 새 서버 프로세스를 띄우는 탓도 있다)

## `window.capture` 가 대화상자를 못 봤다 — 고쳤다

§17.11 이 "멈췄을 때 왜 멈췄는지 본다" 를 존재 이유로 들었는데 **바로 그 경우를
놓치고 있었다.** `PrintWindow` 를 **메인 창 핸들 하나**에만 걸었기 때문이다.
Camera Raw 처럼 별도 최상위 창으로 뜨는 대화상자는 거기 들어오지 않는다.

```text
460952    _DSC0601.NEF @ 25% ...     메인 창
2436682   Camera Raw 18.6            ← 놓치고 있던 것
```

`EnumWindows` 로 **같은 프로세스의 보이는 최상위 창을 모두** 찍도록 고쳤다.
**대화상자를 먼저** 놓는다 — 막힌 원인이 먼저 보여야 한다.

결과가 한 장이 아니라 **여러 장**이 된다. MCP 서버가 창마다 image 블록과 크기·제목
텍스트를 내보낸다(`isCapturedImageList`).

실기 검증 — Camera Raw 를 띄워 두고 찍었다.

```text
1500x765   window:dialog:Camera Raw 18.6                      ← 먼저
1500x815   window:main:_DSC0601.NEF @ 25% (레이어 1, RGB/16*) *
```

### 창 제목이 첫 글자에서 잘렸다

고치는 중에 나온 것이다. `GetWindowTextW` 를 **`CharSet.Unicode` 없이** 선언해
UTF-16 문자열을 ANSI 로 마샬링했다. 첫 바이트 뒤의 널에서 끊긴다.

```text
이전   window:main:_
이후   window:main:_DSC0601.NEF @ 25% (레이어 1, RGB/16*) *
```

제목이 온전해야 **어떤 대화상자인지** 알 수 있으므로 이것이 중요하다.

메인 창만 찍어도 **뭔가 modal 이 떠 있다**는 것은 보인다 — 속성 패널 입력란이
비활성으로 나온다. 다만 무엇인지는 알 수 없다.

## 미확인으로 남긴 키

`$GLWA`·`$GLWR`·`$GLWW`·`$GLWS`·`$GLST`, `$TMMs`, `$PGTM`, `RGBSetupClass`.
이름을 짐작하지 않는다.

---

# 17.18 레이어 삭제 — 세 번 아쉬운 뒤에 만들었다

- [x] `photoshop.layer.delete`

CORE_API §8 이 처음부터 `DESTRUCTIVE` 로 분류해 두고 구현은 미뤄 둔 것이다.
**분류가 먼저 서 있어서 만들 때 정할 것이 없었다** — 그것이 §8 을 둔 이유다.

## 왜 이제야

실기에서 세 번 막혔다. `03_Sky_Blue_Trim`(불필요해진 보정 레이어), `ZZ_denoise_test`,
그리고 Camera Raw 시험 레이어들. 지우지 못해 숨기기만 했고, 문서에 **16장**이
쌓였다. History 가 바닥나면 되돌리기로도 못 없앤다.

## **id 를 명시한다. 패턴을 받지 않는다**

`workspace.delete` 와 같은 규칙이다. 별표 한 줄이 사용자의 작업을 지울 수 있다.
고르는 일은 호출자가 `layer.list` 로 하고, 이 Command 는 지목된 것만 지운다.

## 지웠다고 말하기 전에 확인한다

`delete()` 가 던지지 않았다고 사라진 것은 아니다. 지운 뒤 **목록을 다시 읽어**
정말 없는 id 만 `deleted` 에 담는다. 오류 없이 남아 있으면 그 사실을 `failed` 에
적는다. (`opacityApplied` · `mutate()` 와 같은 원칙)

## 문서를 비우지 않는다

Photoshop 은 레이어가 없는 문서를 허용하지 않는다. 전부 지우라는 요청이 오면
마지막 하나에서 알 수 없는 메시지로 실패한다. 미리 막고 이유를 말한다.

## 실기 검증

```text
지우기 전  16장
대상       11장 (ZZ_* 9장 + 배경 복사 2장)
결과       지움 11 · 실패 0 · 남음 5
지운 뒤     5장 — 보정 레이어 셋과 배경은 그대로
```

---

# 17.19 회전 — 자르기로는 풀리지 않는 것

- [x] `photoshop.document.rotate`

## 재 놓고 고치지 못했다

갯벌 은하수 원본(`_DSC0056.NEF`, 6000×4000 16비트)에서 수평선을 쟀다. 왼쪽의
깨끗한 물 경계 두 구간을 **독립적으로** Theil-Sen 으로 재서

```text
x 0–900       −1.817°   잔차 IQR 3.85px
x 1300–2400   −2.090°   잔차 IQR 12.77px (섬 오염)
```

첫 구간의 직선을 x=2400 까지 외삽하면 y=3101.6, 둘째 구간 실측은 y=3099.2 —
**2400px 기선에서 2.4px 차이**다. 두 독립 측정이 일치하므로 진짜 기울기다.

그런데 **고칠 Tool 이 없었다.** `document.crop`(§17.12)은 사각형을 덜어낼 뿐
기울기는 손대지 못한다. 구도 도구가 생겼다고 구도 문제가 다 풀리지 않는다고
§17.12 에 적어 두었는데, 그 말이 여기서 다시 맞았다.

## 자르기와 나눈다

회전하면 캔버스가 커지고 모서리에 빈 영역이 생긴다. 한 Tool 로 합치지 않았다 —
자르기는 `crop` 이 이미 하고, 합치면 **"회전만 하고 구도는 직접 잡는다"** 를
할 수 없게 된다.

대신 `safeBounds` 를 결과에 담는다. 빈 영역이 **한 픽셀도** 들어오지 않는 최대
직사각형이고 원본 종횡비를 유지한다. `crop` 의 `bounds` 에 그대로 넘어간다.

계산은 **서버가 한다.** Plugin 은 실행 Agent 다(CLAUDE.md 의존 방향 §6). 그리고
호출자가 삼각함수를 맞게 쓰기를 기대하지 않는다.

중심 정렬·축평행·종횡비 `r` 고정일 때 반폭 `a` 는

```text
a ≤ (W/2) / (c + s/r)      a ≤ (H/2) / (s + c/r)      c = |cosθ|, s = |sinθ|
```

둘 중 작은 쪽이다. 볼록도형이라 꼭짓점 넷만 보면 된다. 반올림은 **안쪽으로**
한다 — 바깥으로 반올림하면 빈 픽셀이 한 줄 들어오고, 한 줄이라도 들어오면 이
함수가 약속한 것이 거짓이 된다. 테스트가 네 꼭짓점을 회전 사각형에 직접 대본다.

## `angle` 을 −45 ~ 45 로 좁힌 이유가 둘이다

하나는 범위다. 이것은 수평 교정 도구이지 세로/가로를 바꾸는 도구가 아니다.
90° 회전이 필요하면 그때 만든다.

다른 하나가 더 중요하다. **이 범위에서는 회전이 캔버스를 반드시 키운다.** 그래서
플러그인이 회전 뒤 크기를 기대값과 대조해 "정말 돌았는가" 를 확인할 수 있다.
180° 를 허용하면 크기가 그대로라 그 확인이 성립하지 않는다.

오류 없이 아무 일도 하지 않는 경로는 이 프로젝트에서 이미 두 번 나왔다 —
배경 레이어 `set_opacity`(§17.6)와 Camera Raw 의 정수 `$Ex12`(§17.17). 성공으로
보고하면 호출자는 수평이 맞춰졌다고 믿는다.

## DOM 에 `rotate` 가 있는지 짐작하지 않았다 — 그리고 있었다

`photoshop.d.ts` 의 `PhotoshopDocument` 에 `rotate` 선언이 없었다. 없다는 뜻은
아니다 — 우리가 필요했던 적이 없어 안 적은 것뿐이다.

§17.13 에서 `document.histogram` 을 짐작으로 골랐으면 없는 API 를 썼을 것이다.
같은 방식으로 DOM 과 batchPlay 두 경로를 준비하고 `method` 를 돌려받게 해서
**실기에서 쟀다.** 답은 `dom:Document.rotate` 였다.

그래서 **batchPlay 경로를 지웠다.** 그쪽 `_obj` 는 내 기억에서 나온 것이고 한 번도
실행되지 않았다 — 짐작으로 남겨 두면 그 경로가 처음 실행되는 날 그것이 맞는지
아무도 모른다. 대신 `rotate` 가 없는 환경을 만나면 우회하지 않고 **그 사실을
말하며 실패한다.**

`method` 는 남겼다. 무엇으로 했는지는 우리가 아는 사실이고 경로가 늘면 호출자가
구분해야 한다. (`crop` 의 `pixelsRetained` 와 같은 판단)

타입 선언에는 반환을 `Promise<void> | void` 로 적었다. 동작은 확인했지만 Promise
인지까지는 확인하지 않았다 — 확인한 것과 확인하지 않은 것을 구분해 적는다.

## `EDIT` 이다

회전은 모든 레이어의 픽셀을 **재보간한다.** `delete: false` 인 자르기와 달리
원래 값이 그대로 남지 않는다는 점에서 더 무겁다.

그래도 `EDIT` 으로 둔다. History 로 되돌아가고, 필터·결함 제거도 픽셀을 다시
쓰면서 `EDIT` 이다. §17.12 가 자르기를 두고 한 판단과 같다 — `DESTRUCTIVE` 로
올리면 기본 허용(`read` · `edit`) 밖이라 **기본 설정에서 수평 교정이 막힌다.**

다만 재보간은 반복하면 쌓인다. 각도를 나눠 여러 번 부르지 않는다.

## Mock 도 캔버스를 키운다

크기를 그대로 두면 플러그인의 "정말 돌았는가" 검증도 `safeBounds` 계산도
테스트에 영원히 나오지 않는다. 배경 승격·자르기 undo 때와 같은 교훈이다.

## 실기 검증

Photoshop 27.8, `_DSC0056.NEF` 6000×4000 16비트.

```text
회전 1.873°    6000×4000 → 6128×4194    method: dom:Document.rotate
               기대 6127.5×4194.0 과 일치 (플러그인의 크기 대조 통과)

수평선 재측정   −1.817° → −0.259°
               남은 값은 잔차 중앙 3.41px 과 같은 크기 — 측정 잡음 안이다.
               더 돌리지 않았다. 재보간만 한 번 더 쌓인다.

safeBounds     { 203, 190, 5925, 4004 }
crop           6128×4194 → 5722×3814    종횡비 1.5001, 빈 모서리 0

angle 0        INVALID_PARAMETER "angle 이 0 이면 회전할 것이 없습니다"
angle 90       INVALID_PARAMETER "Number must be less than or equal to 45"
history.undo   5740×3840 → 5722×3814    정확히 복원
```

**되돌리기가 실기에서 확인됐다.** 이것이 `EDIT` 분류의 근거다 — §17.12 가
자르기에서 같은 것을 확인한 것과 같다.

부호도 실기로 확인했다. **시계 방향 양수**가 맞다. 짐작하지 않고 한 번 걸어
다시 쟀다 — 반대였다면 기울기가 −1.82° 에서 −3.7° 로 커졌을 것이다.

---

# 17.20 그룹이 어디에 생기는지 — 조용히 중첩됐다

- [x] `photoshop.group.create` 의 `parentId`

## 무슨 일이 있었나

은하수 사진 보정에서 마스크를 곱하려고 그룹을 여러 개 만들었다. 각 단계마다
**직전 그룹을 선택한 뒤** 새 그룹을 만들었는데, 결과가 이랬다.

```text
06_색_광해
  └ 08_수평선_주황        ← 06 안에 들어감
      └ 09_좌측_R복원      ← 08 안에
          └ 10_채도        ← 09 안에. 세 겹 마스크에 갇힘
```

의도는 넷 다 최상위였다. **오류는 하나도 없었다.** 08 과 09 는 마스크가 좌측에서
100% 라 우연히 의도대로 동작했고, 마지막 채도만 아무 데도 안 걸렸다 — 그것도
적용 전후 수치가 **완전히 동일한 것**을 보고서야 알았다.

## 원인

`createLayerGroup` 은 **활성 레이어가 있는 곳**에 만든다. 활성 레이어가 어느 그룹
안이면 새 그룹도 그 안에 들어간다. Photoshop UI 에서는 자연스러운 동작이다 —
사람은 레이어 패널을 보고 있으니까.

**호출자가 화면을 못 보면 이야기가 다르다.** "지금 활성 레이어가 어디 있는지" 를
추적해야 결과를 예측할 수 있는 API 는 조용히 틀린다.

## Mock 이 현실과 달라서 안 잡혔다

Mock 은 그룹을 **항상 `parentId: null`** 로 만들었다. 실기에서만 중첩이 일어났다.
이 프로젝트에서 같은 교훈이 네 번째다 — 배경 승격(§17.6), 자르기 undo(§17.12),
회전 캔버스(§17.19), 그리고 이것.

## 고친 방향

`parentId` 를 더했다. 생략하거나 `null` 이면 **최상위**다.

기본을 바꾼 것이 핵심이다. 옵션만 더하고 기본을 그대로 뒀으면 같은 함정이
남는다 — 새로 추가한 것이 조용히 관대한 값을 갖지 않게 하는 §22 의 판단과 같다.

`layerIds` 와 함께 쓰면 거절한다. 레이어를 묶으면 그 레이어들이 있던 자리에
그룹이 생기는 것이 맞고, 위치를 따로 주면 둘이 충돌한다.

## 만든 자리를 확인한다

플러그인은 만든 **뒤에 위치를 읽어** 요청과 다르면 옮기고, 옮긴 결과를 다시
읽어 확인한다. `move` 가 던지지 않았다고 옮겨진 것은 아니다. 확인하지 못하면
"그룹은 만들어졌지만 요청한 자리로 옮기지 못했다" 고 말한다 —
`layer.delete` · `opacityApplied` 와 같은 원칙이다.

## 남은 것

**조정 레이어도 같은 방식으로 생긴다.** `adjustment.*` 는 활성 레이어 위에 쌓이는
것이 오히려 자연스러워(스택을 쌓는 일이다) 이번에는 손대지 않았다. 실기에서
연쇄의 **시작점은 `group.create`** 였고 거기를 막으면 연쇄가 끊긴다.

다만 그룹을 선택한 채 조정 레이어를 만들면 여전히 그 안에 들어간다. 위치가
중요하면 결과의 `parentId` 를 읽고 `group.move_layer` 로 옮긴다.

## 실기에서 두 번째 버그를 잡았다

고친 것을 실기로 확인하다가 **오류를 돌려주면서 그룹은 만들어져 있는 것**을 봤다.
없는 `parentId` 를 준 호출이 `LAYER_NOT_FOUND` 로 끝났는데 레이어 목록에는
`TEST_D` 가 남아 있었다 — 검증이 `createLayerGroup` **뒤에** 있었기 때문이다.

"안 했다고 말하고 뭔가를 하는 것이 가장 나쁜 실패다"(§17.6). 검증을 생성 앞으로
옮겼다.

**Mock 은 이 경로를 놓쳤다.** Mock 은 처음부터 부모를 먼저 확인하게 짜서 계약을
만족했고, 실기 구현만 순서가 달랐다. Mock 이 현실보다 **엄격해도** 검증에 구멍이
생긴다 — 지금까지는 Mock 이 관대해서 놓친 경우만 겪었다.

테스트에 "거절하면 그룹이 남지 않는다" 를 넣어 계약을 고정했다.

## 실기 검증

Photoshop 27.8, 레이어 20장 문서.

```text
A  group.create { name }                      parentId null      최상위
B  layer.select(A) → group.create { name }     parentId null      고치기 전엔 A 안
C  group.create { parentId: A }                parentId 51        명시한 자리
D  group.create { parentId: 99999 }            LAYER_NOT_FOUND    (고치기 전) 그룹은 남음
E  group.create { parentId: 88888 }            LAYER_NOT_FOUND    그룹 남지 않음
```

B 가 이 변경의 핵심이다. 고치기 전 같은 호출이 A 안에 그룹을 만들었고, 그것이
실기 보정에서 네 겹 중첩을 일으킨 연쇄의 시작이었다.

---

# 17.21 기울기 측정 — rotate 의 입력을 저장소 안에서 만든다

- [x] `photoshop.measure.tilt`

## 만들어 놓고 쓸 수 없었다

§17.19 에서 `document.rotate` 를 만들었는데 **그 입력을 만들 방법이 저장소 안에
없었다.** 수평선 기울기를 잴 때마다 캡처를 밖으로 내보내 PowerShell 로
Theil-Sen 을 새로 짰다. 세 번 반복했고 한 번은 `$H` 와 `$h` 가 PowerShell 의
대소문자 무시 때문에 충돌해 900열 중 1열만 측정됐다.

같은 판단을 매번 즉흥적으로 재구현하면 재현성이 없다.

## **각도만 돌려주지 않는다**

실기에서 세 번 쟀고 **두 번은 돌리지 않는 것이 답이었다.**

```text
논둑    −1.816°   잔차 IQR 24.6px   직선이 아니었다
종탑     8.366°   잔차 IQR 13.5px   직선이 아니었다
갯벌    −1.873°   잔차 IQR  3.9px   직선이었다 — 교정함
```

세 번 다 그럴듯한 각도가 나왔다. 가른 것은 각도가 아니라 **잔차**다. 각도만
돌려주는 Tool 은 멀쩡한 사진을 돌리게 만든다.

## Theil-Sen 인 이유

최소제곱은 이상치 하나에 끌려간다. 수평선을 재는 자리에는 섬·배·전봇대가 섞이고
그것들은 경계를 수십 픽셀씩 밀어 올린다. Theil-Sen 은 모든 쌍의 기울기 중앙값이라
표본의 절반이 오염될 때까지 버틴다.

경계는 **서브픽셀로** 집는다. 정수로 반올림하면 작은 각도가 픽셀 격자에 갇힌다.

## `reliable` 은 담지 않는다

임계가 영역 크기에 따라 달라진다 — 900px 폭에서 잔차 4px 와 5000px 폭에서 4px 는
다른 이야기다. 대신 `spanPixels` · `risePixels` 를 함께 주어 잔차를 **경계가 실제로
오르내린 높이와 견주어** 읽게 한다. 임계를 짐작해 박는 것보다 근거를 함께 주는
편이 낫다.

## 경계가 없으면 각도를 말하지 않는다

표본이 20개 미만이면 실패한다. 두세 점으로 낸 각도를 돌려주면 호출자는 그것이
측정이라고 믿는다. 실패 메시지에 **찾은 줄 수와 `minContrast`** 를 담아 무엇을
고쳐야 하는지 말한다 — 실기에서 이 메시지가 바로 원인을 짚었다.

## 보정이 쌓이면 합성에서 못 잰다

실기에서 겪었다. 톤을 올리고 광해를 뺀 문서의 수평선은 대비가 13 밖에 안 남아
1000열 중 83열만 경계를 찾았고, 그 83열이 걸친 폭이 177px 이라 **잔차(2.96)가
경계 높이(2.11)보다 컸다.** 믿을 수 없는 측정이고, Tool 이 그 사실을 그대로
드러냈다.

`layerId` 로 원본 레이어를 지정하면 1000열 전부 잡힌다. `document.statistics` 와
같은 규칙으로 조정 레이어와 그룹은 거절한다.

## Mock 은 각도를 지어내지 않는다

Mock 은 픽셀을 모른다. 그럴듯한 값을 돌려주면 Mock 으로 돌린 워크플로가 엉뚱한
회전을 하고 **그것이 성공으로 보인다.** 잴 수 없으면 잴 수 없다고 말한다.

## 실기 검증

Photoshop 27.8, `_DSC0056_edit.psd` 5722×3814 16비트.

**알려진 각도를 되찾는지** 본 것이 핵심이다.

```text
회전 전          −0.504°   잔차 IQR 6.59   1000/1000 열
document.rotate(+1°)
회전 후          +0.530°   잔차 IQR 6.56   1000/1000 열
차이              1.034°   (기대 1.000°, 오차 0.034°)
history.undo     5722×3814 복원
```

부호 규약도 확인했다 — `rotate` 에 양수를 주면 측정값이 양수 쪽으로 움직인다.

오염된 구간도 재현했다. x 1300–2400 은 섬이 섞이는 자리인데 각도 −3.106° 에
잔차 IQR 22.65 가 나왔다. PowerShell 로 쟀을 때의 판정(IQR 12.77, 오염)과 같은
결론이다 — **돌리지 않는 것이 답이다.**

```text
없는 레이어          LAYER_NOT_FOUND
조정 레이어          "조정 레이어에는 잴 픽셀이 없습니다"
대비 부족            "경계를 찾은 줄이 0개뿐입니다(전체 1000) … minContrast 가 높습니다"
```

---

# 17.22 방사형 마스크 — 선형으로는 모서리가 남는다

- [x] `photoshop.mask.gradient` 의 `type: "radial"`

## 왜 필요했나

빛 공해는 광원에서 **2차원으로** 감쇠한다. 선형 그라디언트 하나로는 구조적으로
맞출 수 없다.

은하수 사진 보정에서 가로 마스크와 세로 마스크를 차례로 걸었더니 중간 행은
±1레벨로 맞았는데 **모서리가 ±8 남았다.** 원본에서 세로 변화폭이 왼쪽 28.4,
오른쪽 6.2 로 달랐기 때문이다 — 곱셈 성분이다.

그룹 마스크와 레이어 마스크를 곱해 우회했지만(§17.20 의 중첩 사고도 여기서
나왔다) 조정 레이어가 넷 더 들었다. 방사형은 같은 일을 하나로 한다.

## `from` 의 뜻이 타입마다 다르다

`linear` 에서는 시작점, `radial` 에서는 **중심**이다. `to` 는 `radial` 에서
방향이 무시되고 거리만 반지름으로 쓰인다.

이것이 이 변경에서 가장 헷갈리는 자리라 스키마 주석·Tool 설명·CORE_API 세 곳에
모두 적었다. 길이 0 검증의 오류 메시지도 타입에 따라 다르게 했다 — 같은 제약이지만
호출자가 고칠 곳이 다르다. `linear` 는 방향을, `radial` 은 크기를 잘못 준 것이다.

`radial` 은 대개 `reverse` 가 필요하다. 기본은 중심이 검은색인데 광원 쪽을
강하게 주려면 중심이 흰색이어야 한다.

## 모르는 값은 거절한다

`angle` · `reflected` · `diamond` 는 넣지 않았다. 쓸 자리를 아직 만나지 못했다.

조용히 `linear` 로 떨어뜨리지 않는다 — 그러면 호출자는 방사형이 걸린 줄 안다.

## 완벽한 모델은 아니다

Photoshop 의 방사형은 중심에서 반지름까지 **선형 보간**이다. 실제 대기 산란은
그렇지 않다. 그래도 선형 그라디언트보다는 가깝고, 무엇보다 한 축이 아니라
두 축을 동시에 다룬다.

## 실기 검증

Photoshop 27.8, 5722×3814. 곡선 −20 짜리 조정 레이어에 중심 (2861, 1857),
반지름 1200 의 방사형 마스크(`reverse`)를 걸고 거리별로 쟀다.

```text
                     전      후     차이    최대 대비
거리    0  중심    34.86  18.94  −15.92     100%
거리  600  위      31.05  23.17   −7.88    49.5%
거리 1200  위      32.60  32.31   −0.29     1.8%
거리 1200  좌      36.08  35.76   −0.32     2.0%
거리 1200  우      34.06  33.75   −0.31     1.9%
거리 3140  모서리  41.16  41.16    0.00       0%
```

**세 방향의 감쇠가 같다는 것이 방사형의 증거다.** 선형이었다면 좌우가 크게
달랐을 것이다. 중간점 49.5% 는 선형 보간이라는 설명과 맞는다.

```text
type: "angle"        거절 — Expected 'linear' | 'radial'
반지름 0             거절 — "반지름이 0 입니다"
```

---

# 17.23 레이어 순서 변경 — §17.9 가 남겨 둔 자리

- [x] `photoshop.layer.reorder`

## 왜 이제야

§17.9 가 "아직 없다, 우선순위가 가장 높은 후보" 라고 적어 둔 것이다. 그동안은
**만들 때 순서를 맞추면 됐다.** 조정 레이어는 활성 레이어 위에 쌓이므로 순서대로
만들면 순서대로 놓인다.

실기 보정에서 처음으로 **이미 만든 것을 옮겨야** 했다. 채도 레이어가 그룹 세 겹
안에 갇혀 아무 데도 걸리지 않은 것을 꺼내야 했는데(§17.20), 그때
`group.move_layer` 에 `groupId: null` 을 줘서 우회했다. 그것은 "그룹에서 꺼낸다"
는 뜻의 API 이고 꺼낸 뒤 어디에 놓이는지는 부수 효과였다.

## **같은 부모 안에서만 움직인다**

`top` · `bottom` · `up` · `down` 은 형제들 사이의 순서만 바꾼다.

Photoshop UI 는 그룹 끝에서 한 번 더 누르면 밖으로 나간다. 그 동작을 흉내내지
않았다 — 호출자가 "지금 그룹의 몇 번째인지" 를 알아야 결과를 예측할 수 있게 되고,
그것이 바로 §17.20 에서 겪은 종류의 조용한 놀라움이다.

`above` · `below` 는 기준 레이어 옆으로 가므로 부모가 바뀔 수 있다. 그것은
의도된 동작이고 결과의 `parentId` 에 드러난다.

## 이미 그 자리면 실패가 아니다

맨 위 레이어에 `up` 을 주는 것은 오류가 아니다. 오류로 두면 호출자가 매번 현재
위치를 확인해야 한다.

대신 `moved` 로 **무슨 일이 있었는지 말한다.** 조용히 성공을 돌려주면 호출자는
움직였다고 믿는다 — `opacityApplied` · `layer.delete` 와 같은 원칙이다.

`index` 와 `siblings` 도 요청이 아니라 옮긴 뒤 실제로 읽은 값이다.

## 형제 목록을 따로 센다

`flattenLayers` 는 깊이 우선 평탄화라 그 배열의 인덱스는 "몇 번째 형제인가" 가
아니다. 같은 `parentId` 를 가진 것만 걸러야 한다. 그룹이 섞인 문서에서 이 둘은
크게 어긋난다 — 이번 실기 문서에서 `06_색_곡선` 은 전체 목록의 9번째지만 형제
중에서는 4번째였다.

## Mock 도 배열을 실제로 다시 늘어놓는다

결과만 흉내내면 `index` 가 맞는지 검증되지 않는데, 이 Command 가 약속하는 것이
바로 그 값이다. 배경 레이어가 움직이지 않는 것도 같게 뒀다.

## 실기 검증

Photoshop 27.8, 조정 레이어 20장짜리 문서.

```text
① 맨 위에서 up        moved false   index 0 → 0      siblings 5
② 한 칸 아래로        moved true    index 0 → 1      siblings 5
③ 그룹 안에서 top     moved true    index 3 → 0      siblings 4   parentId 35 유지
④ above (그룹 밖 기준) moved true    index 3 → 0      siblings 6   parentId 35 → null
⑤ 없는 레이어         LAYER_NOT_FOUND
⑥ top 에 referenceId  INVALID_PARAMETER "top 에는 referenceId 를 쓰지 않습니다"
```

③ 이 핵심이다. 그룹 안 레이어를 맨 위로 올렸는데 **그룹을 벗어나지 않았고**,
`siblings` 가 전체 20장이 아니라 형제 4장으로 나왔다.

④ 는 반대로 부모가 바뀌는 경우이고, 결과가 그 사실을 드러냈다.

`history.undo` 로 원래 순서가 복원되는 것도 확인했다.

---

# 17.24 조정 레이어의 종류 — 이름으로 짐작하고 있었다

- [x] `LayerInfo.adjustmentType`

## 무엇이 없었나

`layer.list` 는 "조정 레이어다" 까지만 말했다. **무슨 조정인지는 말하지 않았다.**

만드는 쪽은 문제가 없다 — 호출자가 무엇을 만들었는지 안다. 문제는 **저장한 PSD 를
다시 열었을 때**다. 그때는 이름밖에 단서가 없다.

## 실기가 바로 증명했다

구현하고 이번 보정 문서를 읽어 보니 이렇게 나왔다.

```text
49 09_곡선      adjustment   colorBalance
46 08_곡선      adjustment   colorBalance
38 06b_R복원    adjustment   colorBalance
37 06_색_곡선    adjustment   colorBalance
43 07_스트레치    adjustment   curves
34 05_곡선      adjustment   curves
50 10_채도      adjustment   vibrance
```

**"곡선" 이라는 이름이 붙은 넷 중 셋이 Color Balance 였다.** 보정하면서 내가 붙인
이름이고, 이름만 보면 Curves 로 읽힌다. 다시 열어 손보려던 사람은 `adjustment.curves`
를 부르려 했을 것이다.

## 짐작한 이름을 사실처럼 말하지 않는다

Photoshop 은 조정 내용을 descriptor 클래스 이름으로 준다. 그 이름이 UI 이름과
늘 같지는 않다 — `brightnessEvent` 가 밝기/대비다.

그래서 **아는 것만 옮기고 모르는 것은 `null` 로 두며 원본을 `rawAdjustmentType`
에 담는다.** `rawBitDepth` · `rawKind` · `rawBlendMode` 로 이미 세 번 실제 버그를
잡은 규칙이다. 매핑이 틀려도 한 번 돌려 보면 진짜 이름이 드러난다.

매핑에 성공하면 `raw` 를 담지 않는다. 둘 다 있으면 어느 쪽을 믿어야 할지 모호해진다.

## 조정 레이어에만 묻는다

`adjustment` 속성을 픽셀 레이어에 물으면 Photoshop 이 오류를 내고, 그러면
batchPlay 한 묶음이 통째로 실패해 **마스크 상태까지 잃는다.** 호출부가 걸러서
넘긴다.

읽지 못하면 필드를 넣지 않는다 — `hasMask` 와 같은 규칙이다. 부가 정보 하나
때문에 `layer.list` 가 통째로 실패하면 손해가 더 크다.

## 실기 검증

Photoshop 27.8.

```text
curves              ✓
levels              ✓
brightnessEvent     ✓  → brightnessContrast (UI 이름과 다르다)
colorBalance        ✓
hueSaturation       ✓
vibrance            ✓
```

Core 가 만들 수 있는 여섯 가지가 모두 맞았다. 나머지 열 가지(exposure ·
blackAndWhite · photoFilter · channelMixer · colorLookup · invert · posterize ·
threshold · gradientMap · selectiveColor)는 만드는 Tool 이 없어 확인하지 못했다.
틀리면 `rawAdjustmentType` 에 드러난다.

## 다음

이것이 `adjustment.update` 의 전제조건이다. 종류를 모르면 무엇을 바꿔야 할지도
정할 수 없다.

다만 **강도 조절은 `layer.set_opacity` 로 이미 된다.** −12 곡선을 67% 로 두면
−8 이다. 이번 보정에서 그것을 쓰지 않고 지웠다 다시 만든 것은 도구가 없어서가
아니라 쓸 줄 몰라서였다 — §17.16 의 `luminosity` 와 같은 종류의 착오다.

---

# 17.25 평탄화와 닫기 — 분류만 서 있던 마지막 둘

- [x] `photoshop.document.flatten`
- [x] `photoshop.document.close`

CORE_API §5.1 이 처음부터 둘 다 `DESTRUCTIVE` 로 분류해 두고 구현은 미뤄 둔
것이다. `layer.delete`(§17.18)와 함께 셋이었고 이것으로 다 채웠다.

**분류가 먼저 서 있어서 만들 때 정할 것이 없었다.**

## 평탄화 — 숨긴 레이어가 사라진다

합쳐지는 것이 아니라 **버려진다.** 호출자가 가장 놀랄 일이라 결과에
`hiddenDiscarded` 로 담는다. 0 이 아니면 의도한 것인지 확인할 거리가 있다.

`previousLayers` 도 담는다. 20장이 1장이 된 것과 2장이 1장이 된 것은 다른 일이다.

합친 뒤 레이어가 정말 하나인지 **읽어서 확인한다.** 하나가 아니면 실패로 보고한다.

보통은 평탄화하지 않고 `document.export` 를 쓴다 — 사본을 만들 뿐 원본을 건드리지
않는다. 평탄화가 필요한 경우는 그 상태로 저장해야 할 때다.

## 닫기 — 대화상자가 뜨면 멈춘다

`close()` 에 인자를 주지 않으면 Photoshop 이 저장 여부를 **묻는 창**을 띄운다.
그러면 플러그인이 멈추고 Bridge 가 타임아웃한다. §17.11 이 `window.capture` 를
만든 이유가 정확히 그 상황이었다.

그래서 언제나 `SaveOptions.DONOTSAVECHANGES` 를 명시해 부른다. **상수를 얻지
못하면 인자 없이 부르지 않고 실패한다** — 되는지 시험해 보는 대가가 "사람이
Photoshop 에서 창을 닫아 줄 때까지 서버가 멈춤" 이다.

`discardChanges: true` 를 **리터럴로** 요구한다. 기본값을 두지 않은 것은 이것이
작업을 잃는 선택이기 때문이다. 저장하고 닫으려면 `document.save` 를 먼저 부른다 —
한 Tool 이 두 일을 하지 않는다.

`remainingDocuments` 를 담는다. 0 이면 이후 Command 가 전부 `DOCUMENT_NOT_FOUND`
로 실패하므로 호출자가 미리 알아야 한다.

닫혔는지 **읽어서 확인한다.** `app.documents` 는 배열이 아니라 배열 유사
컬렉션이라 `toArray` 를 거친다.

## Mock 도 숨긴 레이어를 버린다

합쳐진다고 두면 그 손실이 테스트에 나오지 않는데, 이 Command 에서 호출자가 가장
놀랄 일이 그것이다.

Mock 은 문서를 하나만 다루므로 닫으면 `remainingDocuments` 가 언제나 0 이다.
실제 Photoshop 은 여러 문서를 열 수 있고 그때는 다르다 — Mock 의 한계로 적어 둔다.

## 실기 검증

Photoshop 27.8, `_DSC0056_edit.psd` 20장짜리 보정 문서.

```text
① discardChanges 없음    거절 — Invalid literal value, expected true
② discardChanges: false  거절 — 같은 메시지
③ flatten                20장 → "배경" 1장, hiddenDiscarded 0
   history.undo          20장 전부 복원
④ close                  closed { 511, _DSC0056_edit.psd }, remainingDocuments 0
⑤ 닫은 뒤 document.get   DOCUMENT_NOT_FOUND "열려 있는 문서가 없습니다"
```

**④ 에서 대화상자가 뜨지 않았다.** 이것이 이 Command 에서 확인해야 할 유일한
위험이었고, 실제로 닫아 보기 전에는 알 수 없는 것이었다.

---

# 17.26 문서 열기 — 닫을 수는 있는데 열 수는 없었다

- [x] `photoshop.document.open`

## 왜 바로 이어서

§17.25 에서 `close` 를 만들고 실기에서 닫아 본 **직후 다시 열 방법이 없었다.**
사람이 Photoshop 에서 직접 열어 주어야 했다.

닫을 수는 있는데 열 수는 없는 것은 반쪽이다.

## 승인된 폴더 안으로 가둔다

저장과 같은 규칙이다(§8.5). 호출자는 폴더를 고를 수 없고 **파일 이름만** 준다.
경로 구분자와 `..` 는 `FilenameSchema` 가 이미 거부한다.

**읽기라고 느슨하게 두지 않았다.** 임의 경로를 열 수 있으면 사용자의 어느
파일이든 Photoshop 으로 가져와 `document.capture` 로 내용을 볼 수 있다. 쓰기보다
덜 위험한 것이 아니다.

## **RAW 는 거절한다**

NEF · CR2 · ARW 를 열면 Photoshop 이 **Camera Raw 대화상자**를 띄운다. 그러면
플러그인이 멈추고 Bridge 가 타임아웃한다 — §17.25 가 `close` 에서 막은 것과 같은
위험이고, §17.11 이 `window.capture` 를 만든 이유이기도 하다.

이 세션에서 같은 함정을 세 번째로 만났다. 대화상자는 이 프로젝트에서 반복되는
실패 유형이다.

그래서 **대화상자 없이 열리는 형식만** 허용한다(psd · psb · tif · tiff · png ·
jpg · jpeg). 목록에 없으면 열어 보지 않고 거절하며 이유를 말한다.

RAW 의 현상 설정은 슬라이더를 보며 정하는 일이라 사람이 직접 여는 편이 맞다.
§6 의 "미리보기 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다" 와 같은 판단이다.

목록에 무언가 더할 때는 **실기에서 대화상자가 뜨지 않는 것을 확인한다.** 목록이
길어지는 것보다 서버가 멈추는 것이 훨씬 나쁘다.

## 확장자가 없는 것과 모르는 확장자를 구분한다

`"noextension".split(".").pop()` 은 이름 전체를 돌려준다. 그대로 쓰면 두 경우가
섞이는데, 호출자가 고쳐야 할 것이 다르다 — 하나는 확장자를 붙이는 것이고 다른
하나는 형식을 바꾸는 것이다. 테스트를 쓰다 잡았다.

## `alreadyOpen`

Photoshop 은 같은 파일을 두 번 열지 않고 **기존 창을 활성화한다.** 그것을 그냥
성공으로 돌려주면 호출자는 방금 디스크에서 읽었다고 믿는다 — 편집 중인 내용이
있으면 디스크의 것과 다르다.

열기 **전에** 문서 id 목록을 떠 두고 비교한다. `mutate()` 가 레이어에서 하는
것과 같은 방식이다.

## `Folder.getEntry` 를 짐작하지 않았다

UXP `Folder` 에 이름으로 한 항목을 집는 API 가 있는지 확인하지 못했다. 타입
선언에도 없다. `getEntries()` 로 목록을 훑는 것은 `entryExists` 가 이미 쓰는
길이라 동작이 검증돼 있어 그쪽을 골랐다.

대소문자는 무시한다 — Windows 파일 시스템이 그렇고, 여기서 엄격하게 굴면 사용자가
보고 적은 이름이 틀렸다고 나온다.

## Mock 은 문서를 지어내지 않는다

파일 시스템이 없다. 그럴듯한 문서를 돌려주면 Mock 으로 돌린 워크플로가 존재하지
않는 파일을 열었다고 믿는다. `measure.tilt`(§17.21)가 각도를 지어내지 않는 것과
같은 이유다.

## 실기 검증

Photoshop 27.8, 작업 폴더 `E:	est01`.

```text
① _DSC0056.NEF        거절 — "'nef' 은 열 수 없습니다 … 직접 열어야 합니다"
② 없는파일.psd         거절 — "작업 폴더에 … 없습니다"
③ _DSC0056_edit.psd   alreadyOpen true   openDocuments 1  (이미 열려 있었다)
④ v-52256.png         alreadyOpen false  openDocuments 2  (새로 열렸다)
```

**③ 과 ④ 가 갈리는 것이 이 Command 의 값이다.** 같은 호출이 두 가지 다른 일을
하고, 결과가 어느 쪽인지 말한다.

`app.open(entry)` 가 실제로 있다는 것도 여기서 확인했다 — 타입 선언에 없어
추가했다.

---

# 17.27 스마트 오브젝트 변환 — 체인의 3번이 비어 있었다

## 왜 만들었나

실기 보정 중 사용자가 파이프라인을 이렇게 적었다.

```text
Photoshop Select Sky
 ↓
Layer Mask
 ↓
Smart Object
 ↓
Camera Raw Filter
```

국소 보정의 표준 순서다. Tool 과 대조하니 **3번만 없었다.**

```text
Select Sky    →  photoshop.selection.sky        있음
Layer Mask    →  photoshop.mask.create          있음
Smart Object  →  ─────                          없음
Camera Raw    →  photoshop.camera_raw.apply     있음
```

가운데 한 칸 때문에 전체가 수동이었다. 같은 세션에서 사용자가 이 변환을 손으로
했고, 그 뒤 값을 고칠 때마다 대화상자를 열어야 했다.

## 왜 이 변환이 값을 갖나

`camera_raw.apply` 는 **픽셀에 굽는다.** 스마트 오브젝트로 감싸 두면 같은 호출이
**스마트 필터**로 붙어 나중에 값만 고칠 수 있다.

필터 Tool 들의 `asSmartFilter: true` 로도 변환되지만 그때는 필터가 함께 걸린다.
"변환만" 하는 길이 없었다.

## 스마트 필터 마스크는 레이어당 하나다

실기에서 확인했다. 전역 Camera Raw 가 걸린 스마트 오브젝트에 선택 영역을 주고
한 번 더 걸면, 만들어지는 필터 마스크가 **스택 전체**에 걸린다 — 맞춰 둔 전역
톤까지 그 선택 안에만 적용된다.

그래서 국소 보정은 **별도 레이어**여야 한다. 마스크를 씌운 뒤 변환하면 마스크가
변환 결과에 함께 들어가고, 그 위의 Camera Raw 는 그 레이어에만 산다.

```text
layer.duplicate / stamp_visible
 ↓
selection.*  →  mask.create
 ↓
smart_object.convert        ← 이것이 없었다
 ↓
camera_raw.apply            → 스마트 필터로 남는다
```

## id 가 바뀐다

변환하면 레이어 객체가 교체된다. 배경 승격(ARCHITECTURE §8.4)과 같은 일이다.
`resolveMutatedLayer` 로 **이번에 생긴 id** 를 찾는다 — 활성 레이어로 추정하지
않는다.

`previousId` 를 결과에 담아 호출자가 옛 id 를 이어 쓰지 않게 한다.

## 두 번 감싸지 않는다

이미 스마트 오브젝트면 아무것도 하지 않고 `converted: false` 로 답한다.
겹치면 스마트 오브젝트 안에 스마트 오브젝트가 생겨 구조가 한 겹 깊어지고
되돌리기 어렵다.

**오류로 두지 않았다.** 이미 원하는 상태이고, 오류면 호출자가 매번 먼저 확인해야
한다. `layer.reorder` 의 `moved: false` 와 같은 규칙이다.

## 변환됐다고 말하기 전에 확인한다

batchPlay 가 오류 없이 끝나도 결과 타입을 읽어 `smartObject` 인지 본다.
`document.rotate`(§17.19)가 캔버스 크기로 확인하는 것과 같은 자리다.

## Mock 도 id 를 바꾼다

Mock 이 현실과 다르면 그 경로는 테스트에 영원히 나오지 않는다 — 배경 승격 버그가
실기에서만 드러난 이유가 그것이다.

배경 레이어는 변환되면서 배경이 아니게 되므로 `isBackground` 를 뗀다. 남겨 두면
"배경인 스마트 오브젝트" 라는 존재하지 않는 상태가 만들어지고, 이후 Command 가
`rename` · `set_blend_mode` 를 잘못 막는다.

## 실기 검증

Photoshop 27.8, `_DSC7393.NEF` (3532×5298 16비트). 달에 국소 보정을 거는 전체
파이프라인을 통과시켰다.

```text
stamp_visible "02_달"            id 14  pixel
selection.set ellipse + feather 20
mask.create from=fromSelection   hasMask true
smart_object.convert             id 14 → 16 → 17   converted true   hasMask false
camera_raw.apply                 texture 18 · clarity 8 · highlights −10
```

**마스크는 Smart Object 안으로 흡수된다.** 변환 결과의 `hasMask` 가 `false` 다.

그리고 **SO 가 마스크 범위로 잘린다.** 속성 패널이 `W 497 · H 540 · X 1298 · Y 922`
를 보였다. 타원이 `397×440 @ (1348, 972)` 이고 feather 20 이 각 변을 50px 넓히므로
정확히 일치한다. 문서 전체 크기가 아니다.

### id 교체가 실재한다

```text
convert {layerId: 14}   → {id: 15, previousId: 14, converted: true}
convert {layerId: 14}   → LAYER_NOT_FOUND
```

옛 id 는 **사라진다.** `previousId` 를 담은 이유가 이것이다.

### 두 번째 변환

```text
convert {layerId: 15}   → {converted: false, previousId: 15}   레이어 수 그대로
```

### **`mask.create` 의 `from` 기본값은 `revealAll` 이다**

선택 영역이 있어도 **자동으로 쓰지 않는다.** 처음에 `from` 을 빠뜨려 전부 흰
마스크가 만들어졌고, 변환된 SO 가 캔버스 전체를 덮어 Camera Raw 가 전역에 걸렸다.

**눈으로는 보이지 않았다.** 밝기가 거의 안 변했기 때문이다(하늘 L 25.11 → 25.08).
잡아낸 것은 노이즈다.

```text
하늘 σ   02_달 숨김 0.93   보임 1.24      ← 마스크가 안 걸렸다
하늘 σ   02_달 숨김 0.93   보임 0.93      ← 고친 뒤
```

레이어를 껐다 켜며 같은 영역을 재는 것이 국소 보정이 격리됐는지 확인하는 방법이다.
§17.13 이 "보는 것과 재는 것은 다른 일" 이라고 적은 자리가 또 나왔다.

### 결과

```text
달 안쪽 σ   1.844(원본) → 0.987(전역 NR 뒤) → 1.273
하늘 σ      0.930  변화 없음
주탑 σ      2.431  변화 없음
```

전역 노이즈 감소가 깎은 달 질감을 국소로 되올렸고, 다른 영역은 건드리지 않았다.

## 체크리스트

- [x] `photoshop.smart_object.convert` — EDIT
- [x] id 교체를 `resolveMutatedLayer` 로 해결하고 `previousId` 로 드러낸다
- [x] 이미 스마트 오브젝트면 `converted: false`
- [x] 변환 결과 타입 확인
- [x] Mock 이 id 교체와 배경 해제를 흉내낸다
- [x] `docs/CORE_API.md` §4.2 갱신 (§5.8 예정 목록에서 이동)
- [x] 실기 검증 — 마스크는 안으로 흡수되고 SO 가 그 범위로 잘린다

---

# 17.28 피사체 선택 — 이름은 처음부터 맞았다

## 두 번 막혔던 것

`CORE_API.md` §7 이 이렇게 적어 두고 §5 후보로 돌려 둔 것이다.

```text
조정 레이어 활성:  "피사체 선택" 명령은 현재 사용할 수 없습니다.
픽셀 레이어 활성:  "피사체 선택" 명령의 매개 변수는 현재 유효하지 않습니다.
             (sampleAllLayers: false 를 줘도, 빼도 같다)
```

그때 `autoCutout` 이라는 이름을 **문서에서 가져왔고**, 오류 문구를 그대로 믿었다.

## 알림을 `["all"]` 로 고쳤다

§15 가 "Photoshop 알림은 하나도 오지 않는다" 고, 그리고 CLAUDE.md 가 "`command.*`
만 신뢰할 수 있다" 고 적어 두었던 것이 **이름 목록으로 등록했기 때문**이었다.

```text
["make", "set", "select", …]   등록 성공 · 전달 0
["all"]                        전달됨
```

`startNotifications` 가 이제 `["all"]` 로 등록하고 **받는 쪽에서 거른다.** 아는
액션은 이름을 붙이고 나머지는 `photoshop.unknown` 으로 원본과 함께 나간다 —
`notifications.ts` 맨 위가 처음부터 말하던 원칙이다.

바꾼 직후 바로 들어왔다.

```text
photoshop.unknown  ←  modalJavaScriptScopeEnter
photoshop.unknown  ←  modalJavaScriptScopeExit
```

## descriptor 를 잡았다

메뉴에서 `선택 > 피사체` 를 한 번 실행하고 받았다.

```text
invokeCommand        commandID 1461
modalStateChanged    title "GARBAGE"  enter → exit
historyStateChanged  name "Select Subject"
autoCutout           { sampleAllLayers: false }
```

**이름도 파라미터도 처음 것과 같았다.**

**이벤트 버퍼는 MCP 서버 프로세스에 있다.** 스크립트를 돌릴 때마다 새 서버가 떠서
버퍼가 빈다 — 캡처하려면 서버를 띄워 둔 채로 사람이 메뉴를 실행해야 한다.
이것을 모르고 두 번 헛돌았다.

## 모달 밖이라고 짐작했다가 틀렸다

캡처에 Photoshop 자신의 모달(`GARBAGE`)이 보여서 "우리 `executeAsModal` 안이라
거부되는 것" 이라고 짐작하고 `runModal` 없이 구현했다. 재 보니 **반대였다.**

```text
Event: autoCutout may modify the state of Photoshop.
Such events are only allowed from inside a modal scope.
```

되돌려 `runModal` 안에서 부르니 **픽셀 레이어 · 스마트 오브젝트 · 숨긴 레이어
세 가지 모두에서 동작했다.** 예전 실패의 원인은 확정하지 못했다. 짐작을 적지 않는다.

## 왜 필요했나 — 밝기 마스크는 `shadows` 와 서로를 무효화한다

교량에 국소 보정을 걸려다 드러났다. `selection.color_range highlights` 로 마스크를
만들고 `shadows` 를 올렸더니 아무 일도 일어나지 않았다.

```text
밝기 마스크  →  어두운 부분을 뺀다
shadows     →  어두운 부분에만 작용한다
```

교량에서 입체감이 필요한 곳은 상판 아래와 교각 — 어두운 면이다. 마스크가 바로
그곳을 제외하고 있었다.

같은 값(shadows 10 · texture 10 · dehaze 4)을 두 마스크로 걸어 재면 이렇다.

```text
             밝기 마스크        피사체 마스크
교각 σ       1.134 → 1.134     1.134 → 1.273  (+12.3%)
상판 σ       1.925 → 1.925     1.925 → 1.999  (+3.8%)
주탑 σ       2.431 → 2.504     2.431 → 2.488
```

**교각이 갈랐다.** 밝기 마스크에서는 변화가 0 이다.

`texture` · `clarity` 는 교량에 잘 듣지 않는다는 것도 함께 확인했다 — 달(매끄러운
면)은 `texture 18` 로 σ +29% 였는데 교량은 `texture 25` 로 +6.7% 였다. 이미 초점이
맞은 금속 구조는 국소 대비 강화가 금방 포화한다.

## 무엇을 피사체로 볼지는 Photoshop 이 정한다

야경에서는 주제가 분명하지 않다. 실기에서 선택 경계가 `752,720 – 3532,4448` 로
문서의 절반을 넘었다. `reliable` 같은 판정을 담지 않고 `bounds` 를 그대로 준다 —
`measure.tilt`(§17.21)와 같은 규칙이다.

## 실기 검증

Photoshop 27.8, `_DSC7393.NEF`.

```text
selection.subject            hasSelection true   752,720 – 3532,4448
mask.create fromSelection
smart_object.convert         id 29 → 30
camera_raw.apply             shadows 10 · texture 10 · dehaze 4

하늘 · 도시 · 수면   소수점까지 동일        ← 격리 확인
교각                σ +12.3%
```

## 체크리스트

- [x] `photoshop.selection.subject` — EDIT
- [x] 알림 등록을 `["all"]` 로 바꾸고 받는 쪽에서 거른다
- [x] descriptor 를 캡처로 확인 (짐작하지 않았다)
- [x] `runModal` 안에서 부른다 — 밖은 거부된다
- [x] Mock 은 선택 유무만 흉내낸다
- [x] `docs/CORE_API.md` §4.5 갱신 (§5.4 예정 목록에서 이동)
- [x] 실기 검증 — 격리와 교각 반응
- [ ] `photoshop.event.recent` 의 이름별 매핑을 넓힌다 — 지금은 대부분 `photoshop.unknown`

---

# 17.29 색상 혼합 — 24개 키가 통째로 비어 있었다

## 무엇이 없었나

`camera_raw.apply` 에 색상별 조정이 없었다. 전역 `vibrance` · `saturation` 뿐이라
"야경에서 조명색만 살리고 하늘은 둔다" 같은 조정이 불가능했다.

```text
있던 것  기본 · 세부 · 효과 · 비네팅         25개
없던 것  색조 8 · 채도 8 · 광도 8            24개
```

## §17.28 이 만든 길로 잡았다

`["all"]` 알림이 동작하게 된 직후라 같은 방법을 그대로 썼다. 사람이 Camera Raw
에서 색상 혼합 슬라이더를 움직이고 확인을 누르면 한 descriptor 에 모여서 온다.

```text
$HA_R $HA_O $HA_Y $HA_G $HA_A $HA_B $HA_P $HA_M    색조
$SA_R $SA_O $SA_Y $SA_G $SA_A $SA_B $SA_P $SA_M    채도
$LA_R $LA_O $LA_Y $LA_G $LA_A $LA_B $LA_P $LA_M    광도
```

접미사가 `R·O·Y·G·A·B·P·M` 으로 UI 순서와 같다. **그래도 잡아낸 그대로 적는다** —
`saturation` 만 `$` 가 없던 전례가 있다.

값은 **정수**로 간다. `$Ex12` 처럼 실수로 밀 필요가 없다.

`$CrVe` · `$PrVN` · `$PrVe` 도 함께 왔지만 넣지 않았다(§17.17 과 같은 이유).

## 캡처하는 쪽이 세 번 막혔다

descriptor 자체는 한 번에 왔는데 **받을 창구를 세우는 데 세 번 실패했다.**

1. **백그라운드 `&` 로 띄운 감시기가 부모 셸과 함께 죽었다.** `READY` 만 남았다.
2. **서버를 여럿 띄워 포트가 엉켰다.** 플러그인은 한 서버에만 붙는데 감시기는
   자기 서버의 버퍼를 본다. 세션 시작 때 남아 있던 서버까지 정리해야 했다.
3. **`event.recent` 의 `limit` 상한이 200 인데 300 을 보냈다.** 스키마 오류가
   났는데 감시기가 `catch {}` 로 삼키고 "대화상자 때문에 응답 없음" 으로 적었다.

세 번째가 가장 나빴다. **틀린 원인을 그럴듯하게 보고해서** 대화상자를 의심하며
시간을 썼다. 오류를 삼키는 `catch {}` 는 진단을 불가능하게 만든다 — CLAUDE.md 가
"실패는 디버그가 아니어도 남긴다" 고 적어 둔 자리다.

**이벤트 버퍼는 MCP 서버 프로세스에 있다.** 스크립트를 돌릴 때마다 새 서버가 떠서
버퍼가 빈다. 캡처하려면 서버 하나를 띄워 둔 채로 사람이 메뉴를 실행해야 한다.

## 빈 레이어에는 걸리지 않는다

검증용으로 `layer.create` 로 레이어를 만들어 주었는데 **투명한 빈 레이어**였다.
Camera Raw 가 조정할 색이 없어 색상 혼합이 흑백 믹서로 떨어진다.
`layer.stamp_visible` 이었어야 했다.

같은 때 문서가 **빠른 마스크 모드**였던 것도 겹쳤다 — 미리보기가 온통 빨강이라
색상 범위가 없다. 창을 직접 찍어(§17.11 과 같은 방법) 제목의 `빠른 마스크/16` 을
읽고 알았다.

## 실기 검증

Photoshop 27.8. 한 그룹씩 따로 걸어 **선택성**을 확인했다.

```text
saturationOrange +60      도시 R−B  7.39 → 7.75  (+4.9%)
                          주탑 B  127.55 → 127.33 (−0.17%)
                          하늘              완전 동일

luminanceBlue −60         주탑 L  108.14 → 90.14 (−16.6%)
hueOrange +60             도시 G   27.87 → 28.24 (+1.3%)
                          하늘              완전 동일
```

특정 색만 움직이고 나머지는 소수점까지 그대로다.

## 체크리스트

- [x] 색조 · 채도 · 광도 × 8색 = 24개 파라미터
- [x] 키를 알림 캡처로 확인 (짐작 없음)
- [x] 버전 키를 넣지 않는다
- [x] 정수로 보낸다 (`$Ex12` 와 다르다)
- [x] 전역 `saturation` 과 이름이 섞이지 않는지 테스트로 고정
- [x] 실기 검증 — 세 그룹 모두, 선택성 포함

---

# 17.30 곡선 — 구간 경계 없이는 조용히 무시된다

## 무엇이 없었나

§17.29 로 색상 혼합이 들어간 직후, 곡선이 통째로 비어 있었다. 계획상 "도시 배경을
Curves 로 낮춘다" 같은 단계를 Camera Raw 안에서 할 수 없었다.

## 키

§17.28 의 알림 캡처를 그대로 썼다.

```text
$PC_H  밝은 영역      $PC_L  밝음      $PC_D  어두움      $PC_S  어두운 영역
$PC_1  $PC_2  $PC_3   구간 경계 (기본 25 · 50 · 75)
curve  $CrvR  $CrvG  $CrvB   포인트 곡선 (RGB · 빨강 · 녹색 · 파랑)
$crfs  채도 미세 조정 (기본 100)
```

**`curve` 에는 `$` 가 없다.** `saturation` 에 이은 두 번째 예외다. 규칙성을
가정했으면 이것 하나가 조용히 빠졌을 자리다.

`$crfs` 는 잡아 놓고 뜻을 몰라 처음에는 **빼 두었다.** 사용자가 보내 준 패널
캡처에 `채도 미세 조정 100` 이 있어 확인하고 넣었다. 모르는 키를 그럴듯한
이름으로 노출하지 않는다.

## **경계 없이는 아무 일도 하지 않는다**

실기에서 `curveHighlights: -60` 만 보냈더니 `ok` 를 돌려주면서 **1레벨도 움직이지
않았다.** 달 198.51 → 198.51 이었다.

```text
$PC_H 만                        변화 없음
$PC_H + $PC_1 · $PC_2 · $PC_3   달 198.51 → 180.33
```

Camera Raw 가 낸 descriptor 에는 경계 셋이 **언제나 함께** 있었다. 그것이 우연이
아니었다.

`$Ex12` 에 정수를 보내는 것과 같은 종류의 실패다 — 오류 없이 성공을 보고하면서
아무것도 안 한다. 이 프로젝트에서 세 번째다(배경 `set_opacity`, `$Ex12`, 이것).

**빌더가 채운다.** 파라메트릭 값이 하나라도 있으면 경계를 기본값으로 넣는다.
호출자가 준 값은 덮지 않는다. 포인트 곡선만 줄 때는 넣지 않는다 — 없던 설정을
만들어내는 셈이 된다. `temperature` 에 `$WBal` 을 붙이는 것과 같은 자리다.

## 포인트 곡선은 점으로 받는다

descriptor 는 `[0, 0, 67, 57, 255, 255]` 평탄 배열이지만 Tool 은 `[{x, y}, …]` 로
받는다. 평탄 배열을 그대로 받으면 **홀수 길이가 조용히 통과**한다.

x 는 엄격히 증가해야 한다. 같거나 줄어들 때 Camera Raw 가 어떻게 받는지 확인하지
않았고, 짐작해서 통과시키지 않는다.

끝점 `(0,0)` · `(255,255)` 은 강제하지 않는다. 잡힌 descriptor 에는 있었지만
필수인지 확인하지 않았다.

## 실기 검증

Photoshop 27.8. 한 슬라이더씩 걸어 **톤 구간별 선택성**을 확인했다.

```text
                     달 198.51        하늘 25.03
curveHighlights −60    180.33 (−9.2%)    25.03  (변화 없음)
curveShadows    +60    198.94 (+0.2%)    35.74  (+42.8%)
```

각자 자기 구간만 건드린다. `H·L·D·S` 접미사가 UI 이름과 맞는다는 것이 이것으로
확정됐다.

### 검증 중에 겪은 것

**`history.undo` 로 되돌리려다 헛돌았다.** 그 사이 `selection.set` · `clear` 가
히스토리 상태를 만들어서 undo 가 선택 변경을 되돌렸다. 필터는 그대로 남았는데
측정값이 "변화 없음" 으로 보여 한참 잘못 읽었다.

**레이어를 새로 떠서 비교해야 한다.** 임시 레이어가 남아 있으면 다음 stamp 에
섞여 들어가 직전 결과를 다시 측정하게 된다. 실제로 두 번 같은 값이 나왔다.

## 체크리스트

- [x] 파라메트릭 4개 + 구간 경계 3개
- [x] 포인트 곡선 4채널 — 점 목록으로 받는다
- [x] `채도 미세 조정`(`$crfs`)
- [x] **경계 자동 보정** — 없으면 조용히 무시된다
- [x] `curve` 에 `$` 가 없다는 것을 테스트로 고정
- [x] 기본 패널 `highlights`(`$Hi12`)와 다른 키임을 테스트로 고정
- [x] 실기 검증 — 톤 구간 선택성

---

# 17.31 닷징 · 버닝 — 브러시가 아니라 얼룩이다

## 왜 만들 수 있었나

§17.14 가 치유 브러시를 만들지 않은 이유는 **획 경로**였다. batchPlay 로 획을
흉내 내면 좌표 목록을 보내는 일이 되고, 그러면 호출자가 descriptor 를 조립하는
것과 다를 바 없어진다(ARCHITECTURE §23).

닷징·버닝은 다르다. 필요한 것은 **부드러운 원형 얼룩** 하나이고 `중심 · 반지름 ·
강도 · 경도` 네 값으로 결정된다. 검증된 파라미터로 조립된다.

그래서 먼지 제거와 같은 길을 쓴다 — 타원 선택 → 페더 → 채우기. 다른 것은 채우는
내용뿐이다(내용 인식 대신 `white` · `black`).

**`fill` descriptor 는 §17.14 에서 이미 검증된 것이다.** `using` 의 enum 값만 바뀐다.

## 투명 레이어에 칠한다

전통적으로는 50% 회색을 채운 레이어에 칠한다. 그것은 Soft Light 에서 회색이
중립이라는 사실을 쓰는 것뿐인데, **투명 픽셀도 중립이다.** 빈 레이어에 그대로
칠하면 같은 결과가 나오고 회색을 채우는 단계가 없어진다.

레이어 준비는 이 Command 가 하지 않는다 — `layer.create` + `layer.set_blend_mode`
이며 둘 다 이미 있다. 여기서 대신 만들면 **얼룩을 찍을 때마다 레이어가 하나씩
생긴다.**

## 배경을 거절한다

원본 픽셀을 직접 밝히거나 어둡게 하는 작업이다. `retouch.remove_spots` 와 같은
규칙이며, 같은 이유로 **모르면 막지 않는다.**

## 실효 범위는 반지름의 약 2.5배다

경도 0 이면 페더가 반지름과 같다. 페더는 가장자리에서 양쪽으로 번지므로 지정한
반지름보다 훨씬 멀리 닿는다.

```text
반지름 600 · 강도 30 · 경도 0 으로 한 번 찍고 중심에서 거리별로 잰 ΔL

  거리     0   150   300   450   600   750   900  1050  1200  1350  1500
  ΔL    6.97  6.79  6.33  5.64  4.86  4.00  3.12  2.29  1.60  1.04  0.63
```

단조 감소하고 경계가 없다. **지정 반지름(600)에서 값이 절반쯤 남아 있고 1500 까지
닿는다** — 호출자가 이것을 모르면 옆 영역까지 밝힌다.

σ 는 켬·끔 양쪽에서 같았다. 닷징이 노이즈를 늘리지 않는다.

## 경도 100 은 페더를 건너뛴다

`featherFor` 가 0 을 돌려준다. Photoshop 이 **반지름 0 의 페더를 거절**하기
때문이다. 그대로 보내면 경계값에서만 조용히 실패한다.

순수 함수로 `dodge-burn-geometry.ts` 에 떼어 두었다 — `photoshop` 을 import 하는
파일은 단위 테스트가 읽지 못한다(`camera-raw-keys.ts` 와 같은 이유).

## 성운에는 맞지 않는다

원형 얼룩이 구조를 따라가지 못해 부자연스러워진다. 형태가 복잡한 대상은
`selection.color_range` 로 휘도 마스크를 만들고 `adjustment.curves` 를 거는 쪽이
맞다. 이 Tool 은 **중심부 발광이나 전경의 국소 밝기**처럼 둥근 것이 자연스러운
자리에 쓴다. Tool 설명에 적어 두었다.

## 실기 검증

Photoshop 27.8, `새비재01_04.tif` (4032×6048 16비트).

```text
배경에 시도                    거절 — "원본 픽셀이 바뀝니다 … softLight 를 건 뒤"
dodge  r600 s30                중심 L 80.08 → 87.05   (위 감쇠 표)
burn   r400 s40                중심 L 51.68 → 46.04   (−10.9%)
먼 전경                        완전 동일
```

## 체크리스트

- [x] `photoshop.dodge_burn.dab` — EDIT
- [x] 얼룩을 배열로 받는다 (상한 200)
- [x] 배경 · 조정 레이어 · 그룹 · 스마트 오브젝트 거절
- [x] 선택을 `finally` 에서 해제
- [x] 경도 100 에서 페더를 건너뛴다
- [x] Mock 이 거절 경로를 흉내낸다
- [x] `docs/CORE_API.md` §4 갱신
- [x] 실기 검증 — dodge · burn · 감쇠 곡선 · 배경 거절

---

# 17.32 색 칠하기와 마스크 칠하기 — 얼룩이 열어 준 길

## §17.31 의 논리가 어디까지 가는가

`dodge_burn.dab` 이 보인 것은 "브러시가 아니라 얼룩이면 §23 을 지킬 수 있다" 였다.
그 논리는 채우는 **내용**과 **대상**을 바꿔도 그대로 성립한다.

```text
dodge_burn.dab   픽셀에  흰색·검정      §17.31
paint.dab        픽셀에  지정한 색      §17.32
mask.dab         마스크에 흰색·검정     §17.32
```

셋이 하는 일이 같아서 **공통 경로를 `dab.ts` 로 떼어냈다** — 같은 루프를 세 곳에
두면 한 곳만 고쳐지는 날이 온다. `dodge-burn-geometry.ts` 는 `dab-geometry.ts` 로
바꿨다. 이름이 한 Tool 을 가리키면 다음 사람이 공유물인 줄 모른다.

## descriptor 는 이미 저장소 안에 있었다

두 조각 모두 짐작하지 않았다.

```text
마스크 채널 잡기   mask-gradient.ts (§17.22)
RGBColor          mask-gradient.ts — **녹색 키가 `green` 이 아니라 `grain`** 이다
fill              retouch.ts (§17.14)
```

새로 맞춘 것은 `using: { _enum: "fillContents", _value: "color" }` 하나이고
실기에서 **요청한 255/0/0 이 그대로 나오는 것**을 확인했다.

## `mask.dab` 이 더 중요하다

`paint.dab` 은 픽셀을 덮어쓰므로 쓸 자리가 좁다. `mask.dab` 은 **조정 레이어의
마스크**를 다듬으므로 비파괴 보정의 한가운데에 들어간다.

`mask.gradient`(§17.22)가 마스크를 통째로 덮어쓰는 것과 달리 이쪽은 **더한다.**

실기에서 은하수 사진의 빛 공해가 한쪽으로 치우쳐 있었다. 선형·방사형으로는 그
형태를 맞출 수 없고, 합성 픽셀에 닷징으로 덮으면 조정 레이어를 껐다 켤 때
따라오지 않는다.

```text
평탄화 레이어 마스크에 reveal 얼룩     중하 33.14 → 29.59
                                       은하수 65.24 → 65.91 (그대로)
```

## **이미 흰 마스크는 더 열 수 없다**

같은 실기에서 `hide` 로 좌하단을 밝히려 했는데 아무 일도 없었다. 그 자리의
마스크가 **이미 검정**이라 더 검게 할 것이 없었다. 반대로 비네팅 보정 레이어를
`reveal` 로 더 열려 했더니 그쪽은 **이미 흰색**이었다.

`mask.dab` 은 마스크를 옮길 뿐 조정의 세기를 바꾸지 않는다. 마스크가 이미 끝까지
가 있으면 곡선 자체를 고쳐야 한다. **무엇이 한계인지 알고 쓰는 것이 중요하다** —
아무 일도 안 일어나는데 오류도 없다.

## 이름을 `reveal` · `hide` 로 둔다

`white`/`black` 으로 두면 호출자가 매번 어느 쪽이 보이는 쪽인지 되짚어야 한다.
마스크에서 흰색이 보이는 쪽이라는 규칙을 이름이 말하게 했다.

## 실기 검증

Photoshop 27.8, `새비재01_04.tif` (4032×6048 16비트).

```text
paint.dab  255/0/0  r300 s100 h100     칠한 자리 R 255 · G 0 · B 0 (정확)
mask.dab   reveal   r500 s45           중하 33.14 → 31.18 → 29.59
                                       은하수 65.24 → 65.91
mask 없는 레이어                        거절 — "mask.create 로 먼저 만드세요"
배경 레이어에 paint.dab                 거절 — "원본 픽셀이 사라집니다"
```

## 체크리스트

- [x] `photoshop.paint.dab` — EDIT
- [x] `photoshop.mask.dab` — EDIT
- [x] 공통 경로를 `dab.ts` 로 분리, `dab-geometry.ts` 로 개명
- [x] `paint.dab` 은 배경·비픽셀 거절
- [x] `mask.dab` 은 마스크 없으면 거절
- [x] `reveal`/`hide` 로 받는다
- [x] Mock 이 거절 경로를 흉내낸다
- [x] `docs/CORE_API.md` §4 갱신
- [x] 실기 검증 — 색 정확도 · 마스크 반영 · 거절 경로

---

# 17.33 텍스트 — 워터마크까지만 연다

## 범위를 요구에 맞춘다

`CORE_API.md` §5.12 가 텍스트 전체를 P3 로 두고 **"실제 요구가 확인된 뒤에
연다"** 고 적어 둔 자리다. 확인된 요구가 워터마크·서명이므로 거기까지만 열었다.

```text
열었다    text.create · text.set · font.list
안 열었다  자간 · 행간 · 단락 · 워프 · 변형 · convert_to_shape
```

안 쓰는 파라미터가 스키마에 있으면 호출자가 무엇이 중요한지 알 수 없다.

**설정마다 Tool 을 두지 않았다.** `set_font` · `set_size` · `set_color` 대신
`text.set` 하나다 — 워터마크는 한 번에 만들고 고칠 때도 여러 속성을 같이
바꾼다. (`camera_raw.apply` 와 같은 판단)

## DOM 에 있는지 재 봤고, 있었다

`document.rotate`(§17.19) 때와 같은 방식이다. 임시 탐침을 붙여 확인하고 지웠다.

```text
document.createTextLayer(options)     function · 인자 1개
layer.textItem.contents               내용
layer.textItem.characterStyle         font · size · color · tracking · leading …
layer.textItem.paragraphStyle         justification …
app.fonts                             607개 · { _family, _name, _postScriptName, _style }
```

**batchPlay 를 한 줄도 쓰지 않았다.** DOM 이 있으면 DOM 을 쓴다.

## `SolidColor` 에서 두 번 틀렸다

짐작으로 두 번 틀렸고 두 번 다 실기가 답을 줬다.

```text
{ rgb: {...} } 를 color 에    'color' is of type object. Expecting type SolidColor.
solid.rgb = {...} 통째 대입    Argument 1 has an invalid type … actual type: undefined
solid.rgb.red = 255 하나씩     red=255 green=255 blue=255  ✓
```

생성자는 `app.SolidColor` 다 — `photoshop` 모듈 최상위에는 없다.
**`rgb` 는 통째로 바꿀 수 없고 속성을 하나씩 넣어야 한다.**

어느 속성이 문제인지는 **하나씩 걸어서** 갈랐다. `size` · `font` · `opacity` ·
`alignment` 는 전부 통과했고 `color` 만 실패했다.

## 없는 폰트는 조용히 대체된다

**이것이 이 Command 에서 가장 위험한 자리다.** 없는 PostScript 이름을 주면
Photoshop 이 오류 없이 다른 폰트로 그린다. 호출자는 지정한 폰트가 걸렸다고 믿는다 —
배경 `set_opacity` 가 무시되던 것과 같은 종류다(ARCHITECTURE §8.4).

그래서 `app.fonts` 에서 미리 찾아보고 없으면 **거절한다.** 목록을 얻지 못하면
막지 않는다 — 없는 것을 참으로 읽어 멀쩡한 호출을 막는 것이 더 나쁘다.

`font.list` 가 주는 것은 **`postScriptName`** 이다. 화면에 보이는 이름이 아니다.

## 거르기는 서버가 한다

607개를 통째로 주면 LLM 의 맥락만 먹는다. `query` 와 `limit`(기본 50)으로 거르되
**그 계산은 서버에서 한다** — Plugin 은 실행 Agent 이고 같은 계산을 두 곳에서
하지 않는다. (CLAUDE.md 의존 방향 6)

`total` 은 거르기 전 전체 수다. 몇 개 중에서 골랐는지 알 수 있어야 한다.

## 실기 검증

Photoshop 27.8, `새비재01_04.tif`.

```text
font.list query="gmarket"        3개 / 전체 607
text.create 워터마크              applied [font, size, color, alignment, opacity]
                                  한글 포함 렌더 확인
text.set                          applied [contents, size, opacity]
픽셀 레이어에 text.set             거절 — "pixel 레이어는 텍스트가 아닙니다"
없는 폰트                          거절 — "'없는폰트123' 폰트가 이 기기에 없습니다"
```

## 체크리스트

- [x] `photoshop.text.create` — EDIT
- [x] `photoshop.text.set` — EDIT. 텍스트가 아니면 거절
- [x] `photoshop.font.list` — READ. `postScriptName` 을 준다
- [x] 없는 폰트를 미리 거절한다
- [x] `applied` 에 실제로 적용한 것만 담는다
- [x] Mock 은 폰트를 지어내지 않는다
- [x] 임시 탐침 제거
- [x] `docs/CORE_API.md` §4.2.1 신설, §5.12 에서 이동
- [x] 실기 검증 — 생성 · 수정 · 거절 경로 · 한글 렌더

---

# 17.34 액션 조회 — 실행은 아직 열지 않았다

## §23 과 어떻게 만나는가

액션은 **사용자가 미리 녹화해 둔 것**이다. LLM 은 이름을 고를 뿐 내용을 만들지
못한다 — 그 점에서 Capability(§19)와 같은 구조다.

```text
capabilities.json   실행 파일은 설정에서만 오고 LLM 은 기능 이름만 준다
액션                액션은 Photoshop 에 이미 있고 LLM 은 이름만 준다
```

**그러나 무엇을 하는지 알 수 없다.** 실기에서 목록을 뽑아 보니 이미 이런 것이
있었다.

```text
[4511] 내보내기
    PSD로 저장 · PNG로 저장 · JPG로 저장 · TIFF로 저장 · GIF로 저장
```

승인된 작업 폴더(§8.5) 밖으로 파일을 쓴다. 액션 안에 평탄화·레이어 삭제·`.jsx`
실행이 들어 있어도 이름만 보고는 알 수 없다.

**그래서 조회만 열었다.** 실행은 `actions.json` 으로 사용자가 선언한 것만 돌리는
설계이고, 그 형태는 이 조회가 보여 준 현실에 맞춰 정한다 — `capabilities.json`
이 StarNet2·GraXpert 를 돌려 본 뒤에 필드를 얻은 것과 같은 순서다.

## DOM 에 있었다

```text
app.actionTree        ActionSet[]  · name · id · index · actions · play()
set.actions           Action[]     · name · id · index · parent · play()
```

`play()` 가 객체마다 있다. 실행 경로는 이미 있고 막는 것은 설계다.

## **속성 하나마다 Photoshop 으로 왕복한다**

전부 한 번에 읽으려다 **두 번 타임아웃했다.**

```text
11세트 · 91액션 × 속성 3개   ≈ 300 왕복   15초 초과
             × 속성 2개      ≈ 200 왕복   15초 초과
세트 이름만                   22 왕복      6.5초
한 세트의 액션                 52 왕복      통과
```

`index` 를 뺀 것으로는 부족했다. **두 단계로 나눴다** — `set` 을 주지 않으면
세트 이름만, 주면 그 세트의 액션만 읽는다. 사용자가 탐색하는 순서와도 맞는다.

`index` 는 아예 담지 않는다. 왕복이 늘고, 순번은 사용자가 액션을 옮기면 바뀌어
키로 쓸 수도 없다 — 값이 없다.

## 이름은 유일하지 않다

`B and C Landscape` 가 `TK9 Blend If actions` 와 `TK9 actions` 양쪽에 있었다.
세트와 함께 읽어야 한다. `actions.json` 이 `set` + `action` 둘 다 키로 가져야
한다는 뜻이다.

## 없는 세트를 조용히 넘기지 않는다

빈 목록을 주면 **이름을 틀린 것인지 액션이 없는 것인지** 구분할 수 없다.
거절하면서 있는 세트 이름을 `details.available` 에 담는다.

## 실기 검증

Photoshop 27.8. 세트 11개 · 액션 91개.

```text
set 없이        11세트 (기본 액션 · TK9 actions · 내보내기 …)   6.5초
set="내보내기"   6액션                                        통과
set="없는세트"   거절 — "set 없이 photoshop.action.list 를 부르면…"
```

## 다음 — `actions.json`

이 조회가 확정해 준 것.

- 키는 **세트 이름 + 액션 이름** (id 는 재시작에 안정적인지 미확인)
- `permission` 을 액션마다 선언해야 한다 — 저장 액션과 보정 액션이 같은 목록에 있다
- 대화상자 억제와 Job 감싸기는 실행을 열 때 함께 정한다

## 체크리스트

- [x] `photoshop.action.list` — READ. 두 단계
- [x] `index` 를 담지 않는다
- [x] 없는 세트를 거절하고 있는 이름을 알려 준다
- [x] Mock 은 액션을 지어내지 않는다
- [x] 임시 탐침 제거
- [x] `docs/CORE_API.md` §4.2.2 신설
- [x] 실기 검증 — 두 단계 · 거절 경로
- [x] ~~`actions.json`~~ — §17.36 에서 **패널 선택으로 대체**했다
- [x] ~~`action.play`~~ — **만들지 않는다.** 이름을 그대로 받으면 허용 목록이
      무의미해진다(§17.35)

> 이 둘을 한동안 "다음 슬라이스" 로 남겨 두었는데, 그 사이 **안 하기로 결정**됐다.
> 미결로 남은 항목은 나중에 누가 집어 든다 — 결정이 났으면 그때 지운다.

---

# 17.35 액션 실행 — 선언한 것만

## permission 은 `destructive` 다

액션이 무엇을 하는지 **알 수 없다.** §17.34 에서 뽑은 목록에 이미
`내보내기 > PSD로 저장` 이 있었고, 평탄화·레이어 삭제·`.jsx` 실행이 들어 있어도
이름만으로는 모른다.

모르는 것을 `edit` 으로 두면 조용히 경계를 넘는다. `window.capture` 가 찍는 것이
문서가 아니라 화면이라 `external` 인 것과 같은 판단이다(§17.11).

기본 허용(`read` · `edit`) 밖이라 **꺼져 있는 것이 기본**이고
`PHOTOSHOP_MCP_ALLOW` 로 켠다.

## `actions.json` 은 권한이 아니라 목록이다

레벨을 액션마다 선언하게 하지 **않았다.** 선언이 사실일 보장이 없기 때문이다 —
액션 안을 읽을 수 없는데 `edit` 이라고 적으면 그것은 희망이지 사실이 아니다.
이 프로젝트는 모르는 것을 그럴듯한 값으로 덮지 않는다(`rawBitDepth` 와 같은 원칙).

그래서 이 파일이 정하는 것은 그보다 앞의 질문 — **어느 것을 부를 수 있는가** 다.
`capabilities.json` 이 실행 파일을 가두는 것과 같은 자리다(§19).

```json
{
  "starXTerminatorUnscreen": {
    "set": "RC Astro StarXTerminator Actions",
    "action": "StarXTerminator Unscreen",
    "description": "별 레이어를 unscreen 으로 분리한다. 레이어를 추가한다"
  }
}
```

`set` 과 `action` 둘 다 필요하다 — 이름이 유일하지 않다(§17.34).

`description` 은 **LLM 이 읽는 유일한 단서다.** 이름만으로는 파일을 쓰는지
레이어를 지우는지 알 수 없다.

## 이름을 그대로 받는 Tool 을 내놓지 않았다

`photoshop.action.play` 는 없다. 세트·액션 이름을 직접 받으면 허용 목록이
무의미해진다. 실행 통로는 `photoshop.action.run { name }` 하나다.

`ACTION_PLAY` Command 는 있지만 `destructive` 이고, Extension 이 직접 부르려면
manifest 에 선언해야 한다(§22).

## 대화상자를 끄지 못한다

**한동안 "`app.displayDialogs` 가 UXP 에 없다" 고 적어 두었는데 틀렸다.**
§61 에서 `host.get` 에 물어보니 27.8 에서 `true` 다 — Adobe 레퍼런스에도
23.0 부터 R/W 로 있다.

무엇을 "확인했다" 고 적었는지는 남아 있지 않다. 없는 것을 확인한 것인지,
걸었는데 대화상자가 그대로 떠서 없다고 읽은 것인지 가릴 수 없다.
**후자라면 결론(못 끈다)은 살아 있고 근거만 틀린 것이다.**

지금 코드는 그대로 둔다 — 걸어서 재 보기 전에는 바꾸지 않는다.

결과의 `dialogsSuppressed` 가 그 사실을 담는다. **껐다고 말하고 안 끄는 것이
가장 나쁘다** — 액션 안의 대화상자가 뜨면 플러그인이 멈추고 Bridge 가 15초에
타임아웃한다. 이 프로젝트에서 다섯 번째로 만나는 같은 실패다.

지금은 사용자가 액션의 대화상자 토글을 꺼 두어야 한다. `window.capture`(§17.11)
로 막힌 창을 볼 수는 있다.

## 실기 검증

Photoshop 27.8, `StarXTerminator Unscreen`.

```text
action.declared                  선언 2개
action.run "없는이름"             거절 — available 에 있는 이름을 함께 준다
action.run "starXTerminatorUnscreen"
    dialogsSuppressed false
    durationMs 11897

실행 전   배경 · 레이어 1(text)
실행 후   배경 · Starless · Stars(screen) · 레이어 1
```

**별 분리가 실제로 됐다.** 외부 플러그인(StarXTerminator)을 부르는 액션이
11.9초 만에 레이어 둘을 만들었다.

## 60초를 넘는 액션은 아직 다루지 않았다

`longRunning` 필드는 선언에 넣어 두었지만 Job(§14)으로 감싸지 않았다.
11.9초는 MCP 기본 타임아웃 60초 안이라 이번 검증에서는 드러나지 않았다.
더 긴 액션을 만나면 그때 연다 — 없는 요구에 코드를 먼저 쓰지 않는다.

## 체크리스트

- [x] `photoshop.action.run` — DESTRUCTIVE. 선언된 것만
- [x] `photoshop.action.declared` — READ
- [x] `ActionRegistry` + `actions.json` (`PHOTOSHOP_MCP_ACTIONS`)
- [x] 이름을 그대로 받는 Tool 을 내놓지 않는다
- [x] `dialogsSuppressed` 로 끄지 못했음을 드러낸다
- [x] `actions.json` 을 `.gitignore` 에, 예시만 커밋
- [x] 실기 검증 — StarXTerminator Unscreen
- [ ] 60초 넘는 액션의 Job 감싸기 — 요구가 생기면

---

# 17.36 액션 허용 목록을 패널로 — 설정 파일이 틀렸다

## 한 커밋 만에 드러났다

§17.35 는 `actions.json` 에 손으로 적게 했다. **이 기기에만 액션이 91개다.**

```text
기본 액션 12 · TK9 actions 26 · TK9 Blend If 8 · TK9 Non-English 8
기본 조정 5 · 주제 및 배경 5 · 창의적 효과 6 · 안내선 8 · 크기 조정 6
내보내기 6 · RC Astro 1
```

쓰고 싶은 것마다 세트 이름과 액션 이름을 타이핑해야 했고, `description` 을
**필수**로 만들어 더 나빴다. 오타는 조용히 안 걸리고 사용자가 액션 이름을 바꾸면
설정이 소리 없이 깨진다.

예시를 2개짜리로 만든 것이 문제를 가렸다. **현실 규모로 써 봤으면 바로 보였을
것이다.**

## 이 저장소에 이미 답이 있었다

```text
작업 폴더 승인(§8.5)   패널 버튼 → 플러그인 localStorage → 서버가 Bridge 로 조회
                       getFolder() 가 사용자 제스처를 요구해서 서버가 못 한다
```

액션도 같다. **Photoshop 안에 있고 고를 수 있는 것은 사용자뿐이다.**

그리고 **플러그인은 서버의 작업 디렉터리에 파일을 쓸 수 없다** — UXP 샌드박스는
승인된 폴더와 플러그인 데이터 폴더만 허용한다. 파일로 가면 경로 문제가 하나 더
생긴다.

## 패널 모달

도킹된 패널은 260×200 이고 사용자가 높이를 늘리지 못하는 경우가 있다. 91개는
담기지 않아 **모달**로 띄운다.

**펼칠 때 읽는다.** UXP 는 속성 하나마다 왕복한다(§17.34). 91개를 한 번에 읽으면
20초 가까이 걸려 모달이 멈춘 것처럼 보인다. 세트 이름만 먼저 읽고, 사용자가
펼친 세트의 액션만 읽는다. **접으면 읽은 것을 버린다** — 사용자가 Photoshop 에서
액션을 바꿨을 수 있다.

## 평탄한 목록으로 저장한다

"세트 전체 허용" 으로 저장하지 않는다. 그러면 사용자가 나중에 그 세트에 액션을
추가했을 때 **고른 적 없는 것이 조용히 열린다.** 모달의 "이 세트 전체 선택" 은
화면에서만 토글하고, 저장되는 것은 고른 액션 목록이다.

## 검사는 플러그인에 있다

서버 Tool 이 아니라 `action-play.ts` 에서 막는다. Extension 은 Tool 을 거치지 않고
Command 를 직접 부를 수 있으므로(ARCHITECTURE §3.2) 위쪽에서만 막으면 그 길이
열려 있다. 허용 목록도 플러그인에 있으니 검사도 거기가 맞다.

## 서버는 보관하지 않는다

**부를 때마다 물어본다.** 기동 시 한 번 읽으면 사용자가 패널에서 바꾼 것이
반영되지 않는다.

`persisted` 를 함께 돌려준다 — `localStorage` 가 없는 UXP 환경이 있고, 그때는
Photoshop 을 다시 켤 때 선택이 사라진다. **남았다고 말하고 안 남는 것이 가장 나쁘다.**

## 지운 것

```text
actions.json · actions.json.example · PHOTOSHOP_MCP_ACTIONS
ActionRegistry · ActionConfigSchema · ActionDeclarationSchema
action.run 의 { name } 인자 → { set, action }
```

## 모달에서 세 번 고쳤다

실기에서 하나씩 드러났다.

**① 버튼이 잘렸다.** UXP 버튼은 기본 스타일이 커서 패널 한 줄을 다 먹는다.
`액션 선택` 이 화면 밖으로 밀렸다 — 높이 20px 과 여백을 직접 못 박았다.
코드 주석이 이미 경고하던 문제를 내가 한 줄 더 얹어 악화시켰다.

**② 글자가 배경에 묻혔다.** UXP 대화상자는 패널과 달리 텍스트 색을 물려주지
않는다. 색을 명시해야 한다.

**③ 버튼이 동작하지 않았다.** `<form method="dialog">` 제출로 닫히길 기대했는데
**UXP 는 그 방식을 지원하지 않는다.** 버튼마다 `dialog.close(값)` 을 직접 건다.

## 저장과 닫기를 나눈다

처음에는 `저장` 이 창을 닫았다. 사용자가 **"저장된 건지 선택한 건지 알기 힘들다"**
고 했다 — 맞는 말이다. 닫혀 버리면 확인할 방법이 없다.

```text
[모두 해제] [저장]              [닫기]

실행을 허용할 액션  3개 선택 · 저장됨      초록
실행을 허용할 액션  3개 선택 · 저장 안 함  주황 + 닫기 버튼이 "저장 안 하고 닫기"
```

`저장` 과 `모두 해제` 는 창을 닫지 않는다. **고른 것과 저장한 것을 따로 들고
견준다** — 같은 숫자를 하나로만 보여주면 둘을 구분할 수 없다.

세트 헤더의 `(고른수/전체)` 도 체크할 때마다 다시 그린다. 처음에는 안 그려서
체크했는데 `(0/1)` 이 그대로였다 — **숫자가 거짓말을 했다.**

## 실기 검증

Photoshop 27.8.

```text
고르기 전
  action.declared        actions [] · total 0 · persisted true
  action.run             거절 — "패널의 '액션 선택…' 버튼으로 골라야"

패널에서 StarXTerminator Unscreen 을 고르고 저장
  action.declared        1개 · persisted true          ← 서버까지 전달됨
  action.run (허용됨)     11.8초 · Starless + Stars 생성
  action.run (내보내기)   거절 + allowed 에 고른 것을 함께 준다
```

## **대화상자가 실제로 멈췄다**

검증 중에 문서의 경고가 그대로 일어났다.

```text
"StarXTerminator" 명령은 현재 사용할 수 없습니다.   [계속(C)] [정지(S)]
```

활성 레이어가 텍스트라 StarXTerminator 가 걸리지 않았고, Photoshop 이 오류
대화상자를 띄웠다. **플러그인이 멈추고 Bridge 가 15초에 타임아웃했다.**
사람이 닫을 때까지 아무것도 못 한다.

그때 나온 메시지는 이것뿐이었다.

```text
Command 응답이 15000ms 내에 도착하지 않았습니다: ACTION_PLAY
```

**이것만으로는 대화상자가 떴다는 걸 알 수 없다.** 액션에서 가장 흔한 원인인데
길을 가리키지 않는다. `ACTION_PLAY` 가 타임아웃을 잡아 다시 감싼다 —
`window.capture`(§17.11)로 화면을 보라고, 액션 패널에서 대화상자 토글을 끄라고
말한다. 그 Tool 이 바로 이 상황을 위해 있는 것이다.

## 체크리스트

- [x] 패널에 `액션 선택…` 버튼과 허용 수 표시
- [x] 모달 — 세트 펼치기 · 액션 체크 · 세트 전체 토글
- [x] 펼칠 때 읽고 접으면 버린다
- [x] 평탄한 목록으로 저장
- [x] 검사는 플러그인에서 — Extension 직접 호출도 막힌다
- [x] 서버는 부를 때마다 조회
- [x] `persisted` 로 저장 여부를 드러낸다
- [x] `actions.json` 관련 전부 제거
- [x] 모달 실기 검증 — 버튼 크기 · 글자 색 · `close()` 세 번 고쳤다
- [x] 저장과 닫기를 나눈다 — `저장됨`/`저장 안 함` 을 색으로 구분
- [x] 타임아웃이면 대화상자를 의심하라고 말한다

---

# 17.37 GraXpert 패널 — 액션이 닿지 않는 곳

## 녹화가 안 됐다

"GraXpert 패널을 열고 AI auto 를 고르고 Run 을 누르는" 액션을 만들려 했는데
녹화가 되지 않았다. **왜인지를 재 봤다.**

`addNotificationListener(["all"])` 를 켜 두고 사람이 패널을 한 번 돌렸다.
레이어가 **두 장** 생겼는데 온 알림은 이것이 전부다.

```text
hostFocusChanged  active:true    dontRecord:true    _isCommand:false
invokeCommand     commandID:-1007                   _isCommand:false
invokeCommand     commandID:-1007                   _isCommand:false
hostFocusChanged  active:false   dontRecord:true    _isCommand:false
```

**`make` 가 하나도 없다.** 패널이 픽셀을 직접 쓰고 Photoshop 의 descriptor 경로를
거치지 않는다. 액션이 기록하는 것이 바로 그 경로다 — 녹화할 것이 없어서 녹화가
안 된 것이다. `dontRecord: true` 와 `_isCommand: false` 가 그대로 그 말이다.

여기서 규칙이 하나 나온다.

```text
필터 플러그인   →  메뉴 descriptor 로 간다    →  녹화된다   (StarXTerminator 11.8초)
패널 플러그인   →  자기 코드로 픽셀을 쓴다    →  안 된다    (GraXpert)
```

StarXTerminator 가 §17.35 에서 됐던 건 `필터 > RC-Astro` 메뉴를 거치기 때문이지
플러그인이라서가 아니었다. **"플러그인이면 된다" 가 아니라 "메뉴를 거치면 된다" 다.**

## CLI 로 대체되지 않는다

GraXpert 는 이미 Capability 로 돌고 있었다(§12). 그런데 결과가 다르다고 했다.
패널 소스를 읽어 보니 **GraXpert 호출 자체는 CLI 와 글자 그대로 같았다.**

```js
args = ["-cmd", "background-extraction", input, "-cli", "-gpu", gpu,
        "-correction", …, "-smoothing", …, "-output", outputBase];
```

다른 것은 **입력**이었다.

```text
1. 선택 영역으로 16비트 하늘 마스크 TIFF 를 만든다
2. 하늘 픽셀에 채널별 평면을 맞추고(MAD 로 이상치 3번 걸러냄)
   그 평면으로 지상부를 통째로 덮는다   →  "가상 하늘"
3. 그것을 GraXpert 에 넣는다             ←  여기가 CLI 와 동일
4. 결과를 하늘 영역에만 합성한다
```

**지상 풍경을 미리 지워서 그래디언트 모델이 산·나무에 끌려가지 않게 하는 것**이다.
"같은 프로그램을 부르니 같은 결과" 가 아니었다 — 무엇을 먹이느냐가 달랐다.

## 파일 통로 — 임시 패치에서 정식 API 로

처음에는 패널의 샘플 에디터 채널(`gradient_editor_command.json`)에 `run` 을
얹었다. 동작했지만 남의 채널에 끼어든 것이었고, **명령 파일이 남으면 패널을 다시
열 때 옛 명령이 한 번 더 실행되는** 문제를 미결로 남겼다. 실기에서 누른 적 없는
실행이 한 번 더 돌아 레이어가 하나 더 생겼다.

패널 작성자가 **External Automation API** 로 다시 만들었다(패널 저장소의
`docs/EXTERNAL_AUTOMATION.md`). 임시 패치는 버리고 그쪽에 맞췄다.

```text
%TEMP%/GraXpert_Photoshop/automation_command.json    요청
%TEMP%/GraXpert_Photoshop/automation_response.json   응답
%TEMP%/GraXpert_Photoshop/automation_status.json     상태 (1초마다 갱신)
```

임시 패치에 없던 것이 다 들어갔다.

| 임시 패치 | 정식 API |
|---|---|
| 샘플 에디터 채널에 얹음 | 별도 채널 — 샘플 포인트에 손댈 수 없다 |
| 기본으로 열려 있음 | **설정에서 켜야 한다**, 기본 꺼짐 |
| 옛 명령 재실행 (미결) | `createdAt` 10초 · 미래 5초 검사 |
| 호출자가 파일 삭제 | **패널이 소비하며 지운다** |
| 모르는 키 무시 | top-level·옵션 화이트리스트 |
| `accepted`/`reason` | `code` 로 기계 판별 |
| `batchSize` 아무 정수 | 1·2·4·8·16·32 |

**응답 파일은 모두가 공유하므로 `id` 로 가린다.** 실기에서 패널 배포판 JSX
액션이 쓴 `client: "PhotoshopAction"` 응답이 남아 있었다 — 그냥 읽었으면 남의
응답을 내 것으로 읽었다. 요청 `id` 가 에코되는 이유가 그것이다. 읽기 전에 파일을
지우지도 않는다 — 패널이 쓰는 중과 겹친다.

**상태는 명령을 보내지 않고 읽는다.** `automation_status.json` 을 패널이 1초마다
쓴다. 상태를 보려고 더미 명령을 보내면 `id` 를 태우고 `automation_disabled`
응답만 받는다. 파일이 5초보다 낡았으면 패널이 닫힌 것으로 본다 — 남은 값을 현재
상태로 보고하면 닫힌 패널을 열려 있다고 말하게 된다.

## 하늘은 사용자가 고른다

**패널은 하늘을 스스로 찾지 않는다.** 활성 선택 영역(없으면 활성 레이어의 마스크)을
하늘로 삼는다. "AI 자동" 은 GraXpert 의 배경 추출이 자동이라는 뜻이었다.

선택이 없으면 오류를 내지 않고 **말없이 일반 처리로 떨어진다.**

```js
if (skyAI && !maskToken) { skyAI = false; scope = "layer"; }
```

실기에서 그대로 걸렸다. Denoise 를 두 번 돌리는 사이 선택이 사라졌고, 그다음
그래디언트 제거가 12초 만에 "성공" 했다. 레이어도 생겼고 Job 도 completed 였다.

**유일한 단서는 레이어 이름이었다** — `GraXpert - AI Gradient` 로 끝나고
` - Sky Merged` 가 없었다. 그 접미사가 붙는 분기가 곧 `skyAI` 다.

처음에는 선택이 없으면 **거절**하게 했다. 그런데 정식 API 문서가 "선택이
없으면 활성 레이어 전체를 처리한다" 를 **의도된 동작으로 규정**했다. 막으면
멀쩡한 호출을 막는 것이 된다.

그래서 막지 않고 **어느 쪽으로 갔는지를 결과에 담는다** — `selectionAtStart` 와
`skyApplied` 다. `skyApplied` 는 설정값이 아니라 **결과 레이어 이름**으로
판정한다. 설정을 되읽으면 "AI 로 요청했다" 까지만 알 수 있다.

**문서가 나오기 전에는 소스를 읽고 "조용한 실패" 로 판단했는데, 작성자가 의도한
동작이었다.** 남의 코드에서 읽어낸 의도는 본인에게 확인할 수 있으면 확인한다.

선택을 **대신 만들지는 않는다.** 무엇을 하늘로 볼지는 이 Extension 이 정할 일이
아니다 — MilkyScape 에서 `create_sky_mask` 를 범위에서 뺀 것과 같은 판단이다.

## 즉시 알 수 있는 것은 Job 으로 미루지 않는다

처음에는 선택 검사를 Job 안에 뒀다. 그러면 `jobId` 를 받고 `job.status` 를 한 번
더 물어야 "선택이 없다" 를 안다. Command 한 번이면 알 수 있는 것이다.

반환 타입은 그대로 `jobId` 다 — 바뀌는 것은 실패 시점뿐이다. 성공 경로의 모양이
상황에 따라 달라지는 것과는 다른 이야기다.

## `sample` 방식은 열지 않았다

패널의 다른 방식은 사용자가 배경 포인트를 화면에서 찍는 작업이다. 미리보기를 보며
점을 옮기는 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다.

열어 두면 `sample` 을 준 호출이 포인트 없이 돌아 엉뚱한 결과를 낸다. 게다가 패널
라디오 값은 `AI` 와 `sample` 뿐이라, 없는 값을 주면 라디오가 전부 꺼지고
`selected() || "AI"` 로 **조용히 AI 로 되돌아간다.**

## 패널의 조용한 실패를 드러내는 패치

`setBusy` 가 `panelBusy` 를 켠 시각·라벨·호출 스택을 스스로 남기게 했다. 호출부는
하나도 건드리지 않는다 — `new Error().stack` 으로 알아낸다.

```text
거절 — Run 이 비활성화되어 있습니다.
  41초째 "Denoise 처리 중…"
  켠 곳: main.js:4516  <  main.js:2552
```

이것이 없었다면 `accepted: false` 만 보고 "진짜 처리 중이겠거니" 하고 넘어간다.
**오래 켜져 있는데 진행이 없으면 `setBusy(false)` 가 빠진 것**이고, 스택이 어느
경로인지 가리킨다.

## 실기 검증

Photoshop 27.8 · 4032×6048 16비트.

정식 API 로 옮긴 뒤 **실제 MCP 클라이언트**로 다시 통과시켰다.

```text
gx.status         panelRunning true · automationEnabled true · statusAgeMs 18
                  → 명령을 보내지 않으므로 즉시 답한다
gx.run_denoise    76초 · 레이어 44 · strength 0.4 그대로
selection.sky     bounds 0,0 4032,4510
gx.run_gradient   16초 · 레이어 48 "… - Sky Merged"
                  selectionAtStart true · skyApplied true
```

노이즈 감소가 2분을 넘는 경우가 있다 — Job 으로 감싼 이유 그대로다.

**`.mcp.json` 에 `PHOTOSHOP_MCP_ALLOW` 가 없어 `external` 이 막혀 있었다.**
이 저장소 설정으로는 `gx.*` 도 `milky.*` 도 `document.export` 도 부를 수 없었다 —
기본값이 실사용과 어긋나 있었다. `read,edit,external` 로 열었다. `destructive`
(덮어쓰기 · 평탄화 · 액션 실행)는 그대로 닫아 둔다.

## 체크리스트

- [x] 액션으로 안 되는 이유를 **재서** 확인했다 — 짐작하지 않았다
- [x] CLI 와 패널의 차이를 소스로 확인했다 — 엔진이 아니라 입력이다
- [x] 액션으로 안 되는 이유를 재서 확인 — 짐작하지 않았다
- [x] `setBusy` 자기 기록 — 조용한 busy 를 드러낸다 (정식 API 에도 남았다)
- [x] 임시 패치를 버리고 **정식 External Automation API** 로 옮겼다
- [x] 응답을 `id` 로 가린다 — 다른 클라이언트의 응답을 읽지 않는다
- [x] 상태는 `automation_status.json` 으로 — 명령을 보내지 않는다
- [x] 자동화 꺼짐·패널 닫힘은 **Job 앞에서** 즉시 실패
- [x] `gx.status` · `gx.run_gradient` · `gx.run_denoise`
- [x] 긴 작업은 Job — 실기 75초 · 2분 초과 사례
- [x] `skyApplied` 를 레이어 이름으로 확인 — 요청값이 아니라 실제값
- [x] 선택이 없어도 막지 않는다 — 문서가 규정한 정상 경로다
- [x] `sample` 은 통로에 없다 — 사람이 화면 보며 하는 일
- [x] `tests/graxpert.test.ts` 28개 — 스키마 · 상태 판정 · 거절 안내 · 권한
- [x] 경로를 주입 가능하게 — 테스트가 **진짜 패널을 건드리지 않는다**
- [ ] `automation_status.json` 이 패널 문서에 빠져 있다 — 작성자에게 알렸다

---

# 17.38 조정 레이어를 고칠 수 없었다 — `presetKind`

## 만드는 것만 확인했다

실기 보정 중에 채도를 다시 만지려다 드러났다. 우리가 만든 조정 레이어를
클릭해도 **Photoshop 속성 패널에 슬라이더가 뜨지 않는다.** 레이어는 생기고
보정도 적용되는데, 값을 고칠 수가 없다.

**조정 레이어를 쓰는 이유가 바로 그것인데** 한 번도 확인한 적이 없었다.
`layer.list` 가 `adjustmentType: "hueSaturation"` 을 돌려주고 측정값도
바뀌니 다 된 줄 알았다. 문서에도 "언제든 되돌리거나 고칠 수 있다" 고
여러 번 적었다.

## 짐작하지 않고 잡았다

사람이 색조/채도 조정 레이어를 만들 때 Photoshop 이 쓰는 descriptor 를
`addNotificationListener(["all"])` 로 받았다(§17.17).

```js
using: { _obj: "adjustmentLayer", type: {
  _obj: "hueSaturation",
  presetKind: { _enum: "presetKindType", _value: "presetKindDefault" },   // 없었다
  GeneratedPreset: false,                                                 // 없었다
  colorize: false
}}
```

**`presetKind` 가 없으면 속성 패널이 조정 UI 를 열지 못한다.**

우리 소스 전체에 이 키가 한 번도 없었다 — 곡선 · 레벨 · 밝기대비 ·
색조채도 · 활기 · 컬러밸런스 **여섯 종류가 전부** 편집 불가로 만들어지고
있었다.

`makeAdjustmentLayer` **한 곳**에 넣는다. 타입마다 넣으면 새로 추가하는
것이 빠뜨린다. 호출자가 이미 넣었으면 덮지 않는다.

값은 `presetKindCustom` 이다. Photoshop 이 기본값으로 만들 때는
`presetKindDefault` 를 쓰지만 우리는 언제나 값을 지정해 만든다.

## 실기 검증

고친 뒤 MCP 로 만든 레이어가 Photoshop 이 만든 것과 똑같이 열린다.

```text
사전 설정: 사용자 정의
색조   0
채도  −30      ← 요청한 값이 슬라이더에 그대로
밝기   0
```

## 남은 것

선택 영역으로 마스크를 붙이면 **마스크 쪽이 선택된 채로 남는다.** 그래서
슬라이더를 보려면 조정 축소판을 한 번 더 눌러야 한다. Photoshop 이 직접
만들면 조정 쪽이 선택된다.

## 체크리스트

- [x] descriptor 를 `["all"]` 로 잡았다 — 짐작하지 않았다
- [x] `makeAdjustmentLayer` 한 곳에 넣어 여섯 종류가 함께 고쳐진다
- [x] 실기 검증 — 슬라이더가 열리고 값이 그대로 보인다
- [ ] 생성 직후 조정 쪽을 선택한다 — 마스크가 선택된 채로 남는다
- [ ] 곡선 · 레벨 · 밝기대비 · 활기 · 컬러밸런스도 실기 확인
      (같은 공장 함수를 쓰지만 **"거의 확실" 로 넘어간 것이 이 버그의 원인이었다**)

---

# 17.39 `luminosity` 에는 조건이 있다

§17.16 은 "합성 채널에 톤 곡선을 걸면 채도도 같이 오른다 → `luminosity` 로"
라고만 적혀 있었다. **조건이 빠져 있었다.**

실기에서 하늘 스트레치에 그대로 적용했더니 사용자가 "은하수 색이 완전
빠졌어" 라고 했다. `luminosity` 는 **원본의 채도 비율을 잠근다.** 원본
은하수 채도가 18% 였으니 아무리 밝게 늘려도 그 비율을 벗어나지 못한다.

`normal` 로 바꾸니 곡선이 채널별로 걸려 R 이 더 가파른 구간을 지나고
채도가 51% 까지 올랐다. 거기서 필요한 만큼 내리는 것이 순서다 —
**스트레치로 채도를 만들고 과하면 뺀다.** 반대로 하면 만들 수가 없다.

```text
캐스트가 있다   → luminosity   증폭을 막는다     (전경: 눈 위 R−B −7.1)
색이 깨끗하다   → normal        채도를 만든다     (하늘: 배경 R−B +0.3)
```

같은 사진 안에서 하늘은 `normal`, 전경은 `luminosity` 가 맞았다.

**그리고 나는 세 번 연속 숫자로 "괜찮다" 고 보고했다.** `R−B 유지됨` 을
좋은 신호로 읽었는데 그건 **채도가 갇혀 있다는 신호**였다. 비율은 맞는데
눈이 보는 절대 색은 빠지고 있었다.

---

# 18. Phase 14 — Distribution

검토 대상:

```text
MCP Server Installer

Photoshop UXP Plugin Installer

Extension Package

Configuration UI      ← 첫 슬라이스 완료. 아래 참조
```

# 19. GraXpert 를 CLI 로 바꿨다

§17.37 에서 GraXpert Photoshop 패널을 External Automation API 로 구동했다.
**전제가 둘이었고 둘 다 사람만 할 수 있었다** — 패널을 열어 두는 것과 패널
설정에서 `Allow External Automation` 을 켜는 것.

LLM 이 `gx.run_gradient` 를 부르면 전제가 안 갖춰졌을 때 정확한 이유를 받지만,
**그 다음에 할 수 있는 일이 없었다.**

## 여는 것을 자동화할 수 있는지 재 봤다

`startNotifications(["all"])` 로 듣는 동안 손으로 패널을 열었다.

```text
command.started              40
command.completed            40
photoshop.unknown           120
  modalJavaScriptScopeEnter  40
  modalJavaScriptScopeExit   80
```

**전부 우리 Command 가 만든 것이다.** 패널이 남긴 흔적은 0 이다. descriptor 가
없으니 액션으로 녹화할 수도 재생할 수도 없다 — §17.37 이 "패널 조작은 녹화할
것이 없다" 고 한 것과 같은 이유다.

### 측정을 결론으로 삼기 전에 패널이 정말 열렸는지 확인했다

확인하지 않고 "알림이 안 온다" 로 갈 뻔했다. 게다가 상태 파일을 `%TEMP%`
바로 아래에서 찾아 없길래 **"Allow External Automation 이 꺼져 있다" 고 잘못
결론냈다.** 실제 경로는 `%TEMP%/GraXpert_Photoshop/` 하위였다.

전날 세 번 겪은 것과 같은 실수다 — **재 보지 않은 것을 관측으로 삼는 것.**

## "CLI 로 대체되지 않는다" 는 틀렸다

근거는 패널이 **지상부를 합성 평면으로 덮은 뒤** 넣는다는 것이었다. 지상 풍경이
든 사진에서 산·나무가 배경 모델을 끌어당기기 때문이다.

그건 **패널이 대신 해 주던 판단**이지 CLI 가 못 하는 일이 아니었다.

## 하늘 격리는 호출자가 판단한다

```text
document.statistics   격리가 필요한지 잰다
selection.sky         하늘을 고른다
gx.run_gradient       활성 레이어 전체를 처리한다
mask.create           결과를 하늘에만 씌운다
```

흐름을 Tool 안에 박으면 **호출자가 그 결정을 못 바꾼다.** 어떤 사진은 격리가
필요 없고, 어떤 사진은 하늘 선택을 손으로 다듬어야 한다. 조각은 이미 다 있다.

## 잃은 것 — 노이즈 감소 강도

`GraXpert.exe -h` 에 `-cmd denoising` 용 플래그가 **하나도 없다.**
`-smoothing`·`-correction` 은 배경 추출 전용이다. `-preferences_file` 로는 줄 수
있지만 Extension 은 승인된 작업 폴더 밖에 파일을 쓸 수 없다(§8.5).

**없는 파라미터를 스키마에 두고 조용히 무시하느니 뺐다.** 강도가 필요하면
`rcastro.nxt` 나 `camera_raw.apply` 쪽이다.

## 하늘 격리를 되살린다

실기에서 **전체 이미지로 돌리면 결과가 원본과 눈으로 구분되지 않았다.**
지상 풍경이 프레임에 있으면 산·나무가 배경 모델을 끌어당긴다 — 패널이
지상부를 덮던 이유가 맞았다.

`-preferences_file` 로 하늘에만 샘플 포인트를 주는 길도 재 봤다. **된다** —
CLI 로 두 번 돌려 표본 207,850개 중 99.9%가 달랐다(최대 차이 0.155). 다만
로그가 `interpolation type - RBF` 를 찍는다. **AI 배경 추출을 끄는 것**이라
쓰지 않는다.

그래서 패널이 하던 방식을 옮긴다 — 패널의 `sky-fill.js` 70줄이다.

```text
1. 하늘 픽셀을 16×16 타일로 표본 추출 (타일마다 중앙값)
2. 채널마다 1차 평면 a + b·x + c·y 를 적합 · MAD 로 이상치 3회 제거
3. 표본 범위 ±패딩으로 값을 가둔다
4. 지상 픽셀을 그 평면 값으로 바꾼다 (마스크 가중치로 섞는다)
```

**단색이 아니라 하늘의 기울기를 지상까지 연장한 평면**이다. 그래서 AI 가
경계를 구조로 읽지 않는다.

### 막힌 곳은 마스크였다

이 모듈은 원본 TIFF 와 **하늘 마스크 TIFF** 를 받는다. 마스크가 파일로 나가는
길이 없었다 — `selection.capture` 는 축소본이고 `selection.save_channel` 은
문서 안에만 남는다.

`photoshop.selection.export_mask` 를 만들었다(`external`). 복제본에서 전체를
검게 칠하고 선택 안만 희게 칠한 뒤 16비트 TIFF 로 저장한다. **선택은 복제본으로
따라간다는 보장이 없어** 임시 알파 채널에 저장한 뒤 복제한다 — 채널은 따라간다.

**형식을 고르게 하지 않는다.** 읽는 것이 사람이 아니라 외부 처리 코드이고
16비트 TIFF 하나만 지원한다. 고를 수 있게 두면 png 로 내보낸 뒤 "왜 안 되지"
가 된다.

**선택이 없으면 실패한다.** 전부 검정인 마스크를 돌려주면 외부 처리기가
"하늘이 하나도 없다" 로 읽는다.

## 체크리스트

- [x] 패널 열기가 알림을 남기는지 실기 측정 — 남기지 않는다
- [x] 측정 전에 패널이 실제로 열렸는지 확인
- [x] Provider 둘 — `graxpert`(gradientRemoval) · `graxpert-denoise`(noiseReduction)
- [x] 각 Tool 이 `provider` 를 못 박는다 — `noiseReduction` 은 `rcastro.nxt` 도 준다
- [x] `panel.ts` 281줄 삭제 · `gx.status` 제거
- [x] `tests/graxpert.test.ts` 18개 — 패널 IPC 를 재던 것은 대상이 사라졌다
- [x] 실기 검증 — `export(tiff,16) → GraXpert CLI → FITS→TIFF → place` 가 끝까지 돌았다
- [x] `photoshop.selection.export_mask` — 하늘 마스크를 파일로
- [x] `sky-fill` 을 서버로 옮긴다 (평면 적합 + 지상 치환)
- [x] `CapabilityRequest.prepare` — 입력 준비. `convert` 의 짝이다
- [x] `gx.run_gradient` 가 선택이 있으면 그 경로를 탄다
- [x] 하늘 경로 실기 검증 — 선택 → 마스크 → 평면 덮기 → AI → 배치 → 마스크
- [x] `photoshop.mask.apply` — 마스크를 픽셀에 굽는다 (`DESTRUCTIVE`)
- [x] `CapabilityRequest.finish` — `restoreOutsideMask`. `prepare` 의 짝이다
- [x] 결과가 마스크 없는 통짜 픽셀 레이어 한 장이다
- [x] 실기: 결과 레이어에 마스크가 없다 — 통짜 픽셀 한 장
- [x] 실기: 같은 사각형 전후 측정 — 폭 R 30.3→17.9 · σ 세 자리까지 보존

### 실기에서 두 번 막혔다

**① 마스크가 4채널로 나왔다.** 선택을 복제본으로 옮기려고 만든 임시 알파
채널이 TIFF 에 함께 실렸다. 임시 채널만 지우는 것으로는 부족하다 — 사용자
문서에 알파 채널이 있으면 같은 일이 난다. 읽는 쪽이 채널 3개 이상을 받아
앞의 셋만 읽게 고쳤고, 쓰는 쪽은 언제나 3채널로 낸다.

**② 결과가 770px 위로 밀렸다.** `place` 는 캔버스가 아니라 **활성 선택 영역의
중심**에 놓는다.

```text
selection:0,-770,4032,5278
높이 5278 − (−770) = 6048      크기는 맞다. 위치만 틀렸다
놓인 중심 −770 + 3024 = 2254   하늘 선택의 중심이다
```

**짐작을 세 번 하고 나서야 쟀다.** 해상도 태그 누락이라고 했다가 틀렸고
(패널 변환기도 그 태그를 안 쓴다), 파일이 잘렸나 했다가 바이트 수가 정확히
맞는 것을 보고 아니었고, `selection.capture` 의 `source` 를 재고서야 위치
문제인 것을 알았다.

`starnet`·`rcastro` 도 같은 문제를 안고 있었다 — 선택 없이 돌려서 우연히
맞았을 뿐이다. `layer.place` 에서 고쳤으므로 셋 다 함께 고쳐졌다.

변환 경로가 실기에서 처음 지나갔다. 테스트는 `outputSuffix`·`convert` 를 빼고
Extension 의 흐름만 재므로(그쪽은 `fits.test.ts` 가 따로 잰다) 이 조합은
여기서 처음 붙었다.

**"레이어가 생겼다" 를 "그래디언트가 제거됐다" 로 읽지 않는다.** 효과는
`document.statistics` 로 따로 잰다.

### 마스크로 씌웠다가 되물렸다

처음에는 결과를 그대로 배치하고 `mask.create fromSelection` 을 걸었다. 합성
화면은 맞았다. 그리고 `photoshop.mask.apply` 를 Core 에 더해 그 마스크를
픽셀에 굽게 했다 — 가려진 쪽에 우리가 덮어 넣은 합성 평면이 남아 있어
마스크를 끄면 드러나기 때문이다.

**첫 측정에서 걸렸다.**

```text
document.statistics  layer:16
pixels     18,172,224 = 4032 × 4507     캔버스는 4032 × 6048
mean L     72.99   p95 82.4
```

`pixels` 가 줄어든 것은 굽기가 동작했다는 증거였다. 그런데 **그 평균을 믿을 수
없었다** — `document.statistics` 는 알파를 안 보고 RGB 만 읽는다. 경계 상자
안에서 능선이 파고든 투명한 곳이 0 으로 섞여 평균을 끌어내린다. 얼마나
섞였는지는 이 숫자만으로 가려지지 않는다.

첫 번째 후속 작업이 바로 그것이었다. **투명한 레이어는 뒤따르는 Tool 마다
걸린다.**

### 합성을 파일에서 끝낸다

`prepare` 의 짝으로 `finish` 를 더했다.

```text
prepare: extendSkyPlane      들어갈 때  지상을 하늘의 연장 평면으로 덮는다
finish:  restoreOutsideMask  나올 때    그 가짜를 원본 지상으로 되돌린다
```

둘이 짝이라 언제나 함께 간다. 마스크 값으로 섞으므로 **페더된 선택이 그대로
부드러운 이음매**가 된다 — `fillGroundWithSkyPlane` 이 덮을 때 쓰는 방식과 같다.

결과는 **마스크 없는 통짜 픽셀 레이어 한 장**이다. 뒤따르는 Tool 이 아무것도
몰라도 된다. Photoshop 마스크를 쓰지 않으므로 `gx.run_gradient` 는 `external`
그대로다.

변환 **뒤에** 건다 — GraXpert 는 FITS 를 내므로 그 전에는 읽을 수 없다. 주
출력에만 건다 — 추가 출력(별 이미지 등)은 의미가 다르다. 합친 것으로 요청한
이름을 덮어써서 중간 파일을 남기지 않는다.

### `photoshop.mask.apply` 는 남겼다

만든 계기는 사라졌지만 Tool 자체는 맞다. CORE_API §9 가 처음부터
`DESTRUCTIVE` 로 분류해 둔 것이고 분류를 그대로 따랐다 — 마스크는 가리기만
하므로 끄면 되살아나지만, 구우면 가려진 픽셀이 실제로 없어진다.
`document.flatten` 과 같은 종류의 손실이다.

descriptor 는 `{ _obj: "delete", _target: channel/mask, apply: true }` 다.
**`apply: false` 면 마스크를 그냥 버린다** — 가려 둔 것이 되살아난다. 기본값에
기대지 않고 명시한다.

### 실기 확인 — 재 보니 σ 가 세 자리까지 같았다

하늘 안쪽 사각형 하나를 정해 전후로 쟀다. 전체 문서로 재면 지상이 섞여 하늘의
변화가 묻힌다 — 실제로 문서 전체에서는 R−B 가 **양수**였는데 하늘만 재니
음수였다. 붉은 쪽이 하늘이 아니라 지상이었다.

```text
사각형 100,100,3932,4407 (3832×4307)      전 → 후

            R              G              B
p50      56.9 → 73.4    64.0 → 70.9    66.7 → 70.2
p95      87.2 → 91.3    91.2 → 81.2    88.1 → 78.1
폭       30.3 → 17.9    27.2 → 10.3    21.4 →  7.9
σ        .530 → .530    .538 → .538    .547 → .547
```

**σ 가 소수점 셋째 자리까지 세 채널 전부 같다.** `correction: Subtraction` 은
매끄러운 모델을 빼기만 하므로 이웃 픽셀 간 차이가 그대로 남는다 — σ 는 그
차이의 중앙값이라 보존되는 것이 맞다. 우연이 아니라 방식의 결과다.

**폭만 줄고 σ 는 그대로** = 큰 스케일의 변화만 걷어냈다는 뜻이고, 배경 추출이
해야 할 일이 정확히 그것이다. 다만 σ 는 **큰 스케일의 진짜 구조**(은하수 ·
지평선 빛)가 함께 깎였는지는 못 잡는다. 그건 눈으로 봐야 한다.

### 백분위 차이로 공간 분포를 재려 한 것은 틀렸다

"R−B 가 밝기에 따라 변하면 그래디언트가 남은 것" 이라고 적었는데 **성립하지
않는다.** 처리 후 R 의 폭이 17.9, B 가 7.9 로 채널 대비가 다르면, 공간적 색
편차가 0 이어도 R−B 는 밝기에 따라 커진다.

가르려면 **하늘의 서로 떨어진 두 영역을 각각 재서** R−B 를 비교한다.

```text
같다   →  균일한 캐스트.  camera_raw temperature · tint
다르다 →  그래디언트 잔여. smoothing 을 올려 한 번 더
```

지표를 세울 때 **그 지표가 재려는 것을 정말 재는지** 먼저 확인한다.

### 여기서 배운 것

**"화면이 맞다" 를 "다음 작업이 된다" 로 읽지 않는다.** 마스크 경로는 눈으로
완벽했고 측정 한 번에 무너졌다. 새 Command 를 만들 때 되돌리는 경로까지
확인한다는 규칙(§17.38)의 확장이다 — **이어지는 경로까지** 확인한다.
---
## 18.0 준비는 끝났고 publish 는 보류한다

점검해 보니 **기술적 장애물은 하나였다** — `uxp plugin package` 가 아이콘이
없어 막혔다. 나머지는 전부 결정이었다.

```text
배포 단위   A(6개 publish)로 정했다 — 번들은 extension-api 가 사라진다
이름        bin 을 가진 패키지가 무스코프 `photoshop-mcp` 를 갖는다
LICENSE     MIT
아이콘      임시본으로 .ccx 가 나오는 것까지 확인했다 (441KB)
```

### 그런데 지금 올릴 이유가 없다

```text
두 번째 사용자가 있나          없다
남이 Extension 을 만들려 하나   아직 없다
지금 못 하고 있는 일이 있나     없다
```

**publish 는 문을 닫는다.** 오늘 하루 `extension-api` 의 의존, `photoshop-bridge`
를 가를지, Command 이름을 상수로 둘지를 따졌고 결론은 전부 "지금은 그대로"
였다. 그 결론이 유효한 이유가 **아직 안 올렸기 때문**이다. 올리는 순간 패키지
이름과 경계가 공개 API 가 되고 미뤄 둔 것들이 breaking change 가 된다.

### GitHub 공개가 먼저다

```text
                   GitHub 공개     npm publish
남이 쓸 수 있나      된다            된다
이름이 잠기나        아니다          잠긴다
경계를 바꿀 수 있나   된다            breaking change
버전 규율            불필요          필요
```

**낮은 비용에 값의 대부분을 준다.** 클론하거나 `npm i github:...` 로 쓴다.
쓰는 사람이 생기면 그때 publish 하고, 그때 이름과 경계가 굳어도 된다.

공개 전 훑은 것 — 추적 파일 313개에 비밀값 0, 로컬 절대 경로 3곳(맥락이 붙은
것), 이메일 0. `capabilities.json` · `*.psd` · `testimage/` 는 이미
`.gitignore` 에 있다.

### 버전은 0.1.0 그대로 둔다

npm 에 안 올리므로 버전이 뜻을 갖는 곳이 없고, **semver 0.x 가 "바뀔 수 있다"
를 말한다** — 패키지 경계를 열어 두기로 한 결정과 정확히 맞는다. `1.0.0` 은
경계를 안 바꾸겠다는 약속인데 우리는 반대로 정했다.

13개 Phase 를 지나며 `0.1.0` 인 것이 어색해 보이지만 **semver 는 성숙도가
아니라 호환 약속**이다. 아직 아무에게도 약속한 적이 없다.

**버전이 15곳에 박혀 있다.** `npm version --workspaces` 는 `package.json` 만
고치고 나머지는 따라오지 않는다.

```text
photoshop-uxp/manifest.json          플러그인 버전
photoshop-uxp/src/index.ts  PLUGIN   핸드셰이크로 서버에 간다
protocol/server-info.ts  SERVER_VERSION  핸드셰이크 응답
package.json 12개의 내부 의존 핀       어긋나면 설치가 깨진다
```

`tests/version-sync.test.ts` 가 묶는다. 네 곳을 각각 어긋내 보고 전부
깨지는 것을 확인했다. `PROTOCOL_VERSION` 은 숫자라 섞이지 않는다 — 메시지
규약이 바뀔 때만 오르고 제품 버전을 따라가지 않는다.

### 남은 것

```text
npm publish          쓰는 사람이 생길 때
.ccx 전달 경로       건네줄 사람이 생길 때 (서명·Exchange·개발자 모드)
패키징에 src 포함     uxp plugin package 가 폴더를 통째로 압축한다
                     제외 옵션이 없어 스테이징 폴더가 필요하다
```

---
## 18.1 설정 UI 는 UI 가 아니었다

"Configuration UI" 를 어떻게 만들지 보려고 **설정이 실제로 어디 있는지**부터
세었다.

```text
① MCP 클라이언트 설정 (env)   .mcp.json · Claude Desktop json · VS Code
                              우리가 안정적으로 쓸 수 없는 남의 파일
② capabilities.json           서버 cwd · 기기마다 다름 · gitignore
③ workflows.json              서버 cwd
④ 플러그인 localStorage        작업 폴더 승인 · 액션 허용 목록
                              ← 이미 UI 가 있다 (§8.5 · §17.36)
```

**④ 는 끝나 있었고 거기엔 이유가 있다.** 사용자만 할 수 있는 일이고 플러그인은
서버 cwd 에 쓸 수 없다. 반대로 ②는 서버가 실행하는 프로그램의 경로라 플러그인이
알 바가 아니다. 이 경계는 §17.36 에서 이미 정리됐다.

그래서 새 UI 가 더할 수 있는 것은 **②뿐**이고, ①은 스니펫을 뽑아 주는 것까지다.

## 웹 설정 UI 를 만들지 않았다

서버가 stdio 로 뜨고 **클라이언트마다 별개 프로세스**다. 포트를 하나 더 열면
오늘 겪은 것이 그대로 난다.

```text
listen EADDRINUSE: address already in use 127.0.0.1:8765
```

듣는 포트를 늘리는 것은 §23 이 좁혀 온 방향과 반대이고, 서버는 클라이언트가
끄면 같이 죽으니 **설정하러 열어 둘 수도 없다.**

## 정보는 이미 있었다. 볼 자리가 없었을 뿐이다

`.mcp.json` 권한 누락(§17.37)은 `photoshop.diagnostics` 가 **이미 말하고
있었다.**

```text
"external 권한이 없어 파일 저장·외부 처리기·가져오기를 쓸 수 없습니다.
 PHOTOSHOP_MCP_ALLOW 에 external 을 넣으세요."
```

정보가 없어서가 아니라 **아무도 안 봐서** 못 찾았다. UI 를 만들어도 안 열어보면
같다. 그래서 만든 것은 UI 가 아니라 **볼 자리 셋**이다.

## 기동 시 한 줄

서버가 뜰 때 막힌 것이 있으면 stderr 에 낸다. 로그는 조용한 것이 기본이지만
**실패는 디버그가 아니어도 남긴다**는 규칙이 이미 있다.

```text
[photoshop-mcp] 막힘 3건: external 권한 · destructive 권한 · 외부 처리기 미설정
[photoshop-mcp]   고치는 방법은 photoshop.diagnostics 를 부르면 나옵니다
```

**짧은 이름만 나열한다.** 처음에는 설명을 통째로 냈는데 네 줄이 됐다 — 기동마다
그러면 사람이 안 읽게 되고, 그러면 이 줄을 넣은 이유가 사라진다.

`connected` 는 `null` 로 준다. Bridge 는 서버가 뜬 뒤에 붙으므로 이 시점의
"연결 안 됨" 은 정상이다. 그것까지 내면 정상 기동마다 경고가 뜬다.

## `photoshop-mcp doctor`

`diagnostics` 는 **MCP 클라이언트가 붙은 뒤에야** 부를 수 있다. 설치 중에
막히면 그 시점에는 클라이언트가 없다.

```text
[OK  ] Node         v22.21.1
[주의] Bridge 포트    8765 을 이미 쓰고 있습니다...
[OK  ] 외부 처리기    3개 선언, 실행 파일 모두 있음
[OK  ] Extension    example(2) · gx(3) · milky(5)
[주의] 권한          PHOTOSHOP_MCP_ALLOW 가 이 셸에 없습니다...
```

**선언만 보지 않는다.** 실행 파일이 실제로 있는지 확인하고, Extension 은 Mock
Bridge 로 **실제로 적재해 본다** — 선언만 보면 import 실패를 놓친다.

**터미널의 doctor 는 MCP 클라이언트가 넘길 env 를 모른다.** `.mcp.json` 의
`env` 는 클라이언트가 서버를 띄울 때만 적용된다. 그래서 권한은 "지금 이렇다" 가
아니라 **"이렇게 넣으세요"** 로 낸다. 이 구분을 흐리면 doctor 가 통과했으니
됐다고 믿게 된다.

판정은 `listBlockers()` 하나만 쓴다. 두 벌을 만들면 `diagnostics` 와 doctor 가
다른 말을 하게 되고, 그때 어느 쪽을 믿어야 할지 알 수 없다.

## `photoshop-mcp init`

`capabilities.json` 은 `.gitignore` 에 있어 **클론한 사람에게는 처음부터
없다.** 알려진 설치 경로를 훑어 **실제로 있는 것만** 쓴다.

**없는 처리기를 example 에서 가져다 넣지 않는다.** 있는 것처럼 보이는 설정은
`capability.list` 에 이름만 올리고 쓸 때 실패한다.

**이미 있으면 덮어쓰지 않는다.** 손으로 고친 경로가 들어 있을 수 있고, 그것을
말없이 날리는 것이 이 프로젝트에서 가장 나쁜 실패다.

## 테스트에서 또 같은 것을 밟았다

처음에 가짜 홈만 주고 `C:/Program Files` 는 상수로 두었다. **이 기계에
StarNet2 와 BXT 가 실제로 깔려 있어** 격리된 것처럼 보이지만 아니었다 —
`graxpert` 테스트가 진짜 패널을 건드릴 뻔한 것과 같은 실수다(§17.37).

검색 뿌리를 전부 주입하게 바꿨다. **"바깥을 보는 기본값" 이 있으면 테스트는
기계를 따라 달라진다.**

## 체크리스트

- [x] 설정이 어디 있는지 먼저 세었다 — ④는 이미 UI 가 있었다
- [x] 웹 설정 UI 를 만들지 않는다 — 포트·수명이 stdio 와 맞지 않는다
- [x] 기동 시 막힘 한 줄 (짧은 이름만)
- [x] `photoshop-mcp doctor` — 실행 파일 존재 · Extension 실제 적재 · 종료 코드
- [x] `photoshop-mcp init` — 찾은 것만 · 덮어쓰지 않음
- [x] 판정은 `listBlockers()` 하나 — `diagnostics` 와 같은 말을 한다
- [x] 검색 뿌리를 주입 가능하게 — 테스트가 기계를 따라 달라지지 않는다
- [x] `tests/doctor.test.ts` 14개
- [x] MCP 클라이언트 설정 스니펫 — **고칠 것이 있을 때만** 낸다
- [x] 번들 Extension 을 고를 수 있게 — `PHOTOSHOP_MCP_EXTENSIONS_ENABLED`
- [ ] Installer · Extension Package — §18.3 으로 방향이 잡혔다

## 18.3 Extension 은 설치된 것만 붙는다

어제는 "두 번째 사용자가 생기면" 으로 미뤘는데, **그 요구가 바로 생겼다.**

> 사용자가 패널을 설치 안 하고 쓰는 게 기본이야.
> GraXpert 설치할 때 별도 툴로 추가하는 방식으로 하면 어떨까?

맞는 지적이다. 저장소에 `graxpert` 가 들어 있으면 **GraXpert 를 안 쓰는 사람에게도**
`gx.*` 세 개가 Tool 목록에 보인다. 쓸 수 없는 Tool 이고, 무엇이 이 서버의 능력인지
흐린다. §18.2 에서 끄는 스위치를 만들었지만 **기본이 "들어 있음" 인 것이 틀렸다.**

```text
기본            Extension 0개. Core Tool 161개만
GraXpert 설치   패널 설치 관리자가 extension 폴더를 함께 놓는다
등록            PhotoshopMCP 패널에서 사용자가 고른다
패널 제거       Tool 도 함께 사라진다 — 짝이 맞는다
```

### 한동안 추가만 했다

위 표의 마지막 줄은 **한동안 사실이 아니었다.** 서버는 `connected` 마다 목록을
다시 묻지만 `loadedFromPanel` 로 **이미 적재한 것을 건너뛸 뿐 해제하지 않았다.**
실기에서 `starnet` 을 빼고 Bridge 를 다시 붙였는데 `starnet.remove_stars` 가
그대로 남아 있었다. 문서가 먼저 있었고 구현이 절반이었다.

`planPanelExtensionSync` 로 맞춘다. 무엇을 적재하고 무엇을 해제할지는 순수
함수가 정하고 `start.ts` 는 그대로 따른다 — **제거 경로가 사용자가 패널에서
버튼을 누를 때 처음 실행되는 일이 없도록** 떼어 두었다.

세 가지가 걸려 있다.

**패널을 거쳐 적재한 것만 해제한다.** `PHOTOSHOP_MCP_EXTENSIONS` 로 자동 적재한
것은 패널 목록에 없는 것이 당연하다. 그것까지 해제하면 설정으로 켠 Extension 이
**Photoshop 이 붙는 순간** 사라진다 — 붙어서 좋아질 줄 알았는데 없어진다.

**끝의 구분자를 무시한다.** `...\starnet` 과 `...\starnet\` 이 다른 것으로
읽히면 매 연결마다 해제하고 다시 적재하는 왕복이 생긴다. 대소문자는 건드리지
않는다 — Windows 만 구분하지 않고, 여기서 그것을 가정하면 다른 곳에서 틀린다.

**Job 이 돌고 있으면 미룬다. 취소하지 않는다.** Job 은 이미 `owner` 를 들고
있으므로 물어볼 수 있다. 패널에서 버튼 하나 눌렀다고 70초짜리 외부 처리기를
죽이는 것은 과하다 — 그 결과를 기다리는 사람이 있고, 취소하면 중간 파일만
남는다. 미뤄도 잃는 것이 없다. 다음 연결에서 다시 본다.

`unload` 자체는 이미 있었고 deactivate · Tool · Resource · 이벤트 구독까지
되돌린다. 없던 것은 **부를 자리**였다.

정규식에서 역슬래시 하나가 빠진 채로 커밋될 뻔했다. 잡은 것은 단위 테스트다 —
`normalizeExtensionPath` 를 따로 떼어 두지 않았으면 Windows 경로에서만,
그것도 사용자가 제거 버튼을 누를 때 드러났다.

실기로 확인했다. MCP 클라이언트는 다시 연결하지 않았다.

```text
패널에서 starnet 제거 → 플러그인 재적재(Bridge 재연결) → diagnostics

registry.tools   85 → 84
extensions       gx · rcastro          starnet 해제됨
jobs             completed: 1          종료된 Job 은 막지 않는다
```

마지막 줄이 가드가 옳게 동작한 증거다. 직전에 돌린 별 분리 Job 이 저장소에
남아 있었는데 종료 상태라 해제를 막지 않았다. `isTerminal` 로 거르지 않았으면
**한 번이라도 Job 을 돌린 Extension 은 영영 해제되지 않는다.**

**순서를 틀리면 아무 일도 안 일어난다.** 패널에서 빼는 것만으로는 서버가 모른다 —
서버로 밀어 주는 통로가 없고 `connected` 에 묻기 때문이다. 실기에서 제거하고
바로 호출해 "아직 있다" 를 볼 뻔했다. 대화상자 안내문이 "MCP 서버를 다시
연결해야" 라고만 말하는 것도 이제는 부정확하다 — **Photoshop 플러그인이 다시
붙기만 해도 된다.**

## 다른 MCP 클라이언트에서 실기 검증 (VS Code Copilot Chat)

Claude Code 하나로만 확인해 왔다. **클라이언트마다 달라지는 것 셋**을 다른
클라이언트로 통과시켰다. 서버는 PID 를 유지한 채였다.

```text
① 이미지 content block   document.capture      ✅  모델이 사진 내용을 묘사했다
② tools/list_changed     example 패널 등록      ✅  재연결 없이 example.hello 호출 성공
③ 60초 타임아웃          starnet.remove_stars  ✅  jobId 즉시 · -32001 없음
```

②는 **추가 방향으로만 시험된다** — 위에 적었듯 제거는 반영되지 않는다.
지금 안 올라와 있는 Extension 이 필요해서 `example` 을 썼다.

### 도구 목록을 물으면 안 된다

처음에 "쓸 수 있는 도구를 보여줘" 라고 물었더니 `example.*` 이 포함된 답이
왔다. **그때 `example` 은 적재된 적이 없었다** — 모델이 저장소를 읽고 답한
것이다. `tools/list` 를 조회한 것이 아니다.

**호출은 지어낼 수 없다.** 도구 목록을 확인할 때는 목록을 묻지 말고 부르게 한다.

### 빈 문자열은 클라이언트를 못 넘는다

§18.2 에 적은 그 버그가 여기서 나왔다. 이 검증이 아니었으면 못 봤다.

### 모델이 도구 호출을 못 하면 서버는 멀쩡해도 아무것도 안 된다

`MAI-Code-1.1-Flash` 와 로컬 `qwen3.8:27b` 에서 호출이 되지 않았다. 후자는
`Sorry, no response was returned` 로 끝났다 — **도구 85개의 스키마만으로
컨텍스트가 찬 것**으로 보인다.

서버 쪽을 한참 뒤졌지만 원인이 아니었다. 같은 서버에 모델만 바꿔 통과했다.
**도구 개수가 클라이언트 쪽 제약이 된다** — 번들 Extension 을 기본으로 끈
설계(§18.2)에 이유가 하나 더 붙는다.

## 어제 "SDK 를 먼저 공개해야 한다" 고 한 것은 과했다

Extension 을 워크스페이스 밖에 두면 `@photoshop-mcp/extension-api` 해석이 실패한다고
적었는데, **무엇이 실제로 필요한지 재 보지 않았다.**

```text
graxpert 가 쓰는 것 문자열 상수 셋 + zod. 타입은 컴파일에 사라진다
inputSchema.parse   덕 타이핑 — 번들한 zod 사본도 통한다
zodToJsonSchema     zod 내부를 읽지만 같은 메이저면 호환된다
```

**번들해서 폴더째 떨어뜨리면 된다.** npm 공개가 전제가 아니었다.

### "SDK 런타임 2.4KB" 라고 적었던 것은 오해를 부른다

여기 `SDK 런타임 산출물 2.4KB` 라고 적어 두었는데 **문 앞의 간판 크기였다.**
`dist/index.js` 는 자기 코드가 0 이고 세 줄이 전부 재수출이다.

```text
extension-api        8KB     1 js    ← 배럴
photoshop-bridge   344KB    23 js
photoshop-tools    838KB    79 js
command-engine      31KB     4 js
```

ESM 이 배럴을 해석하면 뒤의 두 index 를 통째로 적재한다. 그래서 이 수치를
근거로 "npm 에 올리면 된다" 로 가면 **Core 넷을 함께 공개해야 하고**, 그러면
Command 핸들러와 Bridge 구현이 공개 API 가 되어 §23 이 지키려던 경계가 열린다.

**그리고 그 길로 갈 필요가 없다.** 세 Extension 이 값으로 쓰는 것을 세 보면
Command 이름 문자열뿐이다 — `PhotoshopMcpError` 도 스키마도 쓰는 곳이 없고
오류는 전부 `throw new Error(...)` 다. 필요한 것은 **타입 선언과 이름 목록**이다.

`extension-api` 라는 이름을 보고 "배포용 개발 키트" 를 상정해 npm·계층 역전·
번들을 따졌는데, **있는 것부터 세지 않고 규모를 먼저 상정한 것**이다.
§17.16 과 같은 실수다.

규격은 [EXTENSION_API.md](EXTENSION_API.md) 에 적었다. §12 가 저장소 밖에서
만들 때의 현재 제약과 우회법이다 — 타입을 직접 선언하면 의존이 `zod` 뿐이다.

## 등록은 패널이 한다

이 프로젝트가 이미 두 번 쓴 패턴이다.

```text
작업 폴더 승인 (§8.5)      패널 버튼 → 플러그인이 보관 → 서버가 Bridge 로 묻는다
액션 허용 목록 (§17.36)    패널 모달 → 플러그인이 보관 → 부를 때마다 조회
Extension 등록             ← 같은 자리
```

서버의 cwd 는 MCP 클라이언트가 정하므로 우리가 통제할 수 없다. **플러그인이
경로를 알려 주면** 그 문제가 사라진다. 그리고 `getFolder()` 가 사용자 제스처를
요구하는 것이 그대로 안전장치가 된다 — **LLM 이 임의 폴더의 코드를 적재시킬 수 없다.**

## 순서 문제와 `tools/list_changed`

서버는 기동할 때 Extension 을 적재하는데 **Bridge 는 그 뒤에 붙는다.** 물어볼
상대가 아직 없다. 사용자가 패널에서 등록하는 시점은 더 나중이다.

그래서 **Tool 목록이 나중에 바뀔 수 있어야** 한다. MCP SDK 는 `sendToolListChanged`
를 이미 제공하는데 우리가 `tools: {}` 로 선언해 안 쓰고 있었다 — 막힌 것이 아니라
쓰지 않던 것이다.

```text
tools: { listChanged: true }        선언
ToolRegistry.setChangeListener      등록·해제 양쪽에서 알린다
```

**호출부마다 챙기지 않고 레지스트리 안에 건다.** 등록하는 곳이 여럿이라 언젠가
빠진다. `ResourceRegistry.setNotifier` 와 같은 구조다.

**선언만 하고 안 보내는 것이 안 하는 것보다 나쁘다.** 클라이언트가 알림을 믿고
다시 묻지 않게 되기 때문이다. 그래서 실제 MCP 클라이언트로 확인한다 —
알림을 끊으면 테스트가 실패하는 것까지 봤다.

## 체크리스트

- [x] `tools: { listChanged: true }` 선언
- [x] `ToolRegistry` 가 등록·해제 양쪽에서 알린다
- [x] 전송이 붙기 전 등록도 던지지 않는다 — 기동 시 적재 경로다
- [x] `tests/tool-list-changed.test.ts` — 실제 MCP 클라이언트로 확인
- [x] Bridge 로 등록 목록을 묻는 Command — `EXTENSION_REGISTRY` (`read`)
- [x] PhotoshopMCP 패널의 Extension 등록 모달
- [x] Bridge 가 붙으면 서버가 물어 적재한다 — `tests/extension-from-panel.test.ts`
- [x] 실기 검증 — 번들 적재를 끈 채로 `gx.*` 가 패널 등록으로 붙었다
- [~] `graxpert` 를 패널 저장소로 이동 — **조건부다. 아래 참조**
- [x] `milkyscape` 제거 — 아키텍처 검증 역할이 끝났다 (아래 참조)

## `graxpert` 이동은 할 일이 아니라 조건부다

체크리스트에 남겨 두었더니 "남은 일" 로 읽혔다. 점검해 보니 **원래 근거가
이미 풀렸고 선행 조건이 안 됐다.**

### 옮기려던 이유는 사라졌다

근거는 "저장소에 있으면 GraXpert 를 안 쓰는 사람에게도 `gx.*` 가 보인다"
였다. 그런데 **배포 패키지에 `extensions/` 가 들어가지 않는다.**

```text
npm pack photoshop-mcp
→ bin · dist 만. extension 파일 0개
```

서버의 cwd 는 MCP 클라이언트가 정하므로 설치한 사용자에게 `<cwd>/extensions`
는 **존재하지도 않는다.** 자동 적재될 것이 없다. `extensions/graxpert` 는
배포물이 아니라 **개발·검증 자산**이고, §18.2 의 스위치는 이 저장소에서
작업할 때를 위한 것이다.

### 지금은 옮길 수도 없다

**Extension 은 워크스페이스 안에 있어야 한다.** 밖에 두면
`@photoshop-mcp/extension-api` 해석이 실패한다. 옮기려면 그것이 먼저
publish 되어야 하고, 그건 Phase 14 의 배포 단위 결정에 달려 있다.
**순서가 뒤집혀 있었다.**

### 옮기면 잃는 것

`tests/graxpert.test.ts` 가 스무 개 넘게 고정한다 — 낡은 상태 파일 판정,
다른 클라이언트 응답 차단, 거절 코드별 안내, Job 을 안 띄우는 조건. 패널
저장소로 가면 vitest·워크스페이스를 통째로 옮기거나 이 테스트들을 버린다.

그리고 **패널을 구동하는 Extension 의 유일한 예제**다. `rcastro`·`starnet`
은 CLI Capability 형이고 `example` 은 껍데기다. §17.37 이 "액션으로는 안
된다 · 메뉴를 거치느냐가 기준이다" 로 갈라 둔 그 경로의 참조 구현이 없어진다.

### 남는 진짜 이유는 하나다

**계약이 저쪽에 있다.** `extensions/graxpert/README.md` 가 이미 그렇게 적는다 —
External Automation API 의 계약은 패널 저장소의 `docs/EXTERNAL_AUTOMATION.md`
이고 어긋나면 그쪽이 맞다. 패널이 API 를 바꾸면 이 Extension 이 따라가야
하는데, 두 저장소의 릴리스 주기가 다르면 어긋난 채로 돈다.

지금은 위험이 낮다 — 패널도 이 Extension 도 같은 사람이 만들고, 코드에 버전
협상이 없으니 어긋나면 `automation_disabled` 같은 거절 코드로 드러난다.

### 언제 다시 본다

```text
조건   extension-api 가 publish 된 뒤 · 패널 설치 관리자를 만들 때
결정   테스트를 함께 옮길지 · 참조 구현을 무엇으로 대체할지
```

## `milkyscape` 를 해체했다

통째로 옮기지 않고 **필요한 것만 하나씩 다시 구현**했다. 외부 처리기를 부르던
셋이 대상이고, 나머지는 옮길 이유가 없었다.

```text
milky.enhance          → rcastro.bxt            RC-Astro CLI
milky.remove_stars     → starnet.remove_stars   StarNet2
milky.remove_gradient  → gx.run_gradient        GraXpert 패널. 먼저 있었다
milky.get_state        → diagnostics + layer.list 로 덮인다
milky.restore_stars    → 새 Tool 이 별 레이어에 Screen 을 걸어 두어 불필요
```

**가르는 기준은 제품 이름이 아니라 설치 단위다.** `rc-astro.exe` 하나가
`bxt`·`nxt`·`sxt` 를 가지므로 `rcastro` 하나이고, `starnet2.exe` 는 따로 설치하므로
별도다. `rcastro.sxt` 와 `starnet.remove_stars` 가 같은 `starRemoval` Capability 를
쓰므로 **각 Tool 이 `provider` 를 못 박는다** — 우선순위로 고르게 두면 설정에 따라
다른 것이 돌면서 호출자는 모른다.

### 실기 검증 (같은 문서 · 같은 영역 · 같은 입력)

```text
rcastro.bxt           10초   σ(L) 0.653 → 0.685  (+7.7%)   선명화
rcastro.nxt            7초   σ(L) 0.685 → 0.587  (−14.3%)  노이즈 감소
rcastro.sxt            6초   별 없는 것 σ 0.245 · 복원 오차 +0.01
starnet.remove_stars  66초   별 없는 것 σ 0.710 · 복원 오차 −0.33
```

**σ 가 두 방향으로 움직여 서로를 검증한다** — 선명화는 오르고 노이즈 감소는
내린다. 별 분리는 별 레이어를 Screen 으로 얹어 **원본이 복원되는지**로 본다.
복원이 안 되면 분리해도 다시 합칠 수 없어 Tool 이 쓸모없어진다.

`milkyscape` 의 Phase 6 기록은 아래 §10 에 그대로 둔다. 그때 한 일이 없어진 것이
아니라 있을 자리가 바뀐 것이다.

## 묻는 시점을 두 번 틀렸다

처음에는 전송을 만들자마자 수신 대기를 열고, Core 를 조립한 뒤에 `connected`
콜백을 걸었다. **그 사이에 이미 열려 있던 패널이 붙으면 콜백이 사라진다.**
이벤트 하나가 없어지는 것은 넘어갈 수 있지만 이쪽을 놓치면 **등록한 Extension 이
붙지 않고 그 이유도 어디에도 안 보인다.**

걸쇠를 먼저 달았다가 지웠다. **문을 늦게 여는 편이 낫다** — 받을 곳을 전부
채운 뒤 `wsTransport.start()` 를 부른다. 놓칠 틈이 없어야 놓쳤는지 따질 일도 없다.
같은 구멍이 있던 `pendingEvents`("그 전에 온 이벤트는 버린다")도 함께 막혔다.

두 번째는 **없는 Command 를 불러 놓고 실패를 삼킨 것**이다. 옛 플러그인에는
`EXTENSION_REGISTRY` 가 없어 붙을 때마다 경고가 한 줄씩 났다 — 정상인데 무언가
잘못된 것처럼 보이고 진짜 경고가 그 사이에 묻힌다. **핸드셰이크가 이미 Command
목록을 싣고 온다**(PROTOCOL.md §3.2). 지원한다고 말한 것만 묻고, 그래 놓고
실패하면 그때는 알린다.

이것을 고치자 `tests/bridge-integration.test.ts` 가 손대지 않고 다시 통과했다.
기존 테스트를 고쳐야 한다고 느낄 때는 **설계가 틀린 쪽을 먼저 본다.**

## 실기 검증

`PHOTOSHOP_MCP_EXTENSIONS_ENABLED` 로 **번들 자동 적재를 끈 채로** 확인했다.
이것을 켜 두면 `extensions/` 를 훑어 `gx` 가 이미 붙으므로 패널 등록이 namespace
충돌로 거부되고, **무엇으로 붙었는지 구분할 수 없다.**

```text
commands      71 → 72          EXTENSION_REGISTRY
extensions    3개 → gx 하나    example · milky 는 자동 적재에서 빠졌다
tools         81 = 78 + 3      gx.* 는 사용자가 고른 경로에서 왔다
gx.status     panelRunning     등록만이 아니라 동작한다
```

**등록만 확인하고 끝내지 않았다.** `gx.status` 는 `read` 라서 **늦게 붙은
Extension 의 `external` 권한이 통하는지**를 증명하지 못한다. 그것이 아래
"아직 풀지 않은 것" 에 적어 둔 질문이었으므로 `gx.run_gradient` 를 끝까지 돌렸다.

```text
gx.run_gradient   external 통과 → Job 18초 → GraXpert 패널 → 레이어 생성
layer.delete      PERMISSION_DENIED (destructive 미허용)
```

**상한이 함께 살아 있다.** `external` 을 쓸 수 있으면서 `destructive` 는 막혔다 —
manifest 선언과 기동 시 policy 가 둘 다 작용한다. 늦게 붙어도 예외가 아니다.

두 경로를 갈라서 봤다(§17.37). 하늘 선택이 있을 때 **지상부가 64개 히스토그램
빈까지 배경과 완전히 같았다.** 같은 자리에서 전체 경로는 휘도가 25.5 → 45.95 로
올랐다 — 측정 구역이 둔해서 같게 나온 것이 아니다.

**`skyApplied` 를 설정값으로 판정하지 않은 것이 여기서 값을 했다.** `mergeSky:
true` 는 두 경로 모두 같았고 갈린 것은 결과 레이어 이름뿐이다. 설정을 믿었으면
전체 경로도 `true` 로 보고했을 것이다.

플러그인 적재는 UXP DevTools CLI 로 했다. **설치 위치를 기록해 둔다** — `D:\Dev\uxp-cli`.
지난번에는 임시 폴더에 깔아 놓아 다시 찾지 못하고 재설치했다.

## 아직 풀지 않은 것

**등록 직후에는 반영되지 않는다.** 서버는 **Bridge 가 붙는 순간에만** 목록을
묻는다. 서버가 이미 떠 있는 상태에서 등록하면 재연결해야 한다 — 모달이 그 말을
하고 있지만 안내로 메우는 것은 임시다. 플러그인이 등록 시점에 이벤트를 올리고
서버가 다시 묻는 쪽이 맞다.

**Permission.** §22 는 기동 시 policy 를 고정한다. 나중에 붙는 Extension 의
manifest 권한을 어떻게 검사할지 다시 봐야 한다.

**namespace 충돌.** 이미 있는 이름으로 등록하면 두 번째를 거부하는데(§17 격리),
사용자가 패널에서 고른 것이 거부되면 그 사실이 보여야 한다.

## 18.2 번들 Extension 은 Core 가 아니다

저장소에 Extension 셋이 들어 있는데 **성격이 다 다르다.**

```text
example      쓰는 법을 보여 주는 예제
milkyscape   아키텍처 검증 소재. 은하수 사진 도메인
graxpert     특정 서드파티 패널 하나를 부린다
```

**어느 것도 Core 의 기능이 아니다.** 그런데 서버가 `extensions/` 를 통째로
훑어 전부 적재하므로, 이 저장소를 그대로 쓰면 Tool 목록에 `milky.*` 5개와
`gx.*` 3개가 늘 보인다. StarNet2 도 GraXpert 패널도 없는 사람에게는 **쓸 수
없는 Tool 이고, 무엇이 이 서버의 능력인지 흐려진다.**

`PHOTOSHOP_MCP_EXTENSIONS_ENABLED` 로 고른다. 값을 주면 그것이 **전체 목록**
이다 — `PHOTOSHOP_MCP_ALLOW` 와 같은 규칙이다.

```text
생략        전부 적재 (지금까지의 동작)
"gx"        gx 만
"none"      하나도 적재하지 않는다 — Core 만 있는 서버
""          같은 뜻. 다만 살아서 도착하지 않을 수 있다 (아래)
```

**빈 문자열과 생략을 구분한다.** 둘을 같게 두면 Core 만 있는 서버를 만들 수 없다.

### 빈 문자열은 클라이언트를 못 넘는다

처음에는 빈 문자열만 받았다. 실기에서 **VS Code 를 거치자 그 환경변수가
사라져** `undefined` 가 되었고, "생략 = 전부" 로 떨어져 Extension 넷이 다 붙었다.

```text
[photoshop-mcp] info Extension 적재: Example Extension (example) Tool 2개
[photoshop-mcp] info Extension 적재: GraXpert Panel Tools (gx) Tool 3개
[photoshop-mcp] info Extension 적재: RC-Astro CLI Tools (rcastro) Tool 3개
[photoshop-mcp] info Extension 적재: StarNet2 Tools (starnet) Tool 1개
```

같은 `.mcp.json` 을 Claude Code 는 제대로 넘겼다. **클라이언트가 빈 값을 어떻게
다루는지는 우리가 통제할 수 없다.** `none` 을 명시 값으로 받는다 —
`PHOTOSHOP_MCP_ALLOW` 가 `none` 을 받는 것과 같은 이유이자 같은 낱말이다.

**"없음" 을 값의 부재로 표현하지 않는다.** 부재는 전달 과정에서 만들어질 수 있다.

## 디렉터리 이름이 아니라 namespace 다

`extensions/milkyscape` 의 namespace 는 `milky` 다. Tool 이름과 `diagnostics`
에 나오는 것이 namespace 이므로 그쪽으로 고른다.

**그래서 `milkyscape` 라고 적으면 하나도 안 걸린다.** 처음 구현은 그때 조용히
빈 목록을 돌려줬다 — Tool 이 없는 이유를 알 수 없다. 찾지 못한 이름을 경고로
낸다.

```text
[photoshop-mcp] warn 적재할 Extension 으로 지정한 이름을 찾지 못했습니다:
                milkyscape — 디렉터리 이름이 아니라 manifest 의 namespace 입니다
```

## 저장소를 쪼개지 않았다

공개하려면 Extension 을 별도 저장소로 빼는 것이 맞아 보이지만 **지금은 아니다.**

Extension 은 워크스페이스 안에 있어야 `@photoshop-mcp/extension-api` 해석이
된다. 밖으로 빼려면 SDK 를 먼저 공개해야 하는데, 그건 패키징 결정과 묶여 있고
**패키징은 두 번째 사용자가 생길 때까지 미뤘다.**

지금 필요한 것은 "안 쓰는 것을 끌 수 있다" 까지다. 그 이상은 없는 사용자를
위해 만드는 것이 된다.

## 스니펫은 필요할 때만

`doctor` 가 `external` 이 없을 때만 설정 조각을 낸다. 늘 내면 기동 로그를
짧은 이름만 남긴 이유가 되돌아온다 — **늘 나오는 것은 읽히지 않는다.**

경로는 문서에 적어 두지 않고 **이 파일이 있는 위치에서 만든다.** 적어 두면
옮겼을 때 틀린 경로를 복사하게 된다. 역슬래시는 `/` 로 바꾼다 — JSON 에
들어가면 이스케이프가 필요하고 손으로 고칠 때 틀린다.

**`destructive` 는 권하지 않는다.** 덮어쓰기(`document.save`) · 평탄화 ·
액션 실행이 거기 있다. 필요한 사람이 스스로 더하게 둔다.

향후 배포 구조 예:

```text
Photoshop MCP Server

+

Photoshop MCP UXP Bridge

+

Optional Extensions
```

---

# 19. Deferred Features

아래 기능은 초기 구현 범위에서 제외한다.

```text
Arbitrary JavaScript execution

Arbitrary batchPlay execution

Full Photoshop API coverage

Automatic Action conversion

Fully autonomous image editing

Automatic AI image analysis

Multi-Photoshop instance support

Remote Photoshop control
```

필요성이 확인된 후 별도 Phase로 추가한다.

---

# 20. Recommended Initial Milestone

가장 먼저 달성할 실제 목표는 다음이다.

```text
Claude Code
     ↓ MCP
Photoshop MCP Server
     ↓ WebSocket
UXP Plugin
     ↓
Photoshop
```

그리고 다음 세 Tool이 실제 Photoshop에서 동작한다.

```text
photoshop.ping

photoshop.document.get

photoshop.layer.list
```

이 상태를 `MVP-0`으로 정의한다.

---

# 21. MVP-1

그 다음 목표:

```text
photoshop.layer.duplicate

photoshop.layer.rename

photoshop.layer.set_opacity

photoshop.group.create
```

예:

```text
현재 활성 레이어를 복제하고
"MCP Test"라는 이름으로 변경한 뒤
불투명도를 50%로 설정해줘.
```

실제 Photoshop에서 완료되면 `MVP-1`.

---

# 22. MVP-2

기본 보정:

```text
photoshop.mask.create

photoshop.adjustment.curves

photoshop.adjustment.levels
```

---

# 23. MVP-3

Extension SDK:

```text
ExtensionManager

ExtensionManifest

ExtensionContext

Namespace Validation
```

그리고:

```text
example.hello
```

Extension을 Core 수정 없이 등록한다.

---

# 24. MVP-4

첫 실제 Extension:

```text
MilkyScapeTools
```

초기 Tool:

```text
milky.get_state

milky.create_sky_mask

milky.remove_gradient

milky.remove_stars
```

---

# 25. Claude Code Working Rules

Claude Code는 작업 시작 시 반드시 다음 파일을 읽는다.

```text
CLAUDE.md

docs/ARCHITECTURE.md

docs/ROADMAP.md
```

현재 작업 중인 Phase만 구현한다.

예:

```text
We are currently implementing Phase 1.

Do not implement Phase 2 or later features.
```

작업 종료 시 반드시:

1. Build 실행
2. Test 실행
3. 실패 수정
4. 변경 파일 검토
5. ROADMAP 체크박스 업데이트
6. 관련 문서 업데이트

순서로 진행한다.

---

# 26. Definition of Done

하나의 Task는 다음 조건을 만족해야 완료로 간주한다.

- 코드 구현 완료
- TypeScript compile 성공
- Unit Test 성공
- 신규 기능 테스트 존재
- Error Case 테스트 존재
- 기존 테스트 Regression 없음
- 공개 Interface 문서화
- ROADMAP 업데이트
- 임시 코드/TODO 정리

---

# 27. Current Priority

현재 우선순위:

```text
P0

Phase 0
Phase 1
Phase 2

P1

Phase 3
Phase 4
Phase 5

P2

Phase 6
Phase 7
Phase 8

P3

Phase 9+
```

현재 가장 중요한 목표는 Photoshop 기능을 많이 구현하는 것이 아니다.

먼저 다음 연결을 안정적으로 완성하는 것이다.

```text
MCP
 ↓
Command Engine
 ↓
Bridge
 ↓
UXP
 ↓
Photoshop
```

## 18.4 클라이언트가 사라지면 프로세스도 끝난다

하루에 세 번 손으로 죽였다. 옛 프로세스가 남아 **8765 를 쥐고 있었고** 다음
서버가 `EADDRINUSE` 로 못 떴다. 그때마다 원인을 처음부터 다시 찾았다 —
증상이 "Photoshop 이 안 붙는다" 로 보이기 때문이다.

**`stop()` 은 멀쩡했다. 아무도 부르지 않는 경로가 있었다.**

```text
SIGINT · SIGTERM     → stop() 이 돈다
stdin 만 닫힌다       → 아무 일도 안 일어난다
```

stdin 이 닫히는 것이 "클라이언트가 갔다" 의 가장 직접적인 신호다. `end` 와
`close` 를 둘 다 받고 `shutdown` 은 한 번만 돈다.

### 재현된 것과 안 된 것을 구분한다

처음에 "Windows 에는 `SIGTERM` 이 오지 않으니 부모가 사라지면 프로세스가
영원히 산다" 고 적었다. **그 인과는 확인하지 않고 쓴 것이었고, 재 보니
틀렸다.**

가짜 클라이언트로 서버를 낳고 부모를 없애는 실험을 두 가지로 했다.

```text
부모를 강제 종료       고치기 전에도 서버가 사라졌다
부모가 스스로 종료     고치기 전에도 서버가 사라졌다
stdin 만 닫는다        고치기 전에는 살아남았다   ← 유일한 차이
(부모는 살아 있음)     고친 뒤에는 코드 0 으로 끝난다
```

부모가 죽으면 파이프 핸들이 함께 닫혀 그 경로로도 끝난다. **그래서 이
수정이 고치는 것은 "부모가 사라진 경우" 가 아니라 "클라이언트가 stdin 을
닫았는데 자기는 살아 있는 경우" 다.** MCP 클라이언트의 Stop 이 바로 그
모양이어야 한다.

아침에 남았던 셋의 원인은 **여전히 모른다.** 짚이는 것은 있다 — 실기에서
서버의 부모가 `Code.exe --type=utility` 였다. 창이 닫혀도 그 호스트가 남아
파이프를 쥐고 있으면 stdin 은 닫히지 않고, 그러면 이 수정으로도 못 잡는다.
**짚이는 것을 원인이라고 적지 않는다.**

이 수정은 그것과 무관하게 옳다. 종료 경로가 시그널 하나에만 걸려 있으면
언제 끝나는지가 플랫폼과 클라이언트에 따라 달라진다.

**정리가 끝나지 않아도 끝낸다.** 외부 프로세스가 `SIGKILL` 을 안 받거나 소켓이
안 닫히면 거기서 영원히 기다리게 되고, 그러면 고치려던 증상이 그대로 남는다.
3초 뒤 강제 종료하되 `unref` 라 정상 종료를 늦추지 않는다.

`stop()` 도 한 군데 고쳤다. 기동 시 자동 적재한 Extension 만 해제하고 **패널에서
붙인 것은 남겨 두고 있었다** — 이벤트 구독이 살아 있는 채로.

### 원인 대신 비용을 없앤다

아침에 남았던 셋의 원인은 재현되지 않았다. 재현 안 되는 것을 쫓는 대신,
**다음에 같은 일이 나면 10초에 끝나게** 했다. 실제로 아팠던 것은 프로세스가
남은 것 자체가 아니라 **그때마다 원인을 처음부터 다시 찾은 것**이다.

포트가 막히면 이 한 줄만 나왔다.

```text
시작 실패: listen EADDRINUSE: address already in use 127.0.0.1:8765
```

사용자에게 보이는 증상은 "Photoshop 이 안 붙는다" 다. 둘을 잇는 데 매번
시간이 들었다. `doctor` 가 같은 말을 하고 있었지만 **부르지 않으면 못 본다** —
§18 에서 이미 겪은 구조다. 지금은 이렇게 나온다.

```text
포트 8765 를 다른 프로세스 (PID 39560)가 이미 쓰고 있어 Bridge 를 열지 못했습니다.
  PhotoshopMCP 서버가 이미 떠 있다면 그것을 쓰십시오 — 두 개를 띄울 수 없습니다.
  남은 서버라면 끝내십시오. Windows: taskkill /PID 39560 /F
  다른 포트를 쓰려면 PHOTOSHOP_MCP_PORT 를 바꾸십시오 (지금 8765).
```

**PID 를 알아야 끝낼 수 있다.** 포트가 막혔다는 것만으로는 사용자가 다음에
할 일이 없다. Node 에 이걸 묻는 API 가 없어 `netstat`·`lsof` 를 쓴다 —
기동에 **이미 실패한 뒤** 진단 경로에서만, `shell: false` 로, 고정 인자로.
못 찾으면 `null` 이고 문장에서 PID 를 뺀다. **짐작한 PID 를 내놓으면 사용자가
엉뚱한 프로세스를 죽인다.**

같은 판정을 `doctor` 도 쓴다. 두 벌이면 서로 다른 말을 한다(§17 과 같은 규칙).

`LISTENING` 만 고른다. 같은 포트에 `ESTABLISHED` 줄이 함께 있는데 그쪽을
집으면 **상대 프로세스를 죽이게 된다.** IPv6 는 주소 안에도 콜론이 있어
마지막 콜론 뒤를 포트로 읽는다.

### 부모 PID 를 기동 로그에 남긴다

```text
stdio 서버 시작. UXP Bridge (ws://127.0.0.1:8765 대기 중) · pid 26512 ← 50604
```

다음에 남은 프로세스를 발견하면 **부모가 살아 있는지**를 바로 본다. 그것이
고아인지 아닌지를 가르고, 오늘 못 답한 질문이 그것이었다. 짐작으로 쫓는 대신
증거가 쌓이기를 기다린다.

### 테스트는 실제 CLI 를 띄운다

`startPhotoshopMcpServer` 를 직접 부르면 stdin 도 시그널도 없어서 **재려는 것이
빠진다.** `spawn` 으로 `bin/photoshop-mcp.js` 를 띄우고 stdin 을 닫아 종료를 잰다.

고치기 전으로 되돌려 확인했더니 **uxp 만 깨지고 mock 은 통과했다.** mock 은
WebSocket 서버를 열지 않아 저절로 끝난다 — 그래서 mock 으로만 시험했으면 이
버그는 영영 안 보인다. 두 모드를 다 고정해 둔 이유다.

이 테스트가 재는 것이 위에서 유일하게 재현된 차이다. 부모가 사라지는 경우는
고치기 전에도 끝나므로 **테스트로 고정할 것이 없다.**

이 경로가 안정된 후 기능을 확장한다.


---

# 28. 광도 마스크 — 짐작할 수 없는 descriptor 둘

## `color_range` 는 광도 마스크가 아니었다

Tool 설명에 **"이것이 광도 마스크다"** 라고 적어 두었는데 틀렸다. Astro Panel 의
`D&B Pro` 를 흉내내 보다가 마스크 썸네일에서 드러났다.

```text
Astro Panel      연속 계조. 은하수 구조가 그대로 보인다
color_range 로   Lights 는 거의 새까맣고 Darks 는 거의 새하얗다
```

임계 기반 구간 선택이라 결과가 거의 이진이고, 성운처럼 계조가 이어지는 구조를
따라가지 못한다.

**그런데 결과 그림은 그럴듯했다.** 숫자도 "배경만 내리고 코어는 지켰다" 로
읽혔다. 실제로는 Lights 마스크가 비어서 닷지가 아예 안 걸렸고 Darks 마스크가
하늘 전체라 번만 전면에 걸린 것이었다 — 우연이었다.

`MEASUREMENT.md` §2 의 "검사를 통과하고도 틀린다" 가 한 번 더 나왔다.

## descriptor 두 개를 잡았다

짐작하지 않고 §17.17 의 방법으로 받아 적었다. 서버를 띄워 둔 채로 사람이
채널 패널을 조작하게 하고 `photoshop.event.recent` 로 읽었다.

**합성 휘도를 선택으로** (RGB 를 Ctrl+클릭)

```json
{ "_obj": "set",
  "_target": [{ "_ref": "channel", "_property": "selection" }],
  "to": { "_ref": "channel", "_enum": "channel", "_value": "RGB" } }
```

`load_channel` 과 `to` 안쪽만 다르다 — 이름 있는 알파 채널은 `_name`, 합성
채널은 `_enum`/`_value` 다. History 에는 `Load Selection` 으로 남는다.

**교집합** (Ctrl+Alt+Shift+클릭)

```json
{ "_obj": "interfaceIconFrameDimmed",
  "_target": [{ "_ref": "channel", "_enum": "channel", "_value": "RGB" }],
  "with": { "_ref": "channel", "_property": "selection" } }
```

**이름이 하는 일과 아무 상관이 없다.** Photoshop 이 내부 이벤트 ID 를 문자열로
되짚는 과정에서 엉뚱한 이름이 붙는 경우가 있고 이것이 그렇다. 문서에서 찾거나
짐작해서는 절대 나올 수 없는 값이다.

### `invert` 는 형태에 따라 먹기도 하고 안 먹기도 한다

```text
load_channel   to: { _ref: "channel", _name: "T" }         invert 키가 먹는다
luminosity     to: { _ref: "channel", _enum, _value }       조용히 무시된다
```

오류가 나지 않아 반전된 줄 알고 넘어갈 뻔했다. 잡아낸 것은 **경계**였다 —
반전하면 검은 지상이 들어와 `bottom` 이 6048 이어야 하는데 5772 그대로였다.
지금은 `{_obj:"inverse"}` 를 따로 건다. 이 프로젝트의 "조용한 실패" 목록에
하나 더 들어간다.

## 다른 플러그인의 동작은 잡을 수 없다

Astro Panel 의 설정값을 같은 방법으로 얻으려 했는데 **아무것도 안 남았다.**

```text
modalJavaScriptScopeEnter      패널 스크립트 시작
modalJavaScriptScopeExit       0.9초 뒤 끝
그 사이 descriptor             0개
```

레이어 다섯 장과 마스크 넷이 만들어졌는데도 그렇다.

```text
사람이 UI 를 조작한다          descriptor 가 남는다
프로그램이 modal scope 안에서  modal scope 만 남는다
```

§17.37 이 GraXpert 패널에 대해 "녹화할 것이 없다" 고 한 것이 **CEP 한정이
아니었다.** 우리 플러그인이 도는 동안에도 같은 두 줄만 찍힌다.

안 되는 것을 확실히 알았으므로 같은 시도를 다시 하지 않는다.

## 대신 재서 알아냈다

패널의 조정 레이어를 하나씩 켜고 끄며 잰 것이 훨씬 많은 것을 말했다.

```text
              mean     p50      p95      p99      σ
원본         43.93    55.4     80.3     108.7    0.440
Lights       41.18    52.4     74.3      98.9    0.392
Lights 2     44.85    56.3     82.7     113.8    0.465
Darks        33.81    41.3     64.5      94.1    0.392
Darks 2      43.93    55.4     80.3     108.7    0.440
```

**셋이 드러났다.**

1. `Lights` 와 `Lights 2` 는 넓고 좁은 관계가 아니다 — 하나는 태우고 하나는
   밝힌다. 밝은 구간 안에서 번과 닷지를 짝으로 건다.
2. 무게는 `Darks` 가 진다. p50 을 14 내린다. 전체 −11.6 의 대부분이다.
3. `Darks 2` 는 기본값에서 아무 일도 안 한다. 히스토그램까지 원본과 같다 —
   중립으로 만들어 두고 사용자가 조절하게 하는 자리다.

관례로 알려진 `L → L²` 계단식과 다르다. **재지 않았으면 틀린 설명을 그대로
구현할 뻔했다.**

## 우리 결과와의 비교

밝기를 맞추고(`p95` 61.5 대 61.3) 나머지를 본다.

```text
                  내 것(광도 마스크)   Astro Panel
L p99             96.2                 89.4
L σ               0.432                0.367
p99 − p50         61.0                 49.8
```

코어가 더 밝고 국소 디테일이 더 남고 분리가 22% 크다. 하이라이트 번을 추가하면
`p99` 이 90.6 으로 패널에 붙지만 σ 와 분리가 함께 줄었다.

**이 사진은 `clippedHigh` 가 0.0027% 로 탈 것이 없었다.** 하이라이트 번은 코어가
포화됐을 때 쓰는 것이고, 여기서는 얻는 것 없이 코어만 눌렀다. 조건부 단계다.

## 체크리스트

- [x] `photoshop.selection.luminosity` — 합성 휘도를 선택으로. `invert`
- [x] `mode: "intersect"` — 더 좁은 광도 마스크 (`Lights 2`)
- [x] `color_range` 설명에서 "이것이 광도 마스크다" 를 뺀다
- [x] 실기: 휘도 마스크로 D&B 를 만들어 패널과 같은 밝기에서 비교
- [ ] 실기: `mode: "intersect"` 로 좁은 닷지를 만들어 다시 비교

# 29. 배경 레이어는 세 번째 방식으로도 실패한다

`photoshop.layer.set_fill_opacity` 를 만들며 실기에서 잡았다.

`fillOpacity` 는 `opacity` 와 다른 값이다 — `opacity` 는 레이어 스타일까지 함께
투명해지고 `fillOpacity` 는 픽셀만 투명해진다. Adobe UXP 레퍼런스가 둘을 따로 두고
`opacity` 를 "master opacity" 라고 부른다. `photoshop.layer.get` 이 이미 둘 다 준다.

## 배경에서 갈린다

```text
레이어가 둘 이상  →  승격도 없고 값도 그대로 (id 1, 100)
배경이 유일       →  승격만 일어나고 값은 그대로 (id 1 → 7, 100)
승격된 레이어     →  적용된다 (50.196)
```

**`set_opacity` 는 승격되면 값도 들어갔다.** 이쪽은 승격만 하고 만다. 그러면
실패를 보고하는데 **문서는 이미 바뀐 상태**다 — 이 프로젝트에서 가장 나쁜 실패
유형이다(ARCHITECTURE §8.4). 그래서 오류에 승격 사실과 **새 id** 를 담고 그 id 로
다시 부르라고 말한다. 실기에서 안내대로 다시 불러 적용되는 것까지 확인했다.

## 배경 여부는 변경 전에 읽는다

처음 구현은 변경 **후** `isBackground` 를 보고 메시지를 골랐다. 승격되면 그 값이
`false` 라서 "배경 레이어라서" 분기를 놓치고 "Photoshop 이 바꾸지 않았습니다" 라는
원인 없는 문장이 나갔다. 실기 첫 호출에서 바로 드러났다.

## 0–255 저장

35 를 넣으면 34.902 가 돌아온다(89/255). `opacityApplied` 의 허용 오차가 이미
그것을 다루고 있었다 — 정확히 비교했으면 매번 거짓 실패였다.

## 결과 모양이 다른 이유

다른 레이어 편집 Tool 은 `LayerInfo` 하나를 돌려주는데 이것만 `{ layer, fillOpacity }`
다. **`LayerInfo` 에 `fillOpacity` 가 없기 때문이다.** 평탄하게 두면 호출자가 값을
확인하려고 `layer.get` 을 한 번 더 불러야 한다. 모양은 그 `layer.get` 과 맞췄다.

## 체크리스트

- [x] `photoshop.layer.set_fill_opacity` — `{ layer, fillOpacity }`
- [x] 실기: 일반 레이어 적용 · 배경 두 경우 · 승격 후 재시도
- [x] Mock 이 승격-만-하고-실패를 흉내낸다

# 30. 능력 가드를 훑었다 — 나중에 고칠 것 (미착수)

`host.get`(§28) 을 만들며 "버전 가드가 여섯 파일에 흩어져 `host.get` 과 어긋난다"
고 적었는데, 훑어 보니 **그 진단이 틀렸다.** `host.get` 과 소비처의 판정은 표현만
다르고 결과가 같다(`document.rotate` · `document.selection` ·
`addNotificationListener` 셋). 판정식을 한 모듈로 모으는 것은 **아무것도 고치지
않는다** — 실제 문제는 판정식이 아니라 **소비처끼리 정책이 다른 것**이다.

## 1. `SaveOptions` 정책이 정반대다

```text
document-lifecycle.ts:81   상수 없으면 COMMAND_NOT_SUPPORTED — 짐작하지 않는다
export-tiff.ts:149         ?? "no" 로 짐작하고 try/catch 로 삼킨다
export-mask.ts:148         같음
```

`document-lifecycle` 의 주석이 "인자 없이 닫으면 창이 떠 플러그인이 멈추므로
실행하지 않았다" 고 못 박는데 나머지 둘이 그 규칙을 어긴다. **`try/catch` 는
도움이 안 된다 — 대화상자는 던지지 않고 멈춘다.** 대화상자는 이 프로젝트에서
네 번 반복된 실패 유형이다(§17.11 · §17.25 · §17.26 · §17.34).

## 2. `COMMAND_NOT_SUPPORTED` 를 일곱 곳이 안 쓴다

`document.rotate` · `createTextLayer` · `app.SolidColor` · `app.fonts` ·
`app.actionTree`(2) · `ActionItem.play` 가 전부 "이 Photoshop 에 API 가 없다"
인데 `COMMAND_FAILED` 로 나간다. 호출자가 코드로 능력 부족을 걸러낼 수 없다.

## 3. `getData` 가 한쪽에서만 치명적이다

`document-statistics` · `document-tilt` 은 없으면 실패하는데 `capture` 는 조용히
건너뛴다. 16비트 문서에서 변환을 건너뛰면 인코딩이 틀어진다. 다만 캡처의 의도가
"미리보기는 실패보다 근사치가 낫다" 일 수 있어 **의도를 먼저 정해야 한다.**

## 왜 지금 안 고치는가

**셋 다 이 호스트(27.8)에서 실행되지 않는 경로다.** 해당 API 가 전부 있다는 것을
이미 쟀다. 지금 잘못 도는 것은 없고, 값은 "다른 Photoshop 버전에서 그 경로가
처음 실행되는 날" 에 생긴다. §17.19 가 "한 번도 실행되지 않은 경로는 지웠다" 고
한 것과 같은 자리다 — 짐작으로 남겨 둔 경로는 처음 도는 날 맞는지 아무도 모른다.

## 체크리스트

- [x] `export-tiff.ts` · `export-mask.ts` 의 `?? "no"` 를 없앴다
- [x] 능력 가드를 `COMMAND_NOT_SUPPORTED` 로 바꿨다 — **일곱이 아니라 여섯이다**
- [x] `capture` 의 `getData` 누락은 **실패**로 정했다
- [ ] ~~`host-features.ts` 로 판정식 통합~~ — 훑어 보니 고치는 것이 없다

# 31. 마스크를 편집 대상으로 (`photoshop.mask.select`)

필터·조정은 **지금 선택된 채널**에 걸린다. 지금까지는 `mask.dab` · `mask.gradient`
처럼 **대상을 스스로 정하는 Command** 로만 마스크를 건드릴 수 있었다. 마스크를
편집 대상으로 두면 `filter.gaussian_blur` 가 마스크 경계를 다듬고
`adjustment.curves` 가 마스크의 세기를 조절한다.

## descriptor 는 잡은 것이다

DOM 에 레이어 마스크를 채널로 얻는 길이 **문서화되어 있지 않다** —
`document.activeChannels` 는 문서 채널용이고 `Channel` 에 마스크를 가리키는 값이
없다(Adobe 레퍼런스 확인). 그래서 batchPlay 이고, 이름은 `["all"]` 알림으로
사람이 썸네일을 클릭하는 것을 잡았다(§17.28).

```json
마스크: {"_obj":"select","_target":[{"_ref":"channel","_enum":"channel","_value":"mask"}],"makeVisible":false}
픽셀:   {"_obj":"select","_target":[{"_ref":"channel","_enum":"channel","_value":"RGB"}],"makeVisible":false}
```

**이미 대상이면 클릭해도 알림이 안 난다.** `mask.create` 직후에는 마스크가 이미
대상이라, 첫 시도에서 마스크 클릭이 아무것도 안 남기고 레이어 클릭만 잡혔다.

## 양방향을 한 Tool 이 갖는다

`target: "pixels"` 를 함께 연다. 마스크로 보내는 길만 있으면 호출자가 돌아올 수
없고 그 뒤의 편집이 **전부 조용히** 마스크에 걸린다. Tool 을 둘로 나누지 않은
이유는 **두 번째를 안 만들 수 없기 때문**이다.

## 실증

마스크에 `mask.dab hide`(반지름 400, 강도 100)로 검은 얼룩을 찍고, 마스크를 대상으로
둔 뒤 `filter.gaussian_blur radius 120` 을 걸었다.

```text
              마스크                      레이어 픽셀
전     clippedLow 2.061 · p1 0        mean 46.31/52.17/53.66 · σ .457/.473/.481
후     clippedLow 0     · p1 53.1     mean 46.31/52.17/53.66 · σ .457/.473/.481
```

마스크 평균은 249.74 로 그대로다 — 블러의 특징이다. **레이어 픽셀은 소수점까지
완전히 같다.** 필터가 마스크에만 걸렸다.

## 상태를 물어서 확인한다

`document.activeChannels` 가 두 상태를 구분한다.

```text
픽셀이 대상   ["빨강","녹색","파랑"]
마스크가 대상  throw "Unknown or unsupported active channels."
```

처음에는 둘 다 `null` 로 뭉갰다. 그러면 **"마스크라서 못 읽었다" 와 "이 Photoshop
에 속성이 없다" 가 같은 값**이 되어, 능력 없는 호스트에서 `verified` 가 거짓으로
참이 된다. 셋으로 가른다 — 이름 · 던짐 · 알 수 없음.

그래서 `verified` 는 요청값의 되풀이가 아니라 **물어본 결과**다. 다만 마스크인지
알파 채널인지까지는 구분하지 않는다 — Photoshop 이 둘을 같은 오류로 답한다.
Mock 은 물어볼 Photoshop 이 없으므로 **언제나 `false`** 다.

## 체크리스트

- [x] `photoshop.mask.select` — `target: mask | pixels`, `verified`
- [x] descriptor 를 `["all"]` 알림으로 잡았다
- [x] 실기: 필터가 마스크에만 걸리고 픽셀은 그대로인 것을 측정으로 확인
- [x] 실기: 양방향 · 마스크 없는 레이어 거절

# 32. 마스크 반전 (`photoshop.mask.invert`)

광도 마스크를 만든 뒤 반대쪽이 필요할 때 쓴다. `selection.luminosity` 를 다시
불러 마스크를 새로 만드는 것보다 짧고, **이미 손으로 다듬어 둔 마스크를 잃지
않는다.** 선택 영역을 뒤집는 `selection.invert` 와 다른 물건이다.

## `{_obj:"invert"}` 에는 타깃이 없다

`["all"]` 알림으로 사람이 `이미지 > 조정 > 반전` 을 실행하는 것을 잡았더니
descriptor 가 통째로 비어 있었다.

```json
{"action":"invert","target":null,"descriptor":{"_isCommand":true}}
```

**지금 선택된 대상에 걸린다.** 그래서 이 Command 는 마스크를 고르고, 반전하고,
원래 대상으로 되돌린다 — 세 걸음 모두 실기에서 잡은 descriptor 다(§31).

되돌리기는 `finally` 다. 반전이 실패해도 편집 대상은 제자리로 온다. 남기면 다음
Command 가 조용히 마스크에 걸린다 — `retouch.remove_spots` 가 선택을 `finally`
에서 푸는 것과 같은 이유다.

## 어디에 남겼는지 말한다

`editTarget` 이 반전 뒤 편집 대상이다. 이 Command 는 **숨은 상태를 잠깐 바꾸므로**
말하지 않으면 호출자가 뒤따르는 필터·조정이 어디에 걸리는지 알 수 없다.
부르기 전 상태로 되돌리되, 읽지 못했으면 픽셀로 간다 — 나머지 API 가 전제하는
상태이고, 마스크에 남기는 쪽이 더 위험하다.

## 실증

손으로 한 반전과 Tool 로 한 반전이 정확히 상쇄됐다.

```text
             평균     clippedHigh   clippedLow
손으로 전    246.79   86.8287       0
손으로 후      8.21   0             86.8287
Tool 로 후   246.79   86.8287       0
```

히스토그램도 64구간이 전부 원래 값으로 돌아왔다.

편집 대상이 픽셀일 때 불러도 **반전은 마스크에 걸린다.** 레이어 픽셀 통계가
같은 원본에서 복제한 다른 레이어와 소수점까지 같았다(46.31/52.17/53.66,
σ .457/.473/.481).

`editTarget` 도 두 경우를 다 확인했다 — 마스크가 대상이었으면 `mask`,
픽셀이었으면 `pixels` 이고, 이어서 부른 호출이 그 복원을 다시 확인했다.

## 마스크가 걸린 레이어의 `layer` 통계는 대조군이 아니다

실기에서 한 번 헛짚었다. 마스크가 대부분 검게 바뀌자 `target: "layer"` 의
픽셀 수가 24385536 에서 3880900 으로 줄었다. **픽셀이 바뀐 것이 아니라 드러난
영역만 재어진 것**이다. 마스크를 원래대로 되돌린 뒤에 재야 비교가 된다.

## 체크리스트

- [x] `photoshop.mask.invert` — `editTarget` 으로 남긴 자리를 알린다
- [x] descriptor 를 `["all"]` 알림으로 잡았다 (타깃 없음을 확인)
- [x] 실기: 손 반전과 Tool 반전이 정확히 상쇄
- [x] 실기: 픽셀이 대상이어도 마스크에 걸리고 픽셀은 그대로
- [x] 실기: `editTarget` 양쪽

# 33. 이미지 크기 (`photoshop.image.resize`)

## `document.crop` 과 갈린다

`crop` 이 `edit` 인 근거는 CORE_API 가 적어 둔 **"픽셀은 버리지 않는다"** 다.
캔버스만 줄이고 바깥 픽셀은 레이어에 남는다. 이쪽은 픽셀을 다시 표본화하고,
축소하면 버려진 해상도가 **문서 어디에도 남지 않는다.** 그래서 CORE_API §5 에
`EDIT` 로 적혀 있던 것을 구현하면서 **`DESTRUCTIVE`** 로 바꿨다.

`mask.apply`(가려 둔 픽셀이 없어진다) · `flatten`(숨긴 레이어를 버린다) 과 같은
종류다. `tests/permission.test.ts` 의 고정 목록이 이 변경을 잡아냈다 — 의도한
변경임을 확인하고 목록에 더했다.

## DOM 에 있다

Adobe 레퍼런스에 `resizeImage(width?, height?, resolution?, resampleMethod?,
amount?)` 가 있다(23.0+). batchPlay 를 쓰지 않았다. `ResampleMethod` 아홉 개 중
`NONE` 은 Adobe 가 "Currently unsupported" 라고 적어 두어 뺐다 — 스키마에 두고
조용히 무시되면 그것이 이 프로젝트의 "조용한 실패" 네 번째가 된다.

`constants.ResampleMethod` 는 타입 선언에 없어서 더했다. 값이 무엇인지 확인한 적이
없으므로 `unknown` 이다 — `SaveOptions` 를 `string` 이라고 잘못 선언했던 자리와
같다(§28).

## 한쪽만 주면 어떻게 되는지는 재 봤다

레퍼런스가 말하지 않는다. 실기에서 셋을 확인했다.

```text
4000×2500  width 2000            →  2000×1250   비율 유지
1920×1200  width 800 height 800  →  800×800     비율 무시, 왜곡
2000×1250 300ppi  resolution 72  →  480×300     픽셀도 함께 줄었다
```

**마지막 줄이 예상 밖이었다.** `resolution` 만 바꾸면 DPI 메타데이터만 고쳐질 것
같지만, 인쇄 크기를 유지한 채 다시 표본화해서 픽셀이 0.24배(72/300)가 된다.
"해상도만 300 에서 72 로 낮춰 줘" 라는 요청에 76% 의 픽셀이 사라진다 — 이 Command 가
`destructive` 인 이유를 가장 잘 보여주는 경우다. Tool 설명에 수치와 함께 적었다.

`constants.ResampleMethod.PRESERVEDETAILS` 는 27.8 에 실제로 있고 동작했다.

## 실기는 임시 문서에서 했다

`document.create` 로 만들어 확인하고 `document.close` 로 닫았다. `destructive` 이고
축소는 되돌릴 수 없으므로 사용자 문서에 걸지 않는다.

## 체크리스트

- [x] `photoshop.image.resize` — `before` · `after` · `applied`
- [x] Permission 을 `EDIT` → `DESTRUCTIVE` 로 바꾸고 CORE_API §9 에 근거를 적었다
- [x] 실기: 비율 유지 · 비율 무시 · `resolution` 단독
- [x] 실기: `PRESERVEDETAILS` 상수 존재 확인

# 34. Redo (`photoshop.history.redo`)

`history.undo` 의 거울이다. 포인터 산술이 같아 `currentIndexOf` 하나로 묶었다 —
`historyStates` 는 되돌려도 줄어들지 않고 `activeHistoryState` 포인터만 움직인다
(§7.3 에서 undo 가 이미 겪은 것이다).

어디 있는지 찾지 못하면 **가장 최근**으로 본다. undo 는 거기서 한 칸 뒤로 가면
되고 redo 는 갈 곳이 없어 실패한다 — 모를 때 임의의 지점으로 뛰는 것보다 아무
데도 안 가는 쪽이 안전하다.

## 실기에서 확인한 것

```text
새 문서에서 redo          →  HISTORY_EMPTY (states 2, index 1)
레이어 만들기 → undo      →  레이어 사라짐
redo                      →  id 2 까지 그대로 돌아옴 ("새 레이어")
undo → 새 레이어 만들기   →  redo 가 HISTORY_EMPTY (states 3, index 2)
```

**마지막 줄이 핵심이다.** 되돌린 뒤 새로 편집하면 Photoshop 이 앞쪽 가지를
버린다. `states` 가 3 인 것이 이력이 잘렸다는 증거다. 이 Tool 의 제약이 아니라
Photoshop 의 동작이므로 Tool 설명에 그렇게 적었다.

## Mock 이 같은 규칙을 갖는다

Mock 의 `#undo` 는 이력을 **pop** 하기만 해서 redo 가 불가능했다. redo 스택을
두고, **`#snapshot` 이 그것을 비우게** 했다 — 새 편집이 앞쪽 가지를 버리는 것이
그 자리다. 흉내내지 않으면 "되돌리고 편집한 뒤에도 redo 가 된다" 는 있을 수 없는
상태가 테스트에서 정상으로 보인다.

## 임의 지점 복원은 넣지 않았다

이름으로 지점을 고르게 하면 같은 이름이 여러 개일 때 어디로 갈지 알 수 없다 —
액션 이름이 유일하지 않았던 것과 같은 문제다(§17.34).

## 체크리스트

- [x] `photoshop.history.redo` — 결과 모양이 `undo` 와 같다
- [x] 실기: undo → redo 왕복, id 까지 복원
- [x] 실기: 새 편집이 앞쪽 이력을 버리는 것
- [x] Mock 이 redo 스택과 "새 편집이 비운다" 를 갖는다

# 35. 문서 복제 (`photoshop.document.duplicate`)

**되돌릴 수 없는 작업 앞의 안전망이다.** `image.resize`(§33) · `document.flatten` ·
`mask.apply` 를 복제본에서 하면 원본이 남는다. 파일을 만들지 않고 메모리 안에
새 문서를 열므로 `external` 이 아니라 `edit` 이다.

## 함정은 이미 풀려 있었다

`Document.duplicate()` 가 돌려준 객체의 `id` 가 `undefined` 일 때가 있다는 것을
`export_tiff` 를 고치며 잡아 두었다(`duplicated-document.ts`). **여기서 새로 짜지
않고 그 헬퍼를 그대로 썼다** — 새로 짰으면 같은 실수를 다시 했을 것이다.

어느 것이 복제본인지 좁혀지지 않으면 **추측하지 않고 실패한다.** 이 Command 를
만든 이유가 되돌릴 수 없는 작업을 원본에 거는 것을 막는 것인데, 틀린 추측은
정확히 그 사고를 일으킨다.

## 실기에서 확인한 것

```text
레이어 3장 문서 복제        →  id 130, layers 3, activeDocumentId 130
mergeLayersOnly: true       →  id 133, layers 1
그 뒤 원본                  →  레이어 3장 그대로 (id 1·2·3)
이름 생략                   →  "DUP-TEST 복사"
```

**복제본이 활성이 된다.** 다만 그렇게 적어 두지 않고 `activeDocumentId` 에 읽은
값을 담는다 — 그렇지 않은 날 호출자가 원본을 편집하게 된다. `document.create` 와
같은 자리다.

**`mergeLayersOnly` 는 이름이 말하는 것과 다르다.** 원본의 레이어를 합치는 것이
아니라 합친 결과 한 장만 복제본에 넣는다. 원본이 3장 그대로인 것을 확인했다.
요청값을 되풀이하지 않고 `layers` 로 드러낸다.

## Mock 은 실패한다

Mock 은 문서를 하나만 들고 있어 진짜 복제본을 만들 수 없다. 그럴듯한 값을
돌려주면 **이 Command 가 막으려는 바로 그 사고**가 난다 — 호출자가 원본을
복제본으로 알고 되돌릴 수 없는 작업을 건다. `DOCUMENT_OPEN` 과 같은 규칙이다.

## 체크리스트

- [x] `photoshop.document.duplicate` — `activeDocumentId` · `layers` 로 사실을 알린다
- [x] `duplicated-document.ts` 헬퍼 재사용
- [x] 실기: 기본 복제 · `mergeLayersOnly` · 원본 보존 · 이름 생략
- [x] Mock 은 한 척하지 않고 실패한다

# 36. 캔버스 크기 (`photoshop.canvas.resize`)

`image.resize`(§33) 와 다르다. 그쪽은 픽셀을 다시 표본화해 그림이 통째로 커지거나
작아지고, 이쪽은 그림은 그대로 두고 **종이 크기만** 바꾼다. 여백을 더하거나
덜어낼 때가 이쪽이다.

**생략한 쪽의 뜻도 다르다.** `image.resize` 는 비율을 맞추고 이쪽은 지금 값을
그대로 쓴다 — 캔버스에는 맞출 비율이 없다.

## Permission 을 짐작하지 않고 재서 갈랐다

처음에는 `document.crop` 과 같은 계열이니 `edit` 이라고 두었다. **틀렸다.**

빨간 얼룩을 구운 배경으로 같은 왕복(800×600 → 300×200 → 800×600)을 돌렸다.

```text
                  빨간 영역          green 평균      결과
일반 레이어       경계 140–660 유지   —              완전 왕복
document.crop     44.245% 유지        142.18 유지     완전 왕복
canvas.resize     44.245% → 2.584%    142.18 → 248.41 픽셀 소멸
```

**`crop` 의 `delete: false` 가 하는 일은 배경을 일반 레이어로 승격시키는 것**이다
(id 1 → 3, 이름 `레이어 0`). 배경은 캔버스 밖에 픽셀을 가질 수 없으므로 그래야
남길 수 있다. `resizeCanvas` 는 승격시키지 않아 배경의 바깥 픽셀이 사라진다.

그래서 `canvas.resize` 를 **`DESTRUCTIVE`** 로 두었다. **"우회 가능한 경계" 문제도
없다** — `crop` 이 무손실 대안을 이미 제공하므로, 막혔을 때 그쪽으로 가면 파괴
없이 같은 구도를 얻는다. 반대로 둘을 같은 등급에 두면 이 차이가 묻힌다.

`document.crop` 의 `pixelsRetained: true` 는 **사실이었다.** 재 보기 전에는
배경에서 깨지는 줄 알았고 문서를 고칠 뻔했다. 짐작으로 고쳤으면 맞는 문서를
틀리게 만들었을 것이다.

## 덤으로 나온 것 — `crop` 이 id 를 바꾼다

승격 때문에 **배경 레이어의 id 가 바뀌는데 `document.crop` 의 결과에는 그것이
없다.** 호출자가 들고 있던 id 는 사라진다. 이 프로젝트가 이미 세 번 겪은
유형이다(`set_opacity` 승격 · `smart_object.convert` · `layer.from_background`).
당장은 Tool 설명에 "`layer.list` 로 다시 읽으라" 고 적었다.

- [x] `document.crop` 이 승격된 레이어 id 를 결과에 담는다 (`promoted`)

## 체크리스트

- [x] `photoshop.canvas.resize` — `before` · `after` · `applied` · `anchor`
- [x] Permission 을 실기 측정으로 `DESTRUCTIVE` 로 정했다
- [x] 실기: 일반 레이어 왕복 · 배경 소멸 · `crop` 대조군
- [x] `anchor` 아홉 가지, 모르는 값은 거절

# 37. 재단 (`photoshop.document.trim`)

캔버스를 줄이는 셋째 길이다. **무엇을 남길지 정하는 주체가 다르다.**

```text
document.crop     호출자가 좌표로 정한다
canvas.resize     호출자가 크기와 기준점으로 정한다
document.trim     Photoshop 이 픽셀을 보고 정한다
```

그래서 이것만 **얼마나 잘릴지 미리 알 수 없다.** `before` · `after` · `removed`
로 알린다. 다만 **어느 면이 얼마나 잘렸는지는 알 수 없다** — 가로·세로 총량뿐이다.
지어내지 않고 그렇게 적었다.

## 실기에서 잰 것

```text
투명 둘레, 반지름 200 얼룩   800×600 → 400×400   정확히 얼룩 경계
같은 문서에서 한 번 더       400×400 그대로       changed: false, 오류 아님
topLeft, left·right false    800×600 → 800×400   너비는 손대지 않았다
```

면 선택이 정확히 동작한다. `changed: false` 는 오류가 아니다 — `layer.reorder`
가 맨 위에서 `moved: false` 를 주는 것과 같다.

## `canvas.resize` 보다 위험하다

§36 에서 `canvas.resize` 가 **일반 레이어의 캔버스 밖 픽셀을 남긴다**는 것을
확인했다. 재단은 다르다.

```text
canvas.resize   일반 레이어 유지 (배경만 잘린다)
document.trim   일반 레이어도 잘린다
```

**숨긴 레이어가 가장 위험하다.** 자를 범위는 **보이는 것**으로 정해지는데, 숨긴
레이어에 그 밖의 내용이 있으면 조용히 사라진다. 실기에서 코너에 찍어 둔 파란
얼룩(640–760, 440–560)을 숨기고 재단했더니 `bounds` 가 0 이 되었다 — 레이어는
남고 내용만 없어진다.

`document.flatten` 이 숨긴 레이어를 버리는 것과 같은 종류의 놀라움이다. 그래서
`DESTRUCTIVE` 이고, Tool 설명에 "숨긴 레이어가 있으면 `layer.list` 로 먼저
확인하라" 고 적었다.

배경 레이어는 숨겨져 있어도 잘린다 — 캔버스와 같은 크기가 강제되기 때문이다.

## Mock 은 실패한다

무엇을 여백으로 볼지는 **픽셀을 봐야** 정해지는데 Mock 에는 픽셀이 없다.
그럴듯한 크기를 돌려주면 그것을 보고 짠 워크플로가 실기에서 다르게 돈다 —
`MEASURE_TILT` 가 각도를 지어내지 않는 것과 같다.

## 체크리스트

- [x] `photoshop.document.trim` — `before` · `after` · `removed` · `changed`
- [x] 실기: `transparent` · `topLeft` · 면 선택 · `changed: false`
- [x] 실기: 숨긴 일반 레이어의 내용이 사라지는 것
- [x] Mock 은 한 척하지 않고 실패한다

# 38. 색상 모드 (`photoshop.document.mode_convert`)

## 일곱 중 넷만 열었다

`ChangeMode` 에는 `BITMAP` · `CMYK` · `GRAYSCALE` · `INDEXEDCOLOR` · `LAB` ·
`MULTICHANNEL` · `RGB` 가 있는데 **넷만 내놓았다.**

`BITMAP` · `INDEXEDCOLOR` 는 Photoshop UI 에서 설정 대화상자를 띄운다.
**대화상자가 뜨면 플러그인이 멈추고 Bridge 가 15초에 타임아웃한다** — 이
프로젝트에서 네 번 반복된 실패 유형이다(§17.11 · §17.25 · §17.26 · §17.34).
`options` 인자로 피할 수 있을지도 모르지만 **실기에서 뜨지 않는 것을 확인하기
전에는 열지 않는다.** `MULTICHANNEL` 은 이 서버의 쓰임과 멀다.

## 실기에서 확인한 것

네 모드를 이어서 돌렸다. **대화상자는 한 번도 뜨지 않았고 레이어도 그대로였다.**

```text
rgb        →  이미 RGB. 아무것도 안 함 (layersDiscarded 0)
grayscale  →  RGB → Grayscale   레이어 2 → 2
cmyk       →  Grayscale → CMYK  레이어 2 → 2
lab        →  CMYK → Lab        레이어 2 → 2
rgb        →  Lab → RGB         레이어 2 → 2
```

Photoshop UI 가 묻는 "색상 정보를 버릴까요?" 는 스크립팅 경로에서 나오지 않는다.

## 색은 돌아오지 않는다 — `destructive` 의 근거

같은 문서의 얼룩을 왕복 전후로 쟀다.

```text
칠한 색        (220, 40, 90)  분홍
왕복 뒤        (146.92, 146.78, 146.97)  회색
```

`grayscale` 단계에서 채널이 사라졌고 RGB 로 돌아와도 복구되지 않는다. 문서
어디에도 원래 값이 남지 않으므로 `DESTRUCTIVE` 다 — `image.resize` 가 해상도를
버리는 것과 같은 자리다. CORE_API §5 에 `EDIT` 로 적혀 있던 것을 바꿨다.

## 같은 모드로 부르면 아무것도 하지 않는다

Photoshop 에 그대로 넘기면 얻는 것 없이 평탄화만 될 수 있다. 먼저 읽어서
같으면 건너뛴다. Mock 도 같은 규칙을 갖는다.

## 흑백은 이 Tool 이 아닐 수 있다

`grayscale` 은 채널 자체를 없애 이후 색 보정이 불가능해진다. 비파괴로 흑백을
얻으려면 `adjustment.hue_saturation` 이나 `camera_raw.apply` 쪽이다. Tool
설명에 그렇게 적었다 — 호출자가 "흑백" 이라는 말만 보고 이쪽으로 오기 쉽다.

## 체크리스트

- [x] `photoshop.document.mode_convert` — `before` · `after` · `applied` · `layersDiscarded`
- [x] Permission 을 `EDIT` → `DESTRUCTIVE` 로 바꾸고 근거를 측정으로 남겼다
- [x] 실기: 네 모드 · 대화상자 없음 · 레이어 유지 · 색 소멸
- [ ] `bitmap` · `indexedColor` — 대화상자가 뜨지 않는 것을 확인하면 연다

# 39. 비트 심도 (`photoshop.document.bit_depth_convert`)

## 메서드가 아니라 속성이다

`bitsPerChannel` 은 읽기/쓰기 속성이고 **문자열 상수**를 받는다(`"bitDepth16"`).
숫자를 대입하면 조용히 무시된다 — `export_tiff` 가 이미 그렇게 쓰고 있었고 실기에서
검증된 경로라 새로 짜지 않고 그것을 따랐다. 지식은 `document-bit-depth.ts` 한
곳에 모았다.

속성 대입이 조용히 무시되는 것은 이 프로젝트에서 반복된 실패 유형이다(배경
`set_opacity` · Camera Raw 정수 · 파라메트릭 곡선). 그래서 쓰고 나서 **읽어
확인하고**, 안 들어갔으면 실패로 답한다.

## 실기에서 확인한 것

```text
8  → 16   applied true
16 → 8    applied true
8  → 32   applied true   ← "bitDepth32" 는 검증된 적이 없던 문자열이다
32 → 16   applied true   ← HDR Toning 대화상자가 **뜨지 않았다**
```

**32 → 16 이 가장 걱정이었다.** Photoshop UI 에서는 HDR Toning 대화상자가 뜨는
경로인데 스크립팅 경로에서는 뜨지 않았다. `mode_convert`(§38) 에서 "색상 정보를
버릴까요" 가 안 뜬 것과 같다.

1비트는 열지 않았다. Bitmap 색상 모드에서만 뜻이 있고 그 모드는 §38 에서도
대화상자 위험으로 빼 두었다.

**계조가 버려지는 것 자체는 재지 않았다.** 16 → 8 이 계조를 잃는 것은 정보이론이지
Photoshop 의 버릇이 아니다. 이 프로젝트가 재는 것은 짐작할 수 없는 쪽이다.

## 덤으로 잡은 버그 — `document.create` 의 `bitDepth` 가 먹지 않았다

`bitDepth: 16` 으로 문서를 만들었더니 8비트가 나왔고 `applied.bitDepth` 가
`false` 였다. **`documents.add` 가 그 키를 무시한다.** 두 번 재현했다.

`document-create.ts` 는 이 키를 "문서에 없는 키" 라고 적어 두고 "먹는지는
`applied.bitDepth` 가 말한다 — 안 먹으면 파라미터를 뺀다" 고 해 두었다.
**`applied` 를 둔 것이 값을 했다.** 없었으면 8비트 문서를 16비트로 알고
외부 처리기를 돌렸을 것이다.

빼는 대신 **고쳤다.** 이제 검증된 경로를 아니까 만든 뒤에 다시 건다. Mock 도
맞췄다 — 8 로 고정돼 있으면 이 수정이 테스트에 나오지 않는다.

**한동안 먹는 것처럼 보였다.** 오늘 앞서 만든 문서들이 16비트로 나왔는데 그것은
Photoshop 의 새 문서 기본값이 마침 16이었기 때문이다. `applied` 가 없었으면
"된다" 고 적고 넘어갔을 자리다.

## 체크리스트

- [x] `photoshop.document.bit_depth_convert` — `before` · `after` · `applied`
- [x] 실기: 8·16·32 왕복, `"bitDepth32"` 확인, 32→16 대화상자 없음
- [x] `document.create` 의 `bitDepth` 를 만든 뒤 다시 걸도록 고쳤다
- [x] 실기: 고친 `document.create` 가 요청한 심도를 준다 (16 · 32 확인)

# 40. 보이는 레이어 병합 (`photoshop.document.merge_visible`)

## 셋이 비슷하고 셋 다 다르다

```text
layer.stamp_visible      합친 **복제본**을 만든다. 원본은 남는다      edit
document.merge_visible   보이는 것을 합친다. **숨긴 것은 남는다**    destructive
document.flatten         전부 합친다. **숨긴 것은 버려진다**          destructive
```

Adobe 레퍼런스가 넷째 차이를 알려준다 — **`flatten` 은 남는 레이어를 언제나
배경으로 만들지만 `mergeVisibleLayers` 는 배경이 없으면 만들지 않는다.**

## 조용한 실패를 잡았다

**활성 레이어가 숨겨져 있으면 아무 일도 일어나지 않는다.** 오류도 없고 레이어
수도 그대로다.

```text
활성 = HIDDEN(숨김)   before 4/3/1  →  after 4/3/1   removed 0
활성 = V2(보임)       before 4/3/1  →  after 2/1/1   removed 2
```

**결과에 전후 개수를 담아 둔 덕에 드러났다.** 담지 않았으면 성공으로 보고했을
것이다. 이 프로젝트가 반복해서 겪은 유형이다(배경 `set_opacity` · Camera Raw
정수 · 파라메트릭 곡선 · `documents.add` 의 `bitsPerChannel`).

Photoshop UI 에서도 숨긴 레이어가 선택돼 있으면 `보이는 레이어 병합` 이 회색
처리된다. **레퍼런스에는 이 전제가 적혀 있지 않다** — 실기에서만 나온다.
미리 막고 "보이는 레이어를 먼저 고르라" 고 말한다.

## 숨긴 레이어는 내용까지 남는다

병합 뒤 `HIDDEN` 의 `bounds` 가 100,50–200,150 로 그대로였다. `flatten` 과
갈리는 자리를 측정으로 확인했다.

## 남는 레이어를 짐작했다가 틀렸다

Mock 을 "가장 아래 보이는 레이어" 로 짜 두었는데 **배경이 있는 문서에서 우연히
맞아떨어져** 드러나지 않았다. 배경 없는 문서로 두 번 재서 갈랐다.

```text
배경 있음, V2 선택        →  배경(id 1) 이 남는다. isBackground 유지
배경 없음, 아래쪽 선택    →  아래쪽이 남는다
배경 없음, 위쪽 선택      →  위쪽이 남는다
```

**배경이 있으면 배경, 없으면 선택한 레이어다.** 레퍼런스의 "the name of the
merged layer will be either that of the top of the selected layers or the top
layer" 와 맞는다. Mock 도 그렇게 고쳤다.

## 체크리스트

- [x] `photoshop.document.merge_visible` — `before` · `after` · `removed`
- [x] 실기: 숨긴 레이어가 내용까지 남는 것
- [x] 실기: 활성 레이어가 숨겨져 있으면 조용히 실패하는 것 → 미리 막는다
- [x] 실기: 배경 유무에 따라 남는 레이어가 다른 것

# 41. 붙여 넣기 (`photoshop.document.paste`)

## 이 서버에서 성격이 다른 하나다

나머지 Command 는 문서 안에서 끝나는데 **이것은 사용자의 클립보드를 문서로
끌어들인다.** 무엇이 들어올지 서버도 호출자도 알 수 없다.

들어온 것은 `document.capture` · `document.statistics` 로 읽을 수 있다. 즉 이
Command 는 **사용자의 클립보드를 LLM 이 볼 수 있게 만드는 통로**다. 그래서
`EXTERNAL` 이고 기본 허용 밖이다 — `layer.place` 와 같은 논리이며 **클립보드는
폴더 승인조차 없다.**

**복사하는 Tool 은 만들 수 없다.** Adobe 레퍼런스에 `Document.paste` 하나뿐이고
`copy` · `cut` 이 없다. 클립보드를 채우는 것은 언제나 사용자다.

## 빈 클립보드에 **던지지 않는다** — 거짓말을 할 뻔했다

`paste()` 는 클립보드가 비어도 오류를 내지 않고 `null` 을 돌려준다. 문서는
그대로다. 첫 구현은 그 경우에 이렇게 답했다.

```text
"붙여 넣었지만 결과 레이어를 확인하지 못했습니다."
```

**거짓말이다.** 아무 일도 일어나지 않았는데 문서가 바뀐 것처럼 말한다.
`layer.list` 로 확인해 보니 배경 한 장 그대로였다.

고친 뒤에는 레이어 목록을 전후로 떠서 판단한다 — 늘지 않았으면 "붙여 넣어지지
않았습니다 — 문서는 그대로입니다", 늘었으면 돌려받은 객체가 쓸모없어도 새 id 로
찾아낸다. `resolveMutatedLayer` · `duplicated-document.ts` 와 같은 규칙이다.

## 실기에서 확인한 것

```text
선택 없이 intoSelection: true   →  미리 거절
빈 클립보드                      →  문서 그대로, 실패로 보고
복사 후 붙여넣기                 →  bounds 50,50–250,170 (복사한 그대로)
intoSelection: true              →  hasMask true, 180×120 으로 잘려 가운데 정렬
```

**`intoSelection` 은 마스크를 만든다.** 선택 영역이 마스크가 되고 내용이 그
안에 맞춰진다. 200×120 을 180×130 선택에 넣었더니 180×120 이 되었다.

**위치는 짐작하지 않는다.** 선택 영역이 있는 채로 붙여 넣었더니 그 자리에
들어왔는데, "제자리에 붙이기" 인지 "선택에 맞춰 가운데" 인지 한 번의 측정으로는
가를 수 없다. `bounds` 를 읽으라고 적었다.

## Mock 은 실패한다

클립보드가 없다. 그럴듯한 레이어를 만들면 **오지 않은 내용이 들어왔다고 믿게
된다** — `DOCUMENT_OPEN` · `DOCUMENT_DUPLICATE` 와 같은 규칙이다.

## 체크리스트

- [x] `photoshop.document.paste` — `layer` · `bounds` · `intoSelection`
- [x] `EXTERNAL` 로 분류하고 근거를 적었다
- [x] 실기: 빈 클립보드에서 거짓말하던 것을 고쳤다
- [x] 실기: 붙여넣기 · `intoSelection`(마스크 생성) · 선택 없는 거절

# 42. §30 과 §36 의 남은 것을 정리했다

## `document.crop` 이 승격된 id 를 알린다 (§36)

배경은 캔버스 밖에 픽셀을 가질 수 없어 자르기가 **일반 레이어로 승격시키고
id 를 바꾼다.** 그 사실이 결과에 없어 호출자가 들고 있던 id 가 조용히 사라졌다.

```text
promoted { previousId 1, layer { id 2, "레이어 0", isBackground false } }
배경 없는 문서에서 다시 자르기  →  promoted null
```

**짝지을 수 있을 때만 말한다** — 배경이 있었고, 그 id 가 사라졌고, 새 id 가
정확히 하나 생겼을 때다. 하나로 좁혀지지 않으면 `null` 이다. 짐작한 id 를
주면 호출자가 엉뚱한 레이어를 편집한다(`duplicated-document.ts` 와 같은 규칙).

Mock 도 승격을 흉내낸다. 안 하면 "id 가 바뀐다" 는 계약이 테스트에 안 나온다.

## `SaveOptions` 짐작을 없앴다 (§30-1)

`export-tiff.ts` · `export-mask.ts` 가 복제본을 닫을 때 `?? "no"` 로 짐작하고
있었다. `document.close` 는 같은 자리에서 **부르지 않고 실패**하는데, 그 규칙을
주석으로 적어 둔 채 두 곳이 어기고 있었다.

**`try/catch` 는 도움이 안 된다 — 대화상자는 던지지 않고 멈춘다.**

`closeWorkDocument()` 한 곳으로 모았다. 상수가 없으면 닫지 않고 **남겨 둔 채로
알린다** — 내보내기 결과는 이미 유효하므로 실패로 만들지 않지만, 남은 복제본은
다음 Command 의 `activeDocument` 가 되므로 조용히 넘기지도 않는다.

`duplicated-document.ts` 에 두려다 **의존성 없이 단위 테스트되던 파일**이라는
것이 `typecheck:tests` 에서 드러나 `close-work-document.ts` 로 뺐다.

## 능력 가드 오류 코드 — 일곱이 아니라 여섯 (§30-2)

`COMMAND_FAILED` 로 나가던 능력 가드를 `COMMAND_NOT_SUPPORTED` 로 바꿨다.

```text
document.rotate · app.SolidColor · document.createTextLayer
app.fonts · app.actionTree (두 곳)
```

**일곱째는 바꾸지 않았다.** `action-play.ts` 의 `이 액션에 play() 가 없습니다`
는 "이 Photoshop 에 API 가 없다" 가 아니라 **그 액션 하나가 이상한 것**이다 —
다른 액션은 된다. 호스트 능력 부족으로 분류하면 호출자가 잘못 판단한다.
훑어서 나온 목록을 그대로 적용하지 않았다.

## `capture` 의 `getData` — 실패로 정했다 (§30-3)

변환이 필요한데(`16비트` 또는 알파 포함) `getData` 가 없으면 조용히 건너뛰고
있었다. 그러면 16비트 데이터가 그대로 인코더로 가고, 나오는 것은 오류가 아니라
**절반 밝기의 그림**이다 — 호출자는 그것을 보고 노출을 판단한다.

`document.statistics` · `measure.tilt` 는 같은 자리에서 이미 실패한다. 셋이
달랐던 것을 맞췄다. 변환이 필요 없을 때는 `getData` 가 없어도 상관없다.

실기에서 8비트·16비트 문서 양쪽으로 캡처가 정상인 것을 확인했다.

## 체크리스트

- [x] `document.crop` 의 `promoted` — 실기 확인
- [x] `closeWorkDocument()` 로 `?? "no"` 제거
- [x] 능력 가드 여섯 곳 `COMMAND_NOT_SUPPORTED`
- [x] `capture` 가 변환 불가 시 실패

# 43. 레이어 잠금 (`photoshop.layer.set_lock`)

## 레퍼런스와 실기가 달랐다

Adobe 레퍼런스는 넷을 **각각 읽기/쓰기 불린**으로 적는다.

```text
allLocked · pixelsLocked · positionLocked · transparentPixelsLocked   읽기/쓰기
locked                                                                읽기 전용
```

실기는 다르다. **하나를 쓰면 나머지가 전부 지워진다.**

```text
pixels true              →  pixels true, 나머지 false
그 뒤 position true      →  position true, pixels **false**
그 뒤 transparent true   →  transparent true, position **false**
그 뒤 all false          →  전부 false
```

즉 **한 번에 하나만 걸 수 있다.** 넷이 아니라 다섯 갈래의 단일 상태다.

## 그래서 API 를 다시 짰다

처음에는 네 불린을 받는 Tool 로 만들었다. 그러면 `pixels` 와 `position` 을
함께 달라는 **절대 성공할 수 없는 요청**을 받아들이게 된다 — 스키마가 되지 않는
일을 되는 것처럼 보이게 하는 셈이다. 단일 `lock` 값으로 바꿨다.

```text
none · all · pixels · position · transparentPixels
```

`none` 이 "전부 풀기" 다 — `allLocked = false` 가 그 일을 한다.

**`lock` / `unlock` 두 Tool 로 나누지 않은 이유는 그대로다.** 무엇을 잠갔는지가
사라지고, `locked` 는 읽기 전용이라 대상이 될 수도 없다.

## 결과는 다섯을 그대로 준다

단일 값으로 요약하지 않는다. **배경 레이어가 `position` 과
`transparentPixels` 를 동시에 갖기 때문**이다 — 설정기로는 도달할 수 없는
상태이고, 요약하면 그 사실을 말할 수 없다.

```text
배경   any true · all false · pixels false · position true · transparentPixels true
```

배경의 잠금은 **풀리지 않는다.** 대입이 조용히 무시되므로 읽어서 확인하고
실패로 답한다 — `layer.from_background` 를 안내한다.

## `mutate()` 규칙을 안 따라 한 번 데었다

배경의 `positionLocked` 를 풀려다 이렇게 끝났다.

```text
COMMAND_FAILED: The 레이어 with an id of undefined does not exist.
```

**이 프로젝트가 아는 참조 무효화다.** 쓰기 뒤에 원래 참조로 읽었기 때문이고,
`mutate()` 가 존재하는 바로 그 이유였다. id 를 미리 떠 두고 뒤에 다시 찾도록
고쳤으며, `readLocks` 는 속성 접근 자체가 던질 수 있어 `try/catch` 로 감쌌다.

## `layer.get` 도 다섯으로 채웠다

둘만 주고 있어 `set_lock` 으로 건 값을 확인할 길이 없었다. 쓰는 쪽과 읽는 쪽의
어휘가 같아야 한다.

## 체크리스트

- [x] `photoshop.layer.set_lock` — 단일 `lock`, `locks` 다섯, `applied`
- [x] `photoshop.layer.get` 이 잠금 다섯을 모두 돌려준다
- [x] 실기: 배타성 · `none` · `all` · 배경 거절
- [x] Mock 이 배타성을 흉내낸다

# 44. 레이어 뒤집기 (`photoshop.layer.flip`)

DOM 이 `flip(axis: FlipAxis)` **하나**이고 축이 셋이다. `flip_horizontal` /
`flip_vertical` 둘로 나누면 **`both` 를 쓸 수 없고**, `mask.select` ·
`document.trim` 이 잡아 둔 "한 Tool + 축 파라미터" 관례와도 어긋난다.

## `constants.FlipAxis` 가 **없다**

Adobe 레퍼런스는 `FlipAxis` 에 `BOTH` · `HORIZONTAL` · `VERTICAL` 이 있다고
적는데, **Photoshop 27.8 런타임에는 `constants.FlipAxis` 자체가 없다.**

```text
hasTable false · available []
```

없다는 말만 하는 오류로는 "상수가 없는 것인지 이름이 다른 것인지" 를 가를 수
없어, **무엇이 있는지 함께 담도록** 오류를 고쳤다. 그 한 줄이 답을 줬다.

상수가 있으면 그것을, 없으면 **소문자 축 이름**(`"horizontal"`)을 넘긴다.
짐작으로 둔 것이 아니라 실기에서 그림으로 확인한 경로다.

## 레이어 자기 경계 기준이다

캔버스가 아니라 **레이어의 경계 상자** 안에서 뒤집힌다.

```text
                경계              내용
뒤집기 전       40–335 × 20–255   빨강 왼쪽 위 · 파랑 오른쪽 아래
horizontal      그대로            빨강 오른쪽 위 · 파랑 왼쪽 아래
vertical        그대로            빨강 오른쪽 아래 · 파랑 왼쪽 위
both            그대로            원래 배치 (앞의 둘을 상쇄)
```

**대칭인 원 하나로는 확인이 안 됐다.** 처음 시도가 그랬다 — 경계도 그대로고
그림도 같아서 "안 된 것" 과 구분되지 않았다. 크기와 색이 다른 얼룩 둘을
대각선으로 두고 나서야 갈렸다. **검증할 수 없는 시험은 시험이 아니다.**

## Mock 은 경계를 지어내지 않는다

픽셀을 모르므로 `null` 이다. 어차피 경계로는 뒤집혔는지 알 수 없어 잃는 것도
없다 — `LAYER_GET` 의 `bounds` 와 같은 규칙이다.

## 체크리스트

- [x] `photoshop.layer.flip` — `axis` 셋, `before` · `after`
- [x] `constants.FlipAxis` 부재를 확인하고 문자열 경로로 우회
- [x] 오류가 **무엇이 있는지** 함께 알린다
- [x] 실기: 세 축 모두 그림으로 확인

# 45. 굽기 (`photoshop.layer.rasterize`)

## 이름을 옮겼다

CORE_API §5 에는 `photoshop.smart_object.rasterize` 로 올라 있었는데 실제 API 는
**`Layer.rasterize(target)`** 이고 스마트 오브젝트만의 일이 아니다 — 텍스트 ·
모양 · 레이어 스타일도 같은 메서드로 굽는다. `layer.rasterize` 로 옮기고
`DESTRUCTIVE` 분류는 그대로 가져왔다.

## 열 가지 중 여섯만 열었다

`linkedLayers` · `placed` · `video` · `layerClippingPath` 는 이 서버의 쓰임과
멀다. 안 쓰는 값이 스키마에 있으면 호출자가 무엇이 중요한지 모른다 — `text` 가
자간·행간을 열지 않은 것과 같은 판단이다.

여섯 상수가 **모두 실제로 있었다.** `FlipAxis` 처럼 표가 통째로 없는 경우가
있어(§44) 여섯을 하나씩 확인했다.

## 실기에서 짐작이 두 개 틀렸다

**1. id 가 바뀌지 않는다.** `smart_object.convert` 가 바꾸길래 굽기도 그럴 줄
알고 결과에 `previousId` 를 두고 목록 대조까지 넣었다. 스마트 오브젝트와 텍스트
둘 다 id 가 유지됐다.

```text
smartObject id 3  →  rasterize  →  pixel id 3
text        id 4  →  rasterize  →  pixel id 4
```

대조 코드는 남겼다 — 다른 대상·다른 버전에서 바뀌면 그때 드러나야 한다.

**2. 할 일이 없어도 오류가 아니다.** "이미 픽셀 레이어이거나 해당 내용이 없으면
실패한다" 고 Tool 설명에 적었는데, 이미 픽셀인 레이어에 걸어도 **조용히
성공한다.** 네 대상(`layerStyle` · `vectorMask` · `shape` · `fillContent`)을
해당 내용이 없는 레이어에 걸었을 때도 마찬가지였다.

실패로 만들지 않고 설명을 고쳤다 — `entireLayer` 로 걸었을 때 `previousType` 이
`pixel` 이면 아무 일도 없었다는 뜻이고, 그것을 호출자가 읽는다.

## 체크리스트

- [x] `photoshop.layer.rasterize` — `previousType` · `previousId` · `target`
- [x] `smart_object.rasterize` 항목을 옮겼다
- [x] 실기: 여섯 상수 존재 · 스마트 오브젝트 · 텍스트 · id 유지 · 무해한 재실행

# 46. 레이어 병합 (`photoshop.layer.merge`)

## 선택 개수로 뜻이 달라진다

Adobe 레퍼런스가 적는다 — "Combines selected layers; merges one layer downward
if only one is selected."

```text
하나 선택   →  아래로 병합 (Merge Down)
여럿 선택   →  그것들끼리 병합
```

**숨은 의존성을 그대로 두지 않았다.** `layerIds` 를 주면 이 Command 가 먼저
선택한다 — 호출자가 "지금 무엇이 선택돼 있는지" 를 추적해야 결과를 예측할 수
있는 API 는 조용히 틀린다(§17.20). 어느 쪽이었는지는 `mergedDown` 에 담는다.

## 결과 레이어를 못 찾아 한 번 실패했다

첫 실기에서 이렇게 끝났다.

```text
COMMAND_FAILED: 합쳤지만 결과 레이어를 확인하지 못했습니다. (before 4, after 3)
```

**병합은 됐는데** 남는 레이어를 못 찾았다. 아래로 병합의 결과는 **바로 밑
레이어**여서 대상 목록에도 없고 새로 생긴 id 도 아니다.

그리고 **`merge()` 의 반환값을 쓰지 않고 있었다.** `Promise<Layer>` 를 돌려주는데
무시했다. 네 갈래로 고쳤다 — 반환값 → 살아남은 대상 → 새 id → 바로 밑 레이어.
반환값을 먼저 쓰되 **믿지는 않는다**(`duplicate()` 의 `id: undefined` 전례).

## 숨긴 레이어는 조용히 아무 일도 안 한다

```text
내용 있는 숨긴 레이어  →  before 3 · after 3 · 오류 없음
보이게 한 뒤          →  before 3 · after 2 · 두 색이 한 장에
```

`mergeVisibleLayers` 와 같은 자리다(§40). **전후 개수를 세는 검사가 바로 값을
했다** — 없었으면 성공으로 보고했을 것이다.

빈 숨긴 레이어는 병합됐다. 내용이 있고 없고로 갈리는 것으로 보이지만 두
경우만 봤으므로 규칙을 못 박지 않는다.

## 맨 아래로는 아래로 병합할 수 없다

같은 부모 안에서 마지막이면 아래가 없다. Photoshop 은 이유를 말해 주지 않아
미리 막는다.

## 체크리스트

- [x] `photoshop.layer.merge` — `merged` · `mergedDown` · 전후 개수
- [x] 실기: 아래로 병합 · 여럿 병합 · 맨 아래 거절 · 숨긴 레이어
- [x] `merge()` 반환값을 쓰고, 믿지 않고 확인한다

# 47. 레이어 변환 셋 (`translate` · `scale` · `rotate`)

## 단위를 재려다 레퍼런스에서 읽었다

타입 서명만 보면 `number | PercentValue | PixelValue` 라 맨 숫자가 무슨 단위인지
알 수 없다. **실기로 재려고 준비했는데 레퍼런스의 예제 코드에 다 있었다.**

```js
await layer.translate(-200, 0)                       // 픽셀
let xOffsetPct = {_unit: "percentUnit", _value: 0};  // PercentValue 만드는 법
await layer.scale(80, 80)                            // 퍼센트
await layer.rotate(-90, anchorPos.TOPLEFT)           // 도
```

**`options` 를 "문서화되어 있지 않아 열지 않았다" 고 적을 뻔했다.** 틀렸다 —
`options.interpolation: InterpolationMethod` 가 적혀 있고 여섯 가지다.
`image.resize` 의 `resample` 과 같은 자리라 열었다.

`PercentValue` 는 만드는 법을 알았지만 **열지 않았다.** `translate` 를 퍼센트로
주는 쓰임이 이 서버에 없다. 필요해지면 그때 더한다.

## 실기로 확인한 것

```text
translate(200, 50)                 left 100→300 · top 50→100 · 크기 불변
scale(50,50) anchor topLeft        100×100 → 50×50 · 좌상단 (300,100) 고정
scale(200,200) anchor bottomRight  50×50 → 100×100 · 우하단 (350,150) 고정
rotate(90) anchor middleCenter     144×24 → 24×144 · 중심 유지
rotate(90) 비대칭 표식             오른쪽 → **아래**  = 시계 방향
```

**기준점이 실제로 다르다.** `topLeft` 와 `bottomRight` 가 서로 다른 점을
고정하는 것을 좌표로 확인했다. **회전 부호는 시계 방향 양수**이고
`document.rotate` 와 같다(§17.19).

대칭인 막대로는 회전 부호를 가를 수 없었다 — `flip` 때와 같은 함정이라(§44)
한쪽 끝에 노란 표식을 달고 나서야 갈렸다.

## 등급이 셋 다 다르다

```text
translate   edit         다시 표본화하지 않는다. 반대로 부르면 제자리
scale       destructive  줄이면 되돌릴 수 없다 — `image.resize` 와 같은 종류
rotate      edit         `document.rotate` 가 edit 인 것과 같다
```

## Mock 은 경계를 지어내지 않는다

픽셀을 모르므로 `null` 이다. 그럴듯한 사각형을 주면 "얼마나 움직였다" 고 판단한
워크플로가 실기에서 다르게 돈다 — `LAYER_GET` 의 `bounds` 와 같은 규칙이다.

## 체크리스트

- [x] `layer.translate` · `layer.scale` · `layer.rotate`
- [x] `options.interpolation` 여섯 가지
- [x] 실기: 단위 셋 · 기준점 둘 · 회전 부호

# 48. 레이어 연결 (`layer.link` · `layer.unlink`)

연결된 레이어들은 **함께 움직이고 함께 변형된다.** 그룹과 다르다 — 트리 구조가
바뀌지 않고 순서도 그대로다.

## `link` 만 `async` 가 아니다

Adobe 레퍼런스가 `link(targetLayer) → Layer[]` 로 적고 "Async: No" 라고
명시한다. 나머지가 전부 `Promise` 인데 이것만 배열을 바로 준다. **`await` 는
둘 다 받으므로** 그대로 기다린다 — 런타임이 문서와 달라도 깨지지 않는다.

## 반환값과 속성이 다르다

레퍼런스의 예제가 **자기 자신을 포함한** 목록을 찍는다.

```js
const linkedLayers = strokes.link(fillLayer)
> "strokes"     // 자기 자신
> "fillLayer"
```

그런데 **`linkedLayers` 속성에는 자기 자신이 없다.** 실기에서 확인했다.

```text
2와 3을 연결  →  layer 2 의 linkedLayers = [3]
```

출처가 다르다는 뜻이다. 이 Command 는 **반환값을 쓰지 않고 속성을 읽는다** —
`layer.get` 과 같은 출처라 두 Tool 이 다른 말을 하지 않는다. 이 프로젝트가
반환값을 믿지 않는 규칙(`duplicate()` 의 `id: undefined`)과도 맞는다.

## 대칭이고 전이적이다

```text
2-3 연결 후 2-4 연결   →  layer 2: [3,4] · layer 3: [2,4]
layer 2 unlink         →  layer 2: [] · layer 3: [4]
```

`unlink` 는 **그 레이어만** 집합에서 뺀다. 나머지는 서로 연결된 채로 남는다.

## 연결이 실제로 동작한다

L-B 만 60px 내렸는데 **손대지 않은 L-C 가 똑같이 60px 내려갔다.**

```text
L-B  top 50 → 110   (translate 로 옮긴 것)
L-C  top 50 → 110   (연결되어 따라온 것)
```

## Mock 의 세 가정이 다 맞았다

자기 자신 제외 · 전이성 · `unlink` 가 그 레이어만 빼는 것. 짐작이 맞은 것은
**처음이 아니지만 드문 일**이라 적어 둔다 — 그동안 틀린 쪽이 더 많았다.

## 체크리스트

- [x] `photoshop.layer.link` · `photoshop.layer.unlink`
- [x] `photoshop.layer.get` 이 `linkedLayerIds` 를 준다
- [x] 실기: 자기 자신 제외 · 전이성 · 부분 해제 · 함께 이동

# 49. DOM 선택 (`selection.polygon` · 경계 변형 셋)

## 기존 선택이 전부 batchPlay 였던 이유는 "없어서" 가 아니었다

`selection-ops.ts` · `gap-tools.ts` 의 선택 Command 는 전부 batchPlay 다. 그때는
DOM 에 없다고 판단한 것이 아니라 **찾아보지 않았다.** Adobe 레퍼런스에
`Selection` 클래스가 있고 스물두 개 멤버가 적혀 있다 — **25.0 부터다.**

`document.selection` 이 없거나 메서드가 없으면 `COMMAND_NOT_SUPPORTED` 로
거절한다. 짐작해서 batchPlay 로 우회하지 않는다 — 우회하면 두 경로가 생기고
어느 쪽이 돌았는지 호출자가 모른다.

## 이름은 레퍼런스에, Tool 이름은 짝에 맞춘다

DOM 이름은 **`resizeBoundary`** 다. Tool 은 `selection.scale_boundary` 로 두었다 —
호출자에게는 `layer.scale` 과 짝이 맞는 쪽이 읽기 쉽다. **무엇을 부르는지는
주석에 남긴다.** 남기지 않으면 레퍼런스를 다시 볼 때 없는 메서드를 찾게 된다.

## 경계 변형은 픽셀을 건드리지 않는다 — 재서 확인했다

레퍼런스가 "Does not affect the active layer" 라고 적는다. 그대로 믿지 않고
칠한 레이어를 두고 경계를 옮기고 늘리고 돌린 뒤 다시 쟀다.

```text
변형 전   R 70.41 · G 86.12 · B 211.8 · 57600px
변형 후   R 70.41 · G 86.12 · B 211.8 · 57600px
```

**한 자리도 안 변했다.** 그래서 `edit` 이고, 다시 표본화하는 `layer.scale`
(`destructive`) 과 갈린다.

## 단위는 실기에서 잰다

```text
translate  deltaX 50 · deltaY -20   →  150,150-350,250  →  200,130-400,230
scale      50% · anchor topLeft     →  200,130-400,230  →  200,130-300,180
scale      200% · anchor bottomRight→  200,130-300,180  →  100, 80-300,180
```

**픽셀 · 퍼센트**이고 양수가 오른쪽·아래다. `anchor` 는 실제로 고정점을 바꾼다 —
`topLeft` 에서 left·top 이, `bottomRight` 에서 right·bottom 이 그대로다.

## 회전 부호는 대칭 도형으로 못 잰다

§44 · §47 에서 두 번 겪었다. 대칭 도형은 "돌았다" 와 "아무 일도 안 했다" 를
가르지 못한다. 여기서는 한 걸음 더 필요했다 — **직각삼각형이라도 기준점이
중심이면 시계·반시계가 같은 경계를 낸다.**

**기준점을 모서리로 옮기면 갈린다.**

```text
150,150-350,250 · angle 90 · anchor topLeft

시계    예측  50,150-150,350      ← 실제로 이것이 나왔다
반시계  예측 150,  0-250,150
```

레퍼런스의 "clockwise" 가 맞았다.

## 안티앨리어싱 잔여는 우리 실패가 아니다

같은 다각형을 `add` 로 더했다가 **그대로 `subtract` 하면 경계가 안 줄어든다.**

```text
add       →  50,50-500,350
subtract  →  50,50-500,350   (같다)
여유를 두고 subtract → 50,150-150,350
```

반투명 가장자리가 남아 경계에 잡히기 때문이다. Photoshop 선택의 성질이지
Command 의 조용한 실패가 아니다 — 읽는 사람이 헷갈리므로 적어 둔다.

## `constants.SelectionType` 은 27.8 에 있다

`FlipAxis` 가 레퍼런스에 있으면서 런타임에 표 자체가 없었으므로(§44) 이번에도
`fromTable` 로 없으면 **무엇이 있는지 함께** 담아 거절하게 두었다. 네 모드
(`replace` · `add` · `subtract` · `intersect`) 모두 실기에서 동작했다.

## `selection.from_layer` 는 만들지 않았다

`selection.set { shape: "layerTransparency" }` 가 이미 같은 일을 한다. Tool 을
더하면 같은 능력에 두 이름이 생기고 호출자가 어느 쪽이 맞는지 고민한다.
대신 `selection.set` 의 설명이 그 자리를 가리킨다.

## 체크리스트

- [x] `photoshop.selection.polygon`
- [x] `photoshop.selection.translate_boundary` · `scale_boundary` · `rotate_boundary`
- [x] 25.0 미만 거절 (`document.selection` · 메서드 유무를 각각 본다)
- [x] 실기: 단위 · 기준점 · 회전 부호 · 네 가지 모드
- [x] 실기: 경계 변형 전후 통계가 같다 (픽셀 불변)

# 50. 마스크를 버린다 (`mask.delete`)

`mask.apply` 와 **같은 descriptor 에서 `apply` 플래그만 다르다.** 새로 잡을
것이 없었다 — 그 descriptor 는 §8.1 에서 이미 검증된 것이고, 소스 주석이
이미 "`apply: false` 면 마스크를 그냥 버린다" 고 적고 있었다.

```text
mask.apply    가린 픽셀이 사라진다   · 마스크도 사라진다
mask.delete   가린 픽셀이 되살아난다 · 마스크만 사라진다
mask.disable  아무것도 안 사라진다   · 다시 켤 수 있다
```

## 미뤄 두었던 이유가 해소됐다

`commands/mask-selection.ts` 머리에 "마스크 삭제는 넣지 않는다 — 가려둔 작업을
잃으므로 destructive 에 가깝고 **Permission System 과 함께 검토한다**" 고
적혀 있었다(§7.4). Permission System 이 선 지 오래이고 `destructive` 는 기본
허용 밖이므로 조건이 채워졌다.

`tests/adjustment.test.ts` 에 **"등록하지 않는다" 를 검사하는 테스트**가 있었다.
지우지 않고 **새 결정을 검사하도록 바꿨다** — 조건이 무엇이었는지 남겨 두지
않으면 다음에 같은 자리를 다시 논의하게 된다.

## 결과만 보고는 `apply` 와 구분되지 않는다

둘 다 `hasMask: false` 를 돌려준다. **갈리는 것은 픽셀이고 그것은 재야 보인다.**

```text
                    문서 R 평균   얼룩 비율
마스크 없음 (기준)     151.02      44.247%
마스크 (왼쪽 절반)     203.01      22.123%
mask.delete 뒤         151.02      44.247%   ← 기준으로 돌아온다
mask.apply  뒤         203.01      22.123%   ← 머문다
```

얼룩이 정확히 절반으로 잘렸고 되돌아올 때도 정확히 찼다. 그래서 Tool 설명이
셋을 나란히 놓는다 — 반환값으로는 고를 수 없으니 **고를 때 알고 있어야 한다.**

## `destructive` 인 이유가 `apply` 와 다르다

`apply` 는 **픽셀**이 사라져서이고 `delete` 는 **마스크**가 사라져서다.
`mask.dab` · `mask.gradient` 로 다듬어 쌓은 것이 한 번에 없어진다 — 비파괴
보정에서 가장 오래 걸리는 작업이 마스크 다듬기다. 잠깐 꺼 보려는 것이면
`mask.disable` 이 맞고, Tool 설명이 그쪽을 가리킨다.

## 짐작한 원인을 오류에 적지 않는다

지운 뒤에도 마스크가 남아 있으면 실패로 돌려주는데, 처음에 "레이어가 잠겨
있는지 확인하세요" 라고 적었다. 재 보니 **`lock: all` 인 레이어도 그대로
지워졌다.** 짐작한 원인을 적으면 호출자가 그쪽을 확인하느라 진짜 원인을 못 본다.

## 마스크가 없으면 미리 막는다

Photoshop 이 무엇을 지울지 알 수 없다. 다만 **상태를 못 읽으면 막지 않는다** —
없는 것을 참으로 읽어 멀쩡한 호출을 막는 것이 더 나쁘다
(`retouch.remove_spots` 의 `isBackgroundLayer` 와 같은 원칙).

## Mock 은 계약만 흉내낸다

`apply` 와 `delete` 가 Mock 에서 **똑같이** `hasMask` 를 내린다. 다른 점은
픽셀이라 Mock 이 모른다 — 그럴듯하게 지어내면 그 거짓이 테스트에 굳는다.

## 체크리스트

- [x] `photoshop.mask.delete` (DESTRUCTIVE)
- [x] 마스크 없는 레이어 거절 · 상태를 못 읽으면 막지 않는다
- [x] 지운 뒤 다시 읽어 확인 (조용한 실패 차단)
- [x] 실기: 기준값 복귀 · `apply` 와 갈림 · 잠긴 레이어에서도 지워짐
- [x] `mask.apply` 소스 주석의 `edit` 표기를 `destructive` 로 정정

# 51. 마스크 연결 (`mask.link` · `mask.unlink`)

연결되어 있으면 레이어를 옮길 때 마스크가 **함께** 움직인다. 끊으면 마스크는
그 자리에 두고 안쪽 그림만 옮길 수 있다.

## DOM 에 없어서 잡았다

Adobe Layer 레퍼런스의 마스크 멤버는 **밀도와 페더뿐이다** — `layerMaskDensity`
· `layerMaskFeather` · `vectorMask*` · `filterMask*`. 연결·삭제·활성화를 다루는
메서드가 하나도 없다. **먼저 확인했기 때문에** batchPlay 로 간 것이 짐작이 아니다.

`["all"]` 알림으로 잡았다(§17.17). 사람이 레이어 패널의 사슬 아이콘을 누르는
동안 받은 것이 이것이다.

```text
historyStateChanged   name: "Unlink Mask"  commandID: 5085
set  _target: [{_ref:"layer", _enum:"ordinal", _value:"targetEnum"}]
     to: { _obj: "layer", userMaskLinked: false }
```

`setMaskEnabled` 와 **descriptor 모양이 같고 속성 이름만 다르다**
(`userMaskEnabled` → `userMaskLinked`). `_target` 이 `targetEnum` 이라 활성
레이어에 걸린다 — `activate` 가 먼저다.

## 잡히지 않은 방향을 짐작하지 않았다

한 번만 눌러서 **`false` 만 잡혔다.** 대칭이라고 못 박지 않고 **걸고 나서 다시
읽어** 확인한다 — 그것이 `applied` 다. 실기에서 `true` 도 들어갔다.

읽는 쪽은 `readMaskLinked` 이고 **`readMaskState` 에 합치지 않았다.** 그쪽은
`layer.list` 가 문서 전체에 부르는 경로라 속성을 하나 더하면 왕복이 레이어 수만큼
늘어난다. 연결 여부는 `link`·`unlink` 를 부를 때만 필요하다.

읽지 못하면 `linked` 도 `applied` 도 **`null` 이다.** `false` 로 덮으면
"연결되어 있지 않다" 는 틀린 사실을 말하게 된다.

## 연결이 실제로 동작한다

폭 130 의 얼룩에 왼쪽 절반만 보이는 마스크를 걸고 100px 씩 옮겨 쟀다.

```text
                       레이어 경계        얼룩 비율
기준 (연결, 이동 전)    70-200 (폭 130)    22.123%
연결 + 100px 이동      170-300 (폭 130)    22.123%   ← 마스크가 따라왔다
끊음 + 100px 이동      170-200 (폭  30)     2.842%   ← 마스크가 남았다
```

**연결일 때 수치가 안 변하는 것이 증거다.** 보이는 면적이 같은 채로 통째로
옮겨졌다는 뜻이고, 레이어 경계가 `70-200` → `170-300` 으로 바뀐 것이 "안 움직인
것" 과 가른다. 끊었을 때는 폭이 130 에서 30 으로 줄었다 — 그림이 마스크 밖으로
빠져나갔다.

**마스크가 레이어 경계를 자른다.** 얼룩 자체는 폭 260 인데 경계가 130 으로
보고된다.

## 마스크는 연결된 채로 생긴다

사람이 처음 누른 것이 `Unlink Mask` 였다 — 그 전이 연결 상태였다는 뜻이다.
그래서 `mask.create` 뒤에 `mask.link` 를 부를 이유는 없다. 끊은 것을 되돌릴
때만 쓴다.

## 없애는 것이 아니라 축이 다르다

```text
mask.unlink    마스크 남음 · 함께 안 움직임
mask.disable   마스크 남음 · 효과 없음      · 다시 켤 수 있다
mask.delete    마스크 사라짐                · destructive
```

그래서 `edit` 이다. 셋이 헷갈리면 되돌릴 수 없는 쪽을 고르게 되므로 Tool 설명이
서로를 가리킨다.

## 체크리스트

- [x] `photoshop.mask.link` · `photoshop.mask.unlink` (EDIT)
- [x] descriptor 를 `["all"]` 알림으로 잡았다 — 문서에서 가져오지 않았다
- [x] 걸고 나서 다시 읽어 `applied` 로 확인 (`true` 방향은 캡처되지 않았다)
- [x] 마스크 없는 레이어 거절 · 상태를 못 읽으면 막지 않는다
- [x] 실기: 양방향 적용 · 연결/해제가 이동에 실제로 반영됨

# 52. 조정 레이어 넷 (노출 · 흑백 · 포토 필터 · 채널 혼합)

`CORE_API.md` §5.5 에 P2 로 남아 있던 넷이다.

## DOM 에 없다 — 레퍼런스가 그렇게 말한다

Adobe Document 레퍼런스의 레이어 생성 메서드는 `createLayer` · `createPixelLayer`
· `createTextLayer` · `createLayerGroup` · `duplicateLayers` · `groupLayers` 뿐이고
**조정 레이어를 만드는 것이 하나도 없다.** 기존 여섯 개가 batchPlay 인 이유가
오래된 판단이 아니라 지금도 맞는 사실임을 다시 확인했다.

## `event.recent` 에 `before` 를 더했다

descriptor 를 잡는 §17.17 의 방법이 **이번에 막혔다.** 슬라이더를 한 번 끌면
`historyStateChanged` 가 수백 개 쌓이는데, `limit` 은 **뒤에서** 자르고
(폴링이 앞으로 가야 해서 그쪽이 맞다) `after` 만으로는 앞쪽에 닿을 수 없다.
버퍼에 500개가 있는데 200개까지만 보였고 **조정 레이어 넷 중 셋을 놓쳤다.**

`EventQuery.before` 를 더해 구간을 끊어 훑는다. 폴링 의미는 그대로다.

## 체크박스와 드롭다운은 슬라이더와 따로 잡아야 한다

처음에 슬라이더만 움직이게 안내해서 **세 키를 놓쳤고, 하필 이름을 틀리기
쉬운 것들이었다.**

```text
blackAndWhite   useTint        ← tint 가 아니다
channelMixer    monochromatic  ← monochrome 이 아니고 gray 와 짝이다
photoFilter     color 가 프리셋 이름이 아니라 labColor 다
```

**포토 필터의 드롭다운은 이름으로 나가지 않는다.** "Warming Filter (85)" 를
고르면 descriptor 에는 `{_obj:"labColor", luminance, a, b}` 가 실린다. 이름을
받는 스키마를 만들었으면 조용히 무시됐을 것이다.

## 단위가 종류마다 다르다

**채널 혼합만 `percentUnit` 으로 감싼다.** 노출과 흑백은 맨숫자다.

```text
exposure       exposure -0.5 · offset 0.0667 · gammaCorrection 0.77   맨실수
blackAndWhite  red 56 · yellow 104 · grain 42 · cyan 92 · blue 17 ·
               magenta 104                                            맨정수
photoFilter    density 51 · preserveLuminosity true · color(labColor)
channelMixer   red/grain/blue → channelMatrix{red,grain,blue,constant} percentUnit
```

`gammaCorrection` 은 **`gamma` 가 아니다.** 녹색은 또 `grain` 이다(이 저장소에서
세 번째다 — `channelReference` · `RGBColor` · 여기). 우리 API 는 `green` 으로
받고 경계에서 바꾼다.

## 값이 실제로 걸리는지 하나씩 쟀다

평탄한 R180 G100 B60 위에서 **키를 하나씩 따로** 걸었다. 섞으면 조용히 무시되는
키를 못 잡는다.

```text
exposure -1          R 180 → 131   비율 0.728 = 0.5^(1/2.2)  ← 스톱이 맞다
offset 0.2           R 180 → 212
gammaCorrection 2    R 180 → 214
blackAndWhite 기본   → 116 (무채색)
  red 300            → 255          ← 채널 가중치가 걸린다
  useTint true       → 130/116/84   ← 세피아. 무채색이 아니다
photoFilter density 100
  preserve 끔        휘도 114 → 28
  preserve 켬        휘도 114 → 108 ← 광도가 유지된다
channelMixer gray{red:100} + monochrome  → 세 채널 모두 180
```

## 안 준 출력 채널이 0 이 된다 — 고쳤다

**채널 혼합에서 `red` 만 주고 걸었더니 녹색·파랑 출력이 0 이 됐다.**

```text
요청   red: {red:0, green:100, blue:0}     green·blue 출력은 안 건드림
결과   R 100 ✓   G 0 ✗   B 0 ✗            R180 G100 B60 → R100 G0 B0
```

Photoshop 은 descriptor 에 없는 출력 채널을 항등이 아니라 **전부 0** 으로 둔다.
그대로 두면 "빨강만 만졌는데 사진이 빨강 단색이 되는" 사고다.

안 준 출력 채널을 **항등으로 채운다.** 채울 값은 `make` descriptor 에서 읽은
기본값이다(`red:{red:100}` · `grain:{grain:100}` · `blue:{blue:100}`). 고친 뒤
다시 재니 `R 100 · G 100 · B 60` 으로 맞았다.

**채널 안의 항은 채우지 않는다.** `red: {green: 100}` 은 "빨강 출력은 녹색
입력만 쓴다" 로 읽는 것이 자연스럽다.

## 두 모드를 섞으면 거절한다

단색일 때 `red`·`green`·`blue` 를 함께 주면 Photoshop 은 오류 없이 한쪽만 쓴다.
스키마와 플러그인 양쪽에서 막는다.

## 고칠 수 있는지까지 확인했다

§17.38 의 교훈이 "만드는 것만 확인하고 고칠 수 있는지는 확인하지 않았다" 였다.
넷 다 속성 패널이 열리고 넣은 값이 그대로 보이는 것을 실기에서 확인했다 —
`presetKind` 가 `makeAdjustmentLayer` 한 곳에 있어서 자동으로 따라왔다.

## 체크리스트

- [x] `photoshop.adjustment.exposure` · `black_white` · `photo_filter` · `channel_mixer` (EDIT)
- [x] descriptor 를 `["all"]` 알림으로 잡았다 — 체크박스·드롭다운 포함
- [x] `event.recent` 에 `before` 추가 (구간 조회)
- [x] 실기: 키마다 따로 걸어 값이 반영되는 것을 픽셀로 확인
- [x] 실기: 안 준 출력 채널이 0 이 되는 것을 잡아 항등으로 채움
- [x] 실기: 넷 다 속성 패널이 열리고 값이 보인다

# 53. DOM 필터 넷 (sharpen · unsharp_mask · motion_blur · dust_scratches)

`CORE_API.md` §5.6 에 있던 일곱 중 넷이다. **여섯을 요청받았는데 셋은 DOM 에
없었고 하나는 요청에 없던 것을 더했다.** 그 차이가 이 절의 내용이다.

## 레퍼런스가 있는 것과 없는 것을 갈랐다

Adobe Layer 레퍼런스에 `apply*` 가 **서른여덟 개** 있다(23.5+). descriptor 를
잡을 이유가 없다 — 이번에는 사용자에게 한 번도 부탁하지 않았다.

```text
filter.sharpen         applySharpen · applySharpenEdges · applySharpenMore
filter.motion_blur     applyMotionBlur(angle, distance)
filter.dust_scratches  applyDustAndScratches(radius, threshold)

filter.smart_sharpen   없다 — applySmartSharpen 이 목록에 없다
filter.surface_blur    없다 — applySmartBlur 는 고급 흐림으로 다른 필터다
filter.noise_reduce    없다
```

**비슷한 이름으로 채우지 않았다.** `applySmartBlur` 를 `surface_blur` 로 내놓으면
호출자는 표면 흐림이 걸렸다고 믿는다.

## `sharpen` 은 강도를 받지 않는다

세 변종 모두 파라미터가 없다. 강도를 받는 척하면 호출자가 조절했다고 믿는다.

그래서 **`filter.unsharp_mask` 를 더했다.** 요청 목록에 없었지만 DOM 에
`applyUnSharpMask(amount, radius, threshold)` 가 있고, **없는 `smart_sharpen` 의
자리가 이것**이다. 이름을 바꿔 달지 않고 별도 Tool 로 두되 설명이 그 사실을
말한다.

## `noise_reduce` 는 만들지 않기로 했다

DOM 에 없기도 하지만, 만들더라도 **`camera_raw.apply` 가 훨씬 낫다** — 실기에서
σ 6.72 → 3.42(49%)였고 `filter` 쪽 `denoise` 는 최대 강도로도 7% 였다(§17.17).
비슷한 이름의 열등한 Tool 이 있으면 LLM 이 그쪽을 고른다.

## 실기: 히스토그램 빈으로 쟀다

값이 **딱 둘**인 그림을 만들었다(어두운 원 16.757% · 밝은 배경 83.243%).
필터가 걸리면 빈이 늘어난다 — 걸렸는지 아닌지가 한눈에 갈린다.

```text
기준                              빈 2개 · p1 40 · p99 200 · 클리핑 0

unsharp amount300 radius5 thr0    clippedLow 2.81% · clippedHigh 2.55%
                                  p1 40→0 · p99 200→255   ← 가장자리 오버슈트
unsharp 같은 값 thr255            기준과 완전히 동일        ← 한계값이 게이트다
sharpen more                      clippedLow 0.53% · High 0.38%  ← 얇은 헤일로
motion_blur angle0 distance150    가로로만 번졌다 (캡처로 확인)
dust radius100 thr0               **원이 통째로 사라졌다** — 전부 200
dust radius100 thr255             기준과 완전히 동일
```

**먼지·스크래치가 반지름 80 원을 통째로 지웠다.** Tool 설명의 "천체사진에서
전체에 걸면 별이 함께 사라진다" 가 이것이다 — 작은 점을 Photoshop 이 먼지와
구분하지 못한다.

`asSmartFilter: true` 는 스마트 오브젝트로 바꾸고 **id 가 2 → 4 로 바뀌었다.**
설명에 적어 둔 그대로다.

## Mock 이 관대해서 틀린 테스트가 살아 있었다

실기 플러그인은 **조정 레이어와 그룹에 필터를 못 걸게 막는데**(변환이 먼저
성공한 뒤 필터가 실패하면 조정 레이어만 망가진다, §8.4) **Mock 은 통과시켰다.**

그래서 `tests/adjustment.test.ts` 의 "이미 스마트 오브젝트면 변환하지 않는다"
가 **조정 레이어(11)를 필터 대상으로 쓰면서 통과**하고 있었다. 실기라면
거절당할 호출이다.

Mock 에 그 거절을 넣고 테스트는 픽셀 레이어(10)로 고쳤다. 의도는 그대로다.
[[mock-guesses-get-encoded-as-truth]] 가 말하는 "계약을 흉내낼 수 있으면
흉내낸다 — 안 하면 그 계약이 테스트에 영영 안 나온다" 의 실제 사례다.

## `applyFilter` 를 콜백으로 열었다

기존 `applyFilter` 는 descriptor 를 받았다. 대상 해결 · 조정 레이어 거절 ·
스마트 오브젝트 변환 · 결과 확인이 전부 그 안에 있어 **버릴 수 없다.**
마지막 한 걸음만 콜백으로 바꿔 DOM 메서드가 같은 안전장치를 그대로 쓴다.

**변환 뒤의 레이어를 콜백에 넘긴다.** 스마트 오브젝트로 바뀌면 객체가 통째로
교체되므로 변환 전 참조로 DOM 메서드를 부르면 던진다.

## 체크리스트

- [x] `photoshop.filter.sharpen` · `unsharp_mask` · `motion_blur` · `dust_scratches` (EDIT)
- [x] DOM 에 없는 셋은 만들지 않고 §5.6 에 이유를 적었다
- [x] 실기: 네 필터 모두 파라미터가 실제로 반영됨 (한계값 게이트 포함)
- [x] 실기: 조정 레이어 거절 · `asSmartFilter` 변환과 id 변경
- [x] Mock 이 조정 레이어·그룹 거절을 흉내내게 고침 (틀린 테스트 하나 발견)

# 54. 스마트 오브젝트 정보 (`smart_object.get_info`)

`CORE_API.md` §5.8 의 P2 넷 중 하나다. **나머지 셋은 만들지 않았고 그 이유가
이 절의 절반이다.**

## DOM 에 스마트 오브젝트가 통째로 없다

Adobe Layer 레퍼런스에 스마트 오브젝트 관련 멤버가 **하나도 없다.**
`SmartObject` 클래스 페이지도 404 다. `rasterize()` 만 있고 그건
`layer.rasterize` 가 이미 쓴다(§45).

## 읽기라 잡아 달라고 부탁하지 않았다

batchPlay `get` 은 **문서를 바꾸지 않는다.** 없는 속성을 물으면 오류가 나거나
빈 값이 오고 그게 전부다. 그래서 알림 캡처 없이 **직접 물어서** 키를 알아냈다 —
`mask.select` 의 `ChannelProbe` 와 같은 방법이다(§31).

조정 레이어 넷(§52)은 사용자에게 네 번 부탁해야 했다. **쓰기와 읽기를 가르면
부탁이 필요한 범위가 줄어든다.**

## 짐작한 키 둘은 맞았고 설명 하나는 틀렸다

`linked` · `fileReference` 는 그 이름 그대로 있었다. 그런데 **포함(embedded)
인데도 `fileReference` 에 값이 왔다.**

```json
{ "linked": false, "fileReference": "PLAIN.psb",
  "placed": "rasterizeContent",
  "contentId": "xmp.did:19e77c48-bb6c-4149-82d5-ef5ae6c32fc0" }
```

"포함이면 `null`" 이라고 적어 두었던 것이 틀렸다. 포함일 때는 Photoshop 내부
이름이고 연결일 때만 실제 경로다. **값이 오는 것을 보고 설명을 고쳤다 — 값을
버리지 않았다.**

## `raw` 가 두 개를 더 줬다

처음에는 아는 둘만 올리고 나머지를 `raw` 에 두었다. 실기에서 받아 보니 쓸
만한 것이 둘 더 있어 올렸다.

```text
placed      rasterizeContent   `{_enum:"placed", _value:...}` 의 안쪽 값
contentId   xmp.did:...        내용의 XMP 문서 id
```

`_obj` 는 descriptor 자신의 클래스 이름이라 담지 않는다. 남은 `compsList` 는
해석하지 못해 `raw` 에 그대로 둔다.

**`raw` 를 먼저 두고 실기에서 채운 것이 맞았다.** 짐작으로 스키마를 다 채웠으면
`placed` 와 `contentId` 를 놓쳤을 것이다.

## `contentId` — 관측은 맞았고 해석이 틀렸다

```text
원본 (id 3)            xmp.did:19e77c48-…
layer.duplicate (id 4) xmp.did:19e77c48-…   ← 같다
별개로 변환 (id 6)     xmp.did:e19bccd7-…   ← 다르다
```

여기까지는 맞다. 그런데 **"내용을 공유한다" 로 읽은 것이 틀렸다.** §55 에서
같은 파일로 만든 두 레이어를 `new_via_copy` 로 갈라 놓았는데 **둘의 값이
같았다.**

`contentId` 는 **"어디서 온 내용인가"** 다. 복제가 같은 것은 id 를 물려받아서이고,
따로 변환한 것이 다른 것은 각자 새 XMP id 를 만들어서다. 둘 다 "출처" 로
설명되고, "지금 공유하는가" 로는 설명되지 않는다.

**관측을 적을 때와 해석을 적을 때를 가른다.** 값 세 개로 두 가지 해석이
모두 성립했고, 가르는 실험을 하지 않은 채 한쪽을 골라 Tool 설명에 넣었다.

## 만들지 않은 셋

**`smart_object.rasterize`** — `layer.rasterize` 가 이미 한다(§45). 같은 능력에
이름이 둘이면 호출자가 고민한다. `CORE_API.md` §5.8 이 이미 "만들지 않는 쪽이
지우는 것보다 낫다" 고 적어 두었다.

**`smart_object.open_contents`** — **활성 문서가 바뀐다.** 내용이 새 창으로
열리고 그 뒤의 모든 편집이 그 창에 걸린다. 이 프로젝트가 반복해서 겪은 실패
유형이다(§17.20 그룹 · §17.27 마스크 · §18.1 mock). **오류 없이 엉뚱한 대상에
작업하는 것**이 공통점이다. 얻는 것도 사람용 affordance 다.

**`smart_object.replace_contents`** — 값은 크다. 지금은 외부 처리기 결과를
`place` 로 새 레이어에 놓는데, 내용만 갈아끼우면 걸어 둔 스마트 필터·변형·
마스크가 그대로 살아남는다. 다만 DOM 에 없어 **descriptor 캡처가 필요하다.**
할 일로 남긴다.

## 아직 못 잰 것 — §55 에서 쟀다

**`linked: true` 는 확인하지 못했다.** `layer.place` 가 포함으로 가져오고
연결로 가져오는 길이 없다. 키 이름이 맞는 것은 `false` 가 그 키로 온 것으로
확인됐지만, 연결일 때 `fileReference` 가 실제 경로인지는 **아직 짐작이다.**

**§55 가 `layer.place` 에 `linked` 를 열어 이것을 닫았다.**
`linked: true · link._path E:\test01\so-red.tif` — 실제 경로가 맞다.

## 체크리스트

- [x] `photoshop.smart_object.get_info` (READ)
- [x] DOM 부재를 레퍼런스로 확인 (Layer 에 멤버 없음 · SmartObject 페이지 404)
- [x] 키를 짐작하지 않고 직접 물어서 확인 — 알림 캡처 없이
- [x] 실기: 비-SO 는 오류가 아니라 `false` · 포함에도 `fileReference` 가 온다
- [x] 실기: `contentId` 가 복제본과 같고 별개와 다르다
- [x] `linked: true` — §55 가 `layer.place` 에 `linked` 를 열어 확인했다

# 55. 스마트 오브젝트 셋 + 연결 배치

`smart_object.new_via_copy` · `relink` · `update`, 그리고 그 전제인
`layer.place` 의 `linked` 옵션이다. §5.8 의 P2/P3 가 이것으로 비었다.

## 전제를 먼저 열었다

`relink` 와 `update` 는 **연결 스마트 오브젝트가 있어야 의미가 없다** —
포함(embedded)에는 다시 연결할 파일도, 새로 읽을 원본도 없다.

`place.ts` 에 `linked: false` 가 **이미 있었다.** 검증된 코드 안의 키라
캡처가 필요 없었다. 다만 그 값은 실수가 아니라 **의도된 선택**이었고
주석이 이유를 적고 있었다 — "링크로 넣으면 파일을 옮기거나 지웠을 때 문서가
깨진다".

**이 저장소에서는 그 위험이 더 크다.** 외부 처리기가 TIFF 를 쏟는 곳이 승인된
작업 폴더이고 `workspace.delete` 가 그것을 치운다. 실기 폴더에 9.3GB 66개가
쌓여 있었다. 그래서 기본은 포함으로 두고 호출자가 고르게 했다.

`linked` 와 `rasterize` 는 함께 줄 수 없다 — 구우면 연결이 사라진다.

## descriptor 셋을 한 라운드에 잡았다

```json
placedLayerMakeCopy            { }                       인자가 없다
placedLayerRelinkToFile        { null: {_path, _kind}, layerID }
placedLayerUpdateAllModified   { documentID, layerIDs: [] }
```

**`relink` 이 경로를 인자로 받는 것이 이 Tool 을 만들 수 있느냐를 갈랐다.**
사람이 메뉴로 실행하면 "열기" 대화상자가 뜬다(`modalStateChanged` 로 잡혔다).
경로를 주면 그 창이 뜨지 않는다.

**`update` 는 문서 전체다.** 메뉴 이름은 "수정된 내용 업데이트" 인데 History
이름이 `Update All Modified Smart Objects` 이고 descriptor 도 문서 단위였다.
`layerIDs` 는 빈 배열만 잡혔고 **값을 넣으면 그것만 도는지 모른다** — 짐작해서
파라미터로 열지 않았다.

## 실기에서 잰 것

```text
place(linked: true)     linked: true · link._path E:\test01\so-red.tif
                        ← §54 의 열린 항목이 닫혔다

relink → so-blue.tif    R 251.25 → 198.75 · B 198.75 → 251.25   내용이 바뀐다
                        히스토그램의 블러 퍼짐은 그대로         필터가 남는다
                        raw.filterFX 에 gaussianBlur radius 8

update (바뀐 것 없음)   조용히 끝난다

workspace.delete        linkMissing: false → true
```

**`relink` 뒤에도 스마트 필터가 남는 것**이 이 Tool 의 존재 이유다 —
`layer.place` 로 새 레이어를 놓으면 걸어 둔 것을 다시 걸어야 한다.

## `raw` 가 연결일 때만 나오는 셋을 더 줬다

```text
link         { _path, _kind }   전체 경로
linkMissing  연결된 파일이 사라졌는지
linkChanged  파일이 바뀌었는지 (update 가 할 일이 있는지)
```

**`linkMissing` 이 위에 적은 위험의 탐지 수단이다.** 연결된 파일을
`workspace.delete` 로 지우고 `true` 가 되는 것을 확인했다. 경고만 적고 재는
방법을 안 주면 호출자는 깨진 줄 모른다.

## `new_via_copy` 는 연결에 걸리지 않는다

실기에서 Photoshop 이 **"'복사를 통해 새 스마트 오브젝트 만들기' 명령은 현재
사용할 수 없습니다"** 라고만 답했다. 이유를 알 수 없는 문장이다 — 연결은
내용이 파일에 있어 복사해 낼 것이 없다. 미리 막고 이유를 말한다.

## `contentId` 해석이 틀렸다 — §54 를 정정했다

§54 에서 "복제본과 같고 별개와 다르다" 를 보고 **"내용을 공유한다"** 로 읽었다.
여기서 갈라 보니 틀렸다.

```text
so-red.tif 를 place → 사본(new_via_copy)
원본  adobe:docid:photoshop:7856477a-…
사본  adobe:docid:photoshop:7856477a-…   ← 같다. 갈라 놓았는데도
```

`contentId` 는 **"어디서 온 내용인가"** 다. §54 의 값 세 개로 두 해석이 모두
성립했는데 **가르는 실험을 하지 않은 채 한쪽을 골라 Tool 설명에 넣었다.**
`new_via_copy` 의 설명에서도 "contentId 로 확인할 수 있다" 를 뺐다.

**관측을 적을 때와 해석을 적을 때를 가른다.**

## 테스트 하나가 이름만 보고 걸렀다

`tests/document-paste.test.ts` 가 "이름에 `copy` 가 들어간 Tool 은 없다" 로
클립보드 Tool 부재를 검사하고 있었다. `smart_object.new_via_copy` 가 걸렸다 —
Photoshop 메뉴 이름 그대로이고 클립보드와 상관이 없다.

**의도대로 클립보드에 맞춰 좁혔다** — `clipboard` 포함 · `.copy` 로 끝나는 것 ·
`cut` 포함. 넓은 문자열 검사는 무관한 것을 잡는다.

## 체크리스트

- [x] `photoshop.smart_object.new_via_copy` (EDIT) · `relink` (EXTERNAL) · `update` (EDIT)
- [x] `photoshop.layer.place` 의 `linked` — `place_linked` 가 이것으로 채워졌다
- [x] descriptor 셋을 `["all"]` 알림으로 한 라운드에 잡았다
- [x] 실기: `linked: true` 확인 (§54 의 열린 항목)
- [x] 실기: relink 가 내용을 바꾸고 스마트 필터를 남긴다
- [x] 실기: `linkMissing` 이 `workspace.delete` 로 깨진 연결을 잡는다
- [x] 실기: `new_via_copy` 가 연결에 안 걸린다 — 미리 막는다
- [x] §54 의 `contentId` 해석 정정

# 56. 채널 (`channel.*` 여섯)

`CORE_API.md` §5.9 의 일곱 중 여섯이다.

## 전부 DOM 이다 — 캡처가 한 번도 필요 없었다

레퍼런스에 `Channels` 컬렉션(`add` · `getByName` · `length` · 색인)과 `Channel`
클래스(`histogram` · `name` · `kind` · `visible` · `opacity` · `duplicate` ·
`remove`)가 있고, **`document.activeChannels` 는 읽기/쓰기**다. batchPlay 를
한 줄도 쓰지 않았다.

## 왜 필요했는가

`selection.save_channel` 이 채널을 만드는데 **목록을 볼 방법이 없었다.**
이름이 틀리면 `selection.load_channel` 이 `"설정" 명령은 현재 사용할 수
없습니다` 만 돌려준다 — 그 벽은 `selection-ops.ts` 주석에 이미 적혀 있었다.

```text
selection.save_channel { name: "하늘" }
channel.list  →  index 3 · 하늘 · isComponent false · kind maskedAreas
```

## 이름이 지역화된다

```text
빨강 · 녹색 · 파랑     isComponent: true   kind: "component"
하늘                   isComponent: false  kind: "maskedAreas"
```

**Mock 은 색 성분 채널을 담지 않는다.** 영어 이름을 지어 넣으면 테스트가
실기와 다른 이름을 사실로 굳힌다. 그 대가로 `channel.delete` 의 "색 성분은
거절한다" 경로는 Mock 으로 나오지 않아 실기에서 확인했다.

`kind` 는 그대로 읽을 수 있는 문자열이라 매핑이 필요 없었다 — `rawKind` 는
못 읽었을 때만 담는다.

## `histogram` 에 제약이 둘 있다

처음에 `null` 이 나왔다. **삼키지 않고 이유를 캐서** 두 가지를 잡았다.

```text
성분 채널       문자 구성 요소의 채널에 유효한 작업이 아닙니다
                → 혼자 보이게 해도 안 된다. 알파 채널 전용이다
안 보이는 채널  보이는 채널에 대한 막대 그래프만 얻을 수 있습니다
                → channel.select 로 보이게 하면 나온다
```

둘 다 **미리 막고 무엇을 하면 되는지 말한다.** 예외를 `null` 로 삼키면
호출자는 "값이 없다" 로 읽는다.

보이게 한 뒤 읽은 값이 맞는지도 쟀다 — 150×120 사각형을 저장한 채널의 255번
칸이 **18000** 이었다.

성분 채널의 분포는 `document.statistics` 가 이미 준다. 둘의 자리가 갈린다.

```text
document.statistics   문서·레이어를 64칸 + 채널별 평균·노이즈
channel.get           저장해 둔 알파 채널을 256칸
```

## `load_as_selection` 은 만들지 않았다

`selection.load_channel` 이 이미 한다. 같은 능력에 이름이 둘이면 호출자가
어느 쪽이 맞는지 고민한다. (`selection.from_layer` · `smart_object.rasterize`
와 같은 판단)

## `channel.select` 는 보이는 채널도 바꾼다

고른 채널이 보이게 되고 나머지는 숨는다. 그래서 `channel.get` 의 histogram 을
읽기 전에 이것을 부르게 된다. **끝나면 성분 채널 전부로 되돌려야 한다** —
안 되돌리면 다음 필터·조정이 조용히 한 채널에만 걸린다.

## 체크리스트

- [x] `photoshop.channel.list` · `get` · `create` · `select` · `duplicate` · `delete`
- [x] 전부 DOM — descriptor 를 한 번도 잡지 않았다
- [x] 실기: 지역화된 이름 · `kind` 값 · `save_channel` 연동
- [x] 실기: histogram 의 두 제약을 잡아 미리 막는다 (255번 칸 18000 로 검산)
- [x] 실기: 색 성분 채널 삭제 거절 · 알파 채널 삭제·복제·생성
- [x] Mock 은 알파 채널만 모델링한다 (이름이 지역화되어 지어낼 수 없다)

# 57. 레이어 컴프 (`layer_comp.*` 여섯)

레이어의 **표시 여부 · 위치 · 모양(레이어 스타일)** 을 한 벌로 저장해 두고
오간다. `CORE_API.md` §5 에 없던 영역이다.

`history.undo` 와 다른 물건이다 — History 는 시간 순서 하나이고 이쪽은 **이름
붙인 여러 안을 나란히** 둔다.

## 전부 DOM 이다

`document.layerComps`(24.0+) 컬렉션에 `add` · `getAllByName` · `length` ·
색인이 있고, `LayerComp` 에 `apply` · `recapture` · `remove` · `duplicate` ·
`resetLayerComp` 와 R/W 속성들이 있다. batchPlay 를 쓰지 않았다.

## `add` 의 옵션 모양을 짐작하지 않았다

레퍼런스가 `add(options: LayerCompCreateOptions)` 라고만 적고 **그 인터페이스
페이지가 404 다.** 옵션 키를 지어내는 대신 **`add({})` 로 만든 뒤 R/W 속성에
직접 넣고 읽어서 확인**하는 쪽으로 갔다 — `name` · `comment` · `appearance` ·
`position` · `visibility` · `childComp` 가 전부 읽기/쓰기다.

실기에서 전부 들어갔다.

```text
create { name: "안-전부", comment: "…", appearance: true, position: true }
→ name · comment · appearance · position 이 그대로 읽힌다
```

옵션 없이 만들면 레퍼런스 문장 그대로였다.

```text
create { name: "안-둘다" }
→ appearance false · position false · visibility true
  "If no options are given, only visibility will be recorded"
```

**결과가 요청값이 아니라 만든 뒤 읽은 값**이라 이것이 드러난다.

## 이름이 유일하지 않다 — 추론을 실기로 확인했다

`getAllByName` 이 **배열**을 돌려주는 것에서 "이름이 유일하지 않다" 고 추론하고
이름 중복 시 거절하게 만들었다. **그 추론이 짐작인 채로 남지 않게 재 봤다.**

```text
create { name: "안-둘다" }   (이미 같은 이름이 있는 상태)
→ 만들어진다. index 0 과 3 에 같은 이름
get { name: "안-둘다" }
→ 거절: "2개입니다. index 로 고르세요" · indexes [0, 3]
```

액션과 같은 성질이다(§17.34). 조용히 첫 번째를 고르면 호출자가 무엇에 걸었는지
모른다.

## `apply` 가 실제로 레이어를 바꾼다 — 재서 확인했다

```text
A·B 둘 다 보임  →  create "안-둘다"
B 숨김          →  create "안-A만"
apply "안-둘다" →  layer.list: B visible true   ← 되돌아온다
apply "안-A만"  →  layer.list: B visible false
```

## `recapture` 는 덮어쓴다 — 그래서 destructive 다

```text
B 숨긴 상태에서 recapture index 0 ("안-둘다")
B 를 다시 보이게 한 뒤 apply index 0
→ B visible false
```

**원래 기록("둘 다 보임")이 사라졌다.** History 말고 되돌릴 길이 없어
`mask.delete` · `channel.delete` 와 같은 자리에 둔다. 새 안을 만들려는 것이면
`create` 가 맞다 — 그쪽은 기존 컴프를 건드리지 않는다.

`apply` 는 `edit` 이다. 문서 배치는 바뀌지만 **저장해 둔 기록은 그대로 남는다.**

## Mock 은 `apply` 가 레이어를 바꾸는 것을 흉내내지 않는다

무엇이 어떻게 바뀌는지는 좌표와 스타일이라 Mock 이 모른다. 흉내내는 것은
**이름 · 설명 · 무엇을 기억하는지 · 어느 컴프가 골라졌는지**까지다. 이름 중복
거절도 흉내낸다 — 그것은 계약이다.

## 체크리스트

- [x] `photoshop.layer_comp.list` · `get` · `create` · `apply` · `recapture` · `delete`
- [x] 전부 DOM — descriptor 를 한 번도 잡지 않았다
- [x] `add` 옵션을 짐작하지 않고 속성 대입 + 읽기로 확인
- [x] 실기: 이름 중복이 실제로 된다 (추론을 검증)
- [x] 실기: `apply` 가 표시 여부를 되돌린다 (`layer.list` 로 검산)
- [x] 실기: `recapture` 가 옛 기록을 지운다 → destructive

# 58. 패스 (`path.*` 여덟)

`CORE_API.md` §5.12 에 이름만 잡혀 있던 것이다. `fill` · `stroke` 가 더해져
여덟이 됐다.

## 전부 DOM 이다

`document.pathItems`(23.3+) 컬렉션과 `PathItem` 클래스로 다 된다. batchPlay 를
쓰지 않았다.

## `create` 는 선택 영역에서 만든다

`pathItems.add(name, entirePath: SubPathInfo[])` 는 **베지어 기하를 요구하고
`SubPathInfo` 의 인터페이스 문서가 없다.** 좌표를 지어내 넘기면 무엇이
만들어질지 모른다.

대신 `Selection.makeWorkPath(tolerance)` 를 쓴다 — 이 저장소에는
`selection.sky` · `subject` · `polygon` · `color_range` 처럼 좋은 선택을 만드는
길이 이미 많다. 그쪽에서 받아 오는 것이 자연스럽다.

**이름을 주면 저장된 패스가 되는 것도 재서 확인했다.**

```text
create { name: "타원" }  →  kind: normalPath
create { }               →  name: "작업 패스" · kind: workPathIndex
```

**런타임 값이 상수 이름과 다르다** — `constants.PathKind` 의 멤버는 `WORKPATH`
인데 읽히는 값은 `workPathIndex` 다. 그래서 `kind` 를 매핑하지 않고 문자열
그대로 두었다.

## 선택과 왕복한다

```text
selection.set ellipse 100,75,300,225
path.create { tolerance: 1 }   →  normalPath
selection.clear
path.to_selection              →  selection:99,75,301,226
```

±1px 는 tolerance 1 의 베지어 근사다. `selection.save_channel` 과 갈리는
자리다 — 그쪽은 픽셀이라 확대하면 뭉개지고 패스는 안 매인다.

## `fill` 은 정확하다

```text
path.fill { color: {240, 40, 40} }
→ 레이어 p50: R 240 · G 40 · B 40
```

## `stroke` 는 굵기와 색을 정할 수 없다 — 그것이 지배적 사실이다

`strokePath(tool, simulatePressure, sourceOrigin?, sourceLayer?)` 에 **굵기도
색도 없다.** 도구의 Photoshop 현재 설정을 그대로 쓴다.

처음에는 "결과를 확인하라" 는 주의로 적었는데 **실기가 그보다 셌다.**

```text
brush 로 긋기   →  합성 화면에 아무 변화가 없다 (§62 에서 풀렸다)
eraser 로 긋기  →  200×150 빨간 타원이 통째로 사라졌다
                   statistics: "invalid empty image region"
```

**획이 아니라 전면이었다.** 브러시 지름이 타원보다 컸다는 뜻이고, 그것을 읽을
방법도 없다.

그래서 설명이 **"예측 가능한 결과가 필요하면 `path.fill` 을 쓴다"** 로 시작한다.
Tool 을 없애지는 않았다 — 패스를 따라 긋는 다른 길이 없고, 사용자가 브러시를
맞춰 둔 경우에는 쓸 수 있다. 다만 **모르고 부르면 그림이 지워진다.**

## 알파를 무시하는 측정에 또 걸렸다

획이 그어졌는지 보려고 `document.statistics { layerId }` 를 불렀더니 전부 0 이
나왔다 — **투명한 곳과 검은 획을 구분할 수 없다.** `layer.capture` 도 같았다.
합성(`document.capture`)으로 봐야 갈렸다. CLAUDE.md 가 GraXpert 자리에 적어 둔
것과 같은 함정이다.

## `fill` 의 혼합 모드는 열지 않았다

`fillPath` 의 `mode` 인자다. 색과 불투명도로 충분하고, 모드까지 열면
`constants.BlendMode` 매핑이 하나 더 필요해진다. 필요해지면 그때 더한다.

## 체크리스트

- [x] `photoshop.path.list` · `get` · `create` · `select` · `to_selection` · `fill` · `stroke` · `delete`
- [x] 전부 DOM — descriptor 를 한 번도 잡지 않았다
- [x] `SubPathInfo` 를 짐작하지 않고 `makeWorkPath` 로 갔다
- [x] 실기: 이름 유무로 `normalPath` / `workPathIndex` 가 갈린다
- [x] 실기: 선택 ↔ 패스 왕복 (±1px)
- [x] 실기: `fill` 이 정확한 색으로 칠한다
- [x] 실기: `stroke` 가 타원을 통째로 지웠다 → 설명을 경고에서 사실로 바꿨다

# 59. 가이드 (`guide.*` 셋)

`CORE_API.md` §5.12 에 이름만 잡혀 있던 것이다.

## 전부 DOM 이다

`document.guides`(23.0+) 컬렉션에 `add(direction, coordinate)` · `length` ·
색인이 있고 `Guide` 에 `coordinate` · `direction`(둘 다 R/W) · `id` ·
`delete()` 가 있다. batchPlay 를 쓰지 않았다.

**`delete()` 는 동기다** — 레퍼런스가 "Async: No" 라고 적는다. `await` 는 둘
다 받으므로 그대로 기다린다(§48 과 같은 처리).

## 실기에서 확인한 것

```text
constants.Direction   27.8 에 있다 — FlipAxis(§44) 와 달랐다
direction             "vertical" · "horizontal" 그대로 읽힌다
coordinate            준 값 그대로. 소수도 유지된다(100.5)
화면                  창 캡처로 삼분할선이 보였다
```

## 색인은 밀리고 `id` 는 안 밀린다 — 설계를 바꿨다

하나를 지우니 뒤의 것이 내려왔다.

```text
지우기 전   [0] id 782   [1] id 785   [2] id 789
index 0 삭제 후  [0] id 785   [1] id 789
```

처음에는 `index` 만 받고 **"큰 색인부터 지우세요" 라고 설명에 적어 두었다.**
측정하고 나서 `id` 로 고르는 길을 열었다 — 그러면 그 주의 자체가 필요 없다.

```text
[785, 789, 796] 에서 id 785 삭제 → 796 이 index 1 로 내려옴
그 상태에서 id 796 삭제          → coordinate 250 짜리를 정확히 지웠다
```

**경고를 적는 것과 경고가 필요 없게 만드는 것은 다르다.** 재 보지 않았으면
전자에서 멈췄을 것이다.

## `delete` 를 `edit` 로 갔다 — 예정값을 바꿨다

§5.12 가 `guide.delete(DESTRUCTIVE)` 로 적어 두었지만 **지우는 것이 좌표
하나뿐이다.** 마스크·채널·레이어 컴프처럼 쌓아 둔 작업이 없고 같은 값으로 다시
만들면 된다.

§5 의 Permission 은 "구현 시점의 예정값이며 §2 의 경계 규칙이 최종" 이라고 그
문서가 적고 있다. `image.resize` 가 반대 방향(EDIT → DESTRUCTIVE)으로 바뀐 것과
같은 자리다.

## 좌표는 눈금자 원점 기준이다

레퍼런스가 "measured from the **ruler origin**" 이라고 적는다 — 사용자가 원점을
옮겼으면 캔버스 좌표와 어긋나고 **그것을 읽을 방법이 없다.** 설명에 적어 둔다.

23.0~24.0 사이에는 72 PPI 가 아닐 때 값이 틀리는 버그가 있었다고 레퍼런스가
적는다. 27.8 이라 해당 없다.

## Mock 이 전부 흉내낸다

방향과 좌표뿐이라 지어낼 것이 없다 — 이 저장소에서 드문 경우다. `id` 가 안
밀리는 계약도 흉내낸다.

## 체크리스트

- [x] `photoshop.guide.list` · `create` · `delete`
- [x] 전부 DOM — descriptor 를 한 번도 잡지 않았다
- [x] 실기: `constants.Direction` 존재 · 방향 문자열 · 소수 좌표 · 화면 확인
- [x] 실기: 색인이 밀리는 것을 보고 `id` 선택자를 더했다
- [x] `delete` 를 예정값 DESTRUCTIVE 에서 EDIT 로 바꿨다 (근거를 적음)

# 60. 텍스트 세부 (`text.*` 여덟)

`text.create` · `text.set` · `font.list` 은 **워터마크·서명 범위**로 열어
두었고(§17.33) 나머지는 `CORE_API.md` §5.12 에 "실제 요구가 확인된 뒤에
연다" 로 남아 있었다. 요구가 확인되어 열었다.

`convert_to_point` · `convert_to_paragraph` · `convert_to_shape` 셋은 §5.12
목록에도 없던 것이다.

## 전부 DOM 이다

`TextItem`(24.1+) 에 `characterStyle` · `paragraphStyle` · `warpStyle` 과
변환 메서드 셋이 있다. batchPlay 를 쓰지 않았다.

## 단위가 레퍼런스에 적혀 있다 — 짐작할 뻔한 자리다

```text
tracking            1/1000 em      픽셀도 포인트도 아니다
leading             72ppi 픽셀
들여쓰기·문단 간격   72ppi 픽셀
```

`size` 를 포인트로 받는 기존 `text.create` 와 헷갈리기 쉽다. 300ppi 문서에서는
Photoshop 화면에서 보는 값과 다르다.

## 실기에서 나온 것

```text
text.get              font "Gulim" · size 48 · tracking 0 · justification "left"
                      clickPoint {60,120} 로 만든 위치가 그대로 읽힌다
tracking 400          그대로 들어간다
leading 120           119.99999999999999 · useAutoLeading 자동으로 false
auto: true            **leading 이 null 이 된다** — 값이 지워진다
warp arc bend 60      style "warpArc"
warp arcLower         style "warpArcLower"
convert_to_paragraph  isParagraphText true · clickPoint 가 상자 원점으로 바뀐다
convert_to_point      clickPoint 가 {60,120} 로 복귀
convert_to_shape      type "shape" · 이후 text.get 이 거절한다
```

## 자동 행간이 값을 지운다 — 우회가 맞았다

레퍼런스만 보고 "`useAutoLeading` 이 켜져 있으면 `leading` 이 안 먹을 것" 이라
짐작해 **`leading` 만 주면 먼저 끄도록** 만들었다. 재 보니 그보다 셌다 —
`auto: true` 를 켜면 **`leading` 이 `null` 이 된다.** 값이 무시되는 게 아니라
지워진다.

화면으로도 확인했다. 자동 행간 쪽이 눈에 띄게 좁았다.

## `\n` 이 줄바꿈이 아니다 — 기존 Tool 의 실제 결함이었다

행간을 시험하려고 두 줄짜리 텍스트를 만들었는데 **한 줄로 나오고 가운데에
네모(□)** 가 찍혔다. Photoshop 텍스트 레이어는 `\r` 을 줄바꿈으로 읽는다.
**오류는 나지 않는다** — 글꼴에 없는 글자로 조용히 그려진다.

`text.create` · `text.set` 은 §17.33 부터 있던 Tool 이고 **이 결함을 여태
몰랐다.** 여러 줄 워터마크를 넣은 적이 없었기 때문이다.

호출자가 Photoshop 의 버릇을 알 이유가 없으므로 **경계에서 바꾼다** —
`normalizeNewlines` 가 `\r\n` · `\n` 을 `\r` 로 만든다. 고친 뒤 두 줄로 나왔다.

## 워프 이름을 되돌린다

읽히는 값에 **`warp` 접두사가 붙는다** — `none` → `warpNone`,
`arcLower` → `warpArcLower`. 상수 멤버 이름(`NONE` · `ARCLOWER`)과도 다르다.

그대로 돌려주면 **호출자가 넣는 어휘와 읽는 어휘가 달라진다.** 규칙이 분명하니
경계에서 되돌린다. 모르는 값은 그대로 둔다 — 억지로 깎으면 없는 이름을 만든다.

§58 의 `path.kind` 는 `workPathIndex` 로 규칙을 못 찾아 원본을 그대로 두었다.
**규칙이 있으면 감추고 없으면 드러낸다.**

## `set_paragraph` 뒤에는 안 건드린 항목이 `null` 이 된다

```text
처음         firstLineIndent 0 · leftIndent 0 · spaceAfter 0 · hyphenation false
justification 와 spaceBefore 만 바꾼 뒤
             firstLineIndent null · leftIndent null · spaceAfter null · hyphenation null
```

Photoshop 이 **명시적으로 설정한 것만** 보고한다. 다시 읽어도 `null` 이다.
**`null` 을 0 으로 읽으면 안 된다** — 설명에 적었다.

## `convert_to_shape` 만 destructive 다

글자가 벡터가 되어 **더는 텍스트가 아니다** — 내용도 폰트도 고칠 수 없다.
`layer.rasterize` 와 같은 자리다. 실기에서 변환 뒤 `text.get` 이 거절하는
것까지 확인했고 Mock 도 그 계약을 흉내낸다.

`warp` 는 `edit` 이다 — 휘어도 텍스트로 남는다.

## 체크리스트

- [x] `photoshop.text.get` · `set_tracking` · `set_leading` · `set_paragraph` · `warp`
- [x] `photoshop.text.convert_to_point` · `convert_to_paragraph` · `convert_to_shape`
- [x] 전부 DOM — descriptor 를 한 번도 잡지 않았다
- [x] 실기: 여덟 개 전부 · 단위 · 열거값 읽기
- [x] 실기: 자동 행간이 `leading` 을 지운다 (짐작보다 셌다)
- [x] **기존 결함 수정**: `\n` 이 네모로 그려지던 것을 `\r` 로 바꾼다
- [x] 워프 이름을 경계에서 되돌린다 (넣는 어휘 = 읽는 어휘)

# 61. 환경 설정과 색 (`preferences.get` · `color.get_foreground_background`)

`CORE_API.md` §5.11 의 P3 셋 중 둘이다. `units.get` 은 만들지 않았다 —
`preferences.get` 의 `unitsAndRulers` 가 그것이다.

## 속성 이름을 짐작하지 않고 반사적으로 읽는다

`Preferences` 는 열두 개 하위 객체인데 **그 안쪽 속성이 레퍼런스 페이지에
없다.** 이름을 지어 읽으면 무엇이 빠졌는지도 모른다.

그래서 하위 객체의 열거 가능한 키를 훑어 **값이 읽히는 것만** 담는다. 중첩
객체와 함수는 뺀다 — 무엇이 값이고 무엇이 API 인지 호출자가 가릴 수 없게 된다.

실기에서 열두 범주가 전부 값을 냈다. 짐작한 이름은 하나도 없다.

```text
unitsAndRulers  rulerUnits "rulerPixels" · typeUnits "rulerPoints" · pointSize "POSTSCRIPT"
history         numberOfHistoryStates 50 · nonLinearHistory false · createFirstSnapshot true
performance     maxRAMuse 70 · imageCacheLevels 4
fileHandling    maximizeCompatibility "queryAsk" · recentFileListMaximum 20
```

**`unitsAndRulers` 에 해상도는 없었다.** 설명에 "눈금자 단위와 기본 해상도를
담는다" 고 적어 두었다가 재 보고 고쳤다 — 문서 해상도는 `document.get` 쪽이다.

## 전경색이 검정이었다 — §58 의 추정을 지웠다

§58 에서 `path.stroke` 의 브러시 획이 안 보인 것을 **"흰색 + 큰 지름으로
추정"** 이라고 적었다. 재 보니 전경색은 **#000000** 이다.

```text
foreground  #000000
background  #FFFFFF
```

지우개가 타원을 통째로 지운 것은 사실이므로 **지름이 큰 것은 맞다.** 검은
브러시가 왜 안 보였는지는 **아직 모른다** — §58 의 괄호를 "원인 미상" 으로
바꿨다. (§62 에서 풀렸다.)

**짐작을 괄호에 넣어 두면 나중에 사실처럼 읽힌다.**

## 바꾸는 Tool 은 만들지 않았다

전경색과 환경 설정은 **사용자가 Photoshop UI 에서 쓰는 상태**다. LLM 이 말없이
바꾸면 사용자가 다음에 칠할 때 엉뚱한 색이 나오고, 환경 설정은 이후 모든
작업이 달라진다.

색을 정해 칠하려면 색을 인자로 받는 Tool 을 쓴다 — `paint.dab` · `path.fill` ·
`text.create`.

**색 쪽은 §62 에서 뒤집었다.** 사용자가 요청했고, 근거였던 "사용자 상태가
조용히 바뀐다" 는 **되돌릴 수 있게 지으면 사라지는 문제**였다 — 바꾸기 전
색을 결과에 담으면 된다. 환경 설정 쪽은 그대로다.

## `app.displayDialogs` 는 있다 — 저장소 문서가 틀렸다

레퍼런스를 읽다가 `app` 에 `displayDialogs`(DialogModes, R/W, 23.0+)가 있는
것을 봤다. CLAUDE.md 는 **세 곳에서** "UXP 에 없어 대화상자를 끄지 못한다" 고
적고 있었다.

`host.get` 이 "이 서버가 쓰는 API 의 유무" 를 답하는 자리이므로 거기에 물었다.

```text
displayDialogs: true      27.8
```

**속성은 있다.** 다만 **있다는 것과 대화상자를 실제로 막는다는 것은 다르다** —
걸어서 재 보지 않았으므로 `ACTION_PLAY` 는 그대로 두었고, 문서에서는
**결론(못 끈다)과 근거(없다)를 분리해** 근거만 고쳤다.

옛 기록에 "실기에서 확인했다" 고만 적혀 있어 **무엇을 확인한 것인지 가릴 수
없다.** 없는 것을 본 것인지, 걸었는데 안 먹어서 없다고 읽은 것인지 모른다.
후자라면 결론은 살아 있다.

`host.get` 의 `layerComps` · `pathItems` 주석에 "이 서버는 아직 쓰지 않는다"
고 남아 있던 것도 함께 고쳤다 — §57 · §58 이 이제 쓴다.

## 체크리스트

- [x] `photoshop.preferences.get` (READ, 열두 범주)
- [x] `photoshop.color.get_foreground_background` (READ)
- [x] `units.get` 은 만들지 않았다 — `unitsAndRulers` 가 준다
- [x] 속성 이름을 짐작하지 않고 반사적으로 읽는다
- [x] 실기: 열두 범주가 전부 값을 낸다 · 해상도는 없다
- [x] 실기: 전경색 #000000 — §58 의 추정을 지웠다
- [x] `host.get` 에 `displayDialogs` 추가 — CLAUDE.md 의 틀린 근거를 고쳤다
- [x] `displayDialogs` 를 실제로 걸어 봤다 — §63. **거는 것은 되고 막히는지는 여전히 모른다**

# 62. 전경색·배경색 바꾸기 (`color.set_foreground` · `color.set_background`)

둘 다 EDIT.

## §61 의 결정을 뒤집었다

§61 에 **"바꾸는 Tool 은 만들지 않았다"** 고 적었다. 근거는 이랬다.

> 전경색은 사용자가 Photoshop UI 에서 쓰는 상태다 — LLM 이 말없이 바꾸면
> 사용자가 다음에 칠할 때 엉뚱한 색이 나온다.

사용자가 요청했고, 다시 보니 **그 근거는 되돌릴 수 있게 지으면 사라지는
문제**였다. 위험한 것은 "바꾸는 것" 이 아니라 "말없이" 쪽이다.

그래서 결과에 **`previous`** 를 담는다. 빌려 쓰고 돌려놓는 것이 계약이다.

```text
set_foreground { 17, 200, 133 }
  → previous #000000   ← 이것을 들고 있다가 끝나고 다시 넣는다
    current  #11C885
    applied  true
```

**환경 설정 쪽은 그대로 안 만들었다.** 색은 값이 셋이라 통째로 들고 되돌릴 수
있지만, 환경 설정은 무엇이 바뀌었는지 호출자가 추적하기 어렵고 범위가
Photoshop 전체다.

## `previous` 를 통째로 넘기지 않는다

`ColorInfo` 에는 `hex` 가 함께 들어 있고 파라미터 스키마는 `.strict()` 라
셋만 받는다. 테스트를 쓰다가 걸렸다.

```text
set_foreground(second.previous)          →  거절 (Unrecognized key 'hex')
set_foreground({ red, green, blue })     →  된다
```

**스키마를 느슨하게 하지 않고 설명을 고쳤다.** `hex` 를 받아 조용히 무시하면
`hex` 와 `rgb` 가 어긋난 입력에서 어느 쪽을 쓰는지 아무도 모른다. 테스트가
거절되는 것까지 함께 고정한다.

## Photoshop 은 정수를 정수로 돌려주지 않는다

실기 첫 호출에서 `applied: false` 가 나왔다. `hex` 는 `#DC285A` 로 맞는데도.

```text
요청   220           40            90
응답   220.00000208  40.00000141   90.00000223
```

내부가 0–1 실수라 왕복에서 오차가 샌다. **`applied` 오탐보다 큰 문제는
되돌리기가 깨진다는 것**이다 — 다음 호출의 `previous` 가 `220.0000020…` 으로
나오는데 스키마는 정수만 받는다.

`readColor` 에서 **반올림한다.** 사용자가 색 선택기에서 고를 수 있는 것도
0–255 정수뿐이라 정보를 버리지 않는다.

**이 함정은 이미 적어 두었던 것이다.** CLAUDE.md 의 배경 `set_opacity` 항목에
"Photoshop 이 0–255 로 저장하므로 정확히 비교하면 오탐이 난다" 고 있었다.
**적어 둔 것과 다음에 쓸 때 떠올리는 것은 다르다.**

## §58 의 "원인 미상" 이 풀렸다

`path.stroke` 가 전경색을 쓰는지 확인하려고 400×300 흰 문서에 200×150 타원
패스를 만들어 brush 로 그었다.

```text
전경색 (17, 200, 133)
결과   문서 전체가 완벽히 균일한 (207, 244, 231)
```

흰색에서 전경색 쪽으로 **정확히 20%** 간 값이다.

```text
R  255 + (17−255)×0.2 = 207.4
G  255 + (200−255)×0.2 = 244.0
B  255 + (133−255)×0.2 = 230.6
```

세 가지가 한꺼번에 확인됐다.

- **색은 전경색이 맞다.** §58 이 못 풀었던 것이다
- **브러시 지름이 문서보다 크다** — 획이 아니라 전면이다
- **불투명도가 20% 다** — §58 에서 검은 브러시가 안 보였던 이유

§58 에서 "흰색 + 큰 지름으로 추정" 했다가 전경색이 #000000 이라 그 추정을
지웠다. **지름 쪽 절반은 맞았는데 색 쪽이 틀려서 통째로 버렸다.** 남은 조각은
불투명도였고, 그건 그때 볼 수 있는 값이 아니었다.

뒤 두 가지는 **이 기기의 현재 브러시 설정**이라 일반화하지 않는다. Tool 설명이
말하는 것은 그대로다 — 색은 정할 수 있고 굵기·불투명도는 여전히 못 읽는다.

## `path.stroke` 설명을 고쳤다

§58 이 "무슨 색으로 그어질지는 `get_foreground_background` 로 **볼 수 있다**"
였는데 이제 **정할 수 있다.** 굵기만 남았다.

## Mock

**넣어 준 색만 안다.** 처음에는 `previous` 가 전부 `null` 이다 — 실행 중인
Photoshop 의 색을 지어내면 첫 되돌리기가 엉뚱한 색을 남긴다.

한 번 넣은 뒤로는 그 값을 그대로 돌려준다. 그것은 짐작이 아니라 이 세션에서
실제로 일어난 일이다.

## 체크리스트

- [x] `photoshop.color.set_foreground` (EDIT)
- [x] `photoshop.color.set_background` (EDIT)
- [x] `previous` 로 되돌릴 수 있다
- [x] 반올림 — 실기에서 `applied: false` 오탐을 잡았다
- [x] `previous` 를 통째로 넘기면 거절된다는 것까지 테스트로 고정
- [x] 실기: 전경·배경이 섞이지 않는다
- [x] 실기: `path.stroke` 가 전경색을 쓴다 — §58 "원인 미상" 해소
- [x] Mock 은 넣어 준 값만 안다

# 63. `displayDialogs` — 짐작한 문자열이 틀렸다

§61 이 "`app.displayDialogs` 는 있다" 까지 확인하고 **"실제로 걸면 막히는지" 를
열어 두었다.** 그것을 재려고 들어갔다가 다른 것을 찾았다.

## 코드는 이미 걸고 있었고, 틀린 값을 넣고 있었다

문서 세 곳이 "`app.displayDialogs` 가 UXP 에 없어 끄지 못한다" 였는데
`action-play.ts` 의 `withoutDialogs()` 는 **이미 걸려고 시도하고 있었다.**
문서와 코드가 어긋난 채로 있었다.

넣던 값이 `"dontDisplayDialogs"` 였다. **어디서도 확인한 적 없는 지어낸
문자열이다.**

Adobe 레퍼런스를 봤다. `DialogModes` 는 **멤버 이름만** 있다.

```text
ALL     All dialogs will be shown
ERROR   Dialogs will be shown only if Photoshop raises an error
NONE    All dialogs will be hidden, and bad calls will silently fail
```

런타임 문자열이 없다 — `constants.FlipAxis`(§44) · `bitsPerChannel`(§39) 과
같은 자리다. **레퍼런스에 없으면 재야 한다.**

## 재 보니 `"dontDisplay"` 였다

`constants.DialogModes.NONE` 을 읽어 걸고 실제로 들어간 값을 결과에 담았다.

```text
dialogMode         "dontDisplay"
dialogsSuppressed  true
```

**`"dontDisplayDialogs"` 가 아니다.** 지어낸 값은 들어가지 않았고, 그동안
`dialogsSuppressed` 는 계속 `false` 였다. 거짓말을 한 것은 아니지만 **한 번도
동작하지 않았다.**

## 판정을 "바뀌었나" 에서 "그 값이 되었나" 로 바꿨다

옛 코드는 이랬다.

```text
suppressed = anyApp["displayDialogs"] !== previous
```

**이미 꺼져 있으면 바뀐 것이 없어 `false` 로 답한다** — 꺼져 있는데 안 껐다고
말한다. `now === target` 으로 고쳤고, 되돌리기도 실제로 바꿨을 때만 한다.

## 막히는지는 **여전히 모른다**

여기서 멈춘다. 거는 것이 되는 것과 뜨려던 대화상자가 막히는 것은 다른 일이다.

허용된 액션이 `StarXTerminator Unscreen` 하나인데 **두 번 다 정상으로 끝났다**
(12.0초 · 11.5초, `Stars` + `Starless` 생성). 대화상자가 뜨지 않았으니 막혔다는
증거가 없다 — **이 액션의 대화상자 토글이 원래 꺼져 있었을 뿐일 수 있다.**

§17.34 에서 15초 멈추게 했던 "'StarXTerminator' 명령은 현재 사용할 수 없습니다"
오류창도 재현되지 않았다. 그때와 달리 액션이 성공했다.

**성공한 실행으로는 억제를 증명할 수 없다.** 증명하려면 대화상자 토글이 켜진
액션이 필요하고 그것은 사용자가 고르는 것이다. 그래서 Tool 설명은
"건다" 까지만 말하고 "막힌다" 고 말하지 않는다.

## 문서 세 곳을 고쳤다

"없어서 못 끈다" 가 근거였던 문장들이다. 근거가 두 번 틀렸다 —
§61 에서 "없다" 가 틀렸고, 여기서 "값" 이 틀렸다.

## 체크리스트

- [x] Adobe 레퍼런스 확인 — `DialogModes` 는 멤버 이름만 있다
- [x] `constants.DialogModes.NONE` 을 읽어 쓴다 — 짐작한 문자열을 뺐다
- [x] 실기: 런타임 값이 `"dontDisplay"` 다
- [x] `dialogsSuppressed` 판정을 `now === target` 으로 고쳤다
- [x] 결과에 `dialogMode` 를 담는다 — 건 값을 호출자가 본다
- [ ] **막히는지는 미확인** — 토글이 켜진 액션이 있어야 잰다

# 64. Camera Raw 샤픈 (`sharpenAmount` · `Radius` · `Detail` · `Masking`)

Camera Raw 커버리지를 훑다가 **세부(Detail) 패널이 반쪽**인 것이 드러났다 —
노이즈 감소 여섯은 있는데 샤픈 넷이 없었다. 둘은 같은 패널이고 서로를
상쇄하는데 한쪽만 걸 수 있었다.

Tool 은 늘지 않는다. `camera_raw.apply` 의 파라미터 넷이다.

## 잡아낸 descriptor

`["all"]` 알림으로 잡았다(§17.17). 사람이 네 슬라이더를 서로 다른 값으로
움직이고 확인을 눌렀다 — **값이 다 달라야 어느 키가 어느 슬라이더인지 갈린다.**

```json
{ "$CrVe": "18.6", "$PrVN": 6, "$PrVe": 251920384,
  "sharpen": 73, "$ShpR": 2.4, "$ShpD": 61, "$ShpM": 38 }
```

## **`sharpen` 에 `$` 가 없다** — 세 번째 예외

`saturation` · `curve` 에 이어 셋째다. `$Shpn` 이나 `$ShpA` 를 짐작했으면
**조용히 무시당했다** — `ok` 를 돌려주면서 아무 일도 안 하는 그 경로다.

헤더 주석에 "`saturation` 만 `$` 가 없다" 고 적혀 있던 것을 고쳤다.
**"하나뿐인 예외" 라고 적어 두면 두 번째가 나왔을 때 못 알아본다.**

## 네 슬라이더를 다 움직이게 한 이유

§52 에서 배운 것이다 — **기본값인 키는 descriptor 에 안 담긴다.** 하나라도
기본값으로 두면 그 키를 못 잡고, 못 잡은 줄도 모른다.

## 범위를 재서 정했다

`sharpenAmount` 를 0–150 으로 열었는데 잡힌 값(73)은 상한을 말해 주지 않는다.
**짐작 대신 두 장을 만들어 나란히 쟀다.**

```text
amount 100  →  σ(R) 1.737
amount 150  →  σ(R) 3.157      ← 잘리지 않았다. 150 은 진짜 범위다
```

100 으로 클램프됐다면 둘이 같았을 것이다.

## `sharpenRadius` 는 실수로 민다 — 확인하지 않은 채로

캡처에 `2.4` 로 실려 있었고 UI 범위가 0.5–3.0 이라 **정수도 유효한 값**이다.
정수가 `$Ex12` 처럼 조용히 무시되는지는 **확인하지 않았다.**

그래서 빌더가 `exposure` 와 같은 `asDouble` 로 민다(`DOUBLE_KEYS`).
확인 전까지 안전한 쪽을 고른 것이고, **우리 Tool 로는 이 질문을 답할 수 없다** —
빌더가 언제나 실수로 바꾸기 때문이다. 답이 필요하면 직접 descriptor 를 보내
재야 하는데 그것은 §23 이 막는 통로다. 모른다고 적어 둔다.

## 실기: `sharpenMasking` 이 천체사진의 핵심이다

같은 `amount 150` 인데 마스킹만 다르게 걸었다.

```text
                     σ(R)      p99(L)
원본                 0.457      96.8
150 / masking  0     3.157     117.4     ← 노이즈가 591% 올랐다
150 / masking 80     0.489      98.1     ← σ 는 7% 만 올랐다
```

**마스킹이 가장자리가 아닌 평탄한 영역을 샤픈에서 뺀다.** 하늘의 노이즈를
세우지 않고 별만 세울 수 있다는 뜻이다.

다만 이 사진에서 80 은 **너무 셌다** — p99 가 +1.3 밖에 안 올라 샤픈 효과가
대부분 사라졌다. 별이 작아서 "가장자리" 로 잡히는 면적이 적기 때문이다.
중간값을 찾아야 하고, 그 판단은 σ 와 p99 를 함께 보고 한다.

## 검증 방법이 이미 있었다

`document.statistics` 의 `noise` 가 **샤픈은 올리고 노이즈 감소는 내리므로**
숫자 하나로 방향이 갈린다. 새 측정 도구를 만들 필요가 없었다.

## 체크리스트

- [x] `["all"]` 캡처로 키 넷 확인 — 짐작 없음
- [x] `sharpen` 에 `$` 가 없다 — 헤더 주석의 "예외 하나" 를 고쳤다
- [x] `sharpenAmount` 상한 150 을 100 과 견주어 확인
- [x] 실기: σ 0.457 → 3.157 (amount 150 · masking 0)
- [x] 실기: `sharpenMasking` 80 이 σ 상승을 7% 로 묶는다
- [x] 단위 테스트로 세 예외와 실수 처리를 고정
- [ ] `$ShpR` 에 정수를 보내면 무시되는지 — **우리 Tool 로는 잴 수 없다**

# 65. 스마트 필터는 descriptor 를 문서에 저장한다

Camera Raw descriptor 를 얻는 더 나은 방법이다. §17.17 이 정해 둔 알림 캡처를
대체한다.

## 알림 캡처의 대가를 §64 에서 직접 치렀다

마스크 구조를 잡으려고 사용자에게 캡처를 부탁해 두고 **그 사이에 서버를
재시작했다.** 이벤트 버퍼는 MCP 서버 프로세스에 있으므로 캡처가 사라졌다 —
§17.17 에 적혀 있는 바로 그 제약인데 순서를 잘못 잡았다.

## 스마트 오브젝트에 걸면 레이어에 남는다

Camera Raw 를 스마트 오브젝트에 걸면 스마트 필터가 되고, 설정이
**`filterFX` 로 레이어에 저장된다.** `smart_object.get_info` 가 그것을
`raw.filterFX` 에 담아 돌려준다.

```json
"filterFX": [{
  "_obj": "filterFX",
  "name": "Camera Raw 필터",
  "filter": { "_obj": "Adobe Camera Raw Filter",
              "$Ex12": 0.75, "sharpen": 73, "$ShpM": 38 },
  "filterID": 2824
}]
```

```text
                알림 캡처              스마트 필터 읽기
저장 위치       서버 메모리            문서 안
서버 재시작     사라진다               남는다
다시 읽기       불가                   몇 번이든
타이밍          직후에 읽어야 한다     아무 때나
```

## 더 큰 것 — **보낸 값이 무엇이 되었는지 보인다**

지금까지 "조용히 무시됐는가" 를 **픽셀을 재서** 간접 확인했다. `$Ex12` 에
정수를 보낸 것도, 파라메트릭 곡선에 경계를 빠뜨린 것도 전부 측정으로 잡았다.

이제 **descriptor 를 직접 되읽을 수 있다.** 위 결과에서 `$Ex12: 0.75` 가
그대로 돌아온 것이 보인다 — 이미 실수라 `asDouble` 이 건드리지 않았다는
사실까지 드러난다.

§64 의 열린 항목(`$ShpR` 에 정수를 보내면 무시되는가)도 이 길로 좁혀진다.
descriptor 에 실려 나간 값은 볼 수 있다. 다만 **Photoshop 이 그것을 받고
무시했는지**는 여전히 픽셀로 재야 한다 — 둘은 다른 질문이다.

## §54 에서 이미 배운 것이었다

*"쓰기와 읽기를 가른다. batchPlay `get` 은 문서를 바꾸지 않으므로 키를 직접
물어서 알아낼 수 있다 — 캡처를 부탁할 필요가 없다."*

§54 는 그것을 스마트 오브젝트 **속성**에 썼고, 여기서는 같은 것이
**필터 설정**에도 성립한다는 것이 드러났다. 규칙을 한 번 쓴 자리에만 두면
다음에 같은 문제를 만났을 때 다시 찾지 못한다.

## 언제 알림 캡처가 여전히 필요한가

스마트 필터로 남지 않는 것들이다 — 조정 레이어 만들기(§52) · `autoCutout` ·
마스크 관련 descriptor 처럼 **필터가 아닌 명령**은 레이어에 설정이 저장되지
않으므로 알림으로 잡아야 한다.

**필터면 스마트 오브젝트, 명령이면 알림.**

## 체크리스트

- [x] `smart_object.get_info` 의 `raw.filterFX` 로 Camera Raw 설정이 읽힌다
- [x] 우리가 건 값(`$Ex12` · `sharpen` · `$ShpM`)이 그대로 되읽힌다
- [x] 서버 재시작과 무관하다 — 문서에 저장된다
- [ ] 마스크 descriptor 구조 — 이 방법으로 잡는다

# 66. Camera Raw 마스크는 descriptor 가 아니라 XMP 문자열이다

§65 의 방법으로 잡았다. **아직 구현하지 않았다** — 무엇인지 알아낸 기록이다.

## 짐작이 종류부터 틀렸다

§63 리뷰에서 "CR 마스크는 중첩 배열 구조라 급이 다르다" 고 적었다. 실제로는
**XMP XML 문자열 하나**다.

```text
filter["$LCs"] = "<x:xmpmeta …>…</x:xmpmeta>"
```

descriptor 의 키 하나에 XML 문서가 통째로 들어간다. "비싸다" 는 결론은 맞았고
**이유는 틀렸다.** 짐작으로 순위를 매겼던 것이라 근거가 없었다.

## 구조

```text
crs:MaskGroupBasedCorrections
└ rdf:Seq / rdf:li                          보정 하나
   crs:What="Correction"
   crs:CorrectionAmount="1"  CorrectionActive="true"
   crs:CorrectionName="마스크 1"
   crs:CorrectionSyncID="ABEC…B0"           GUID
   crs:LocalExposure2012="0.75"             ← 이 보정의 슬라이더
   crs:LocalContrast2012 · LocalHighlights2012 · LocalShadows2012 ·
   LocalWhites2012 · LocalBlacks2012 · LocalClarity2012 · LocalDehaze ·
   LocalLuminanceNoise · LocalMoire · LocalDefringe · LocalTemperature ·
   LocalTint · LocalTexture · LocalGrain · LocalGlow ·
   LocalCorrectedDepth · LocalCurveRefineSaturation="100"
   (+ 2012 이전 이름 9개가 함께 있다 — LocalExposure · LocalBrightness …)
   └ crs:CorrectionMasks / rdf:Seq / rdf:li  이 보정이 쓰는 마스크들
      crs:What="Mask/Gradient"
      crs:MaskActive="true"   MaskInverted="false"
      crs:MaskBlendMode="0"                 ← add · subtract · intersect
      crs:MaskValue="1"
      crs:ZeroX="0.480487"  ZeroY="0.711423"   시작점 (0–1 정규화)
      crs:FullX="0.478693"  FullY="0.002093"   끝점
```

선형 그레이디언트는 **정규화 좌표 두 점**이다. `mask.gradient` 와 같은 모양이라
호출자 쪽 인터페이스는 이미 있는 것을 쓸 수 있다.

`MaskBlendMode` 가 있다 — §63 의 표가 "Mask Intersect/Subtract 높음" 으로
적었던 것이 여기다. 마스크마다 붙으므로 **한 보정 안에서 여러 마스크를
합칠 수 있다.**

## **전역과 국소의 눈금이 다르다**

두 점으로 확정했다.

```text
UI +1.50 EV  →  LocalExposure2012 = 0.375
UI +3.00 EV  →  LocalExposure2012 = 0.75
```

±4 EV 를 ±1 로 정규화한다. **그대로 1.5 를 넣으면 +6 EV 가 된다.**

같은 레이어에 둘이 나란히 있어 덫이 드러났다.

```text
$Ex12             = 0.75   전역 →  +0.75 EV
LocalExposure2012 = 0.75   국소 →  +3.00 EV
```

**같은 숫자가 네 배 다른 뜻이다.** 국소 슬라이더마다 눈금을 따로 재야 하고,
전역의 것을 옮겨 쓰면 안 된다.

## 대화상자를 열었다 닫으면 descriptor 가 정규화된다

사람이 확인을 누르면 **안 보낸 키가 채워진다.**

```text
우리가 보낸 것   $Ex12 · sharpen · $ShpM
되읽은 것        + $ShpR=1 · $ShpD=25 · $CrVe · $PrVN · $PrVe
```

§52 의 "기본값인 키는 descriptor 에 안 담긴다" 와 **반대 방향**이다. 알림으로
잡을 때는 움직인 것만 오고, 스마트 필터를 되읽으면 전부 온다. 어느 쪽을 보고
있는지 알아야 "이 키가 필요한가" 를 잘못 판단하지 않는다.

## 만들 때의 제약

**호출자가 XMP 문자열을 넘기는 통로를 만들지 않는다.** descriptor 보다 위험하다 —
XML 이 통째로 Camera Raw 에 들어간다. 플러그인이 검증된 파라미터로 조립해야
한다. (ARCHITECTURE §23)

`$LCs` 는 덩어리 하나이므로 마스크를 **더하려면 기존 것을 읽어 합쳐 다시
써야 한다.** 그것이 가능한 것은 §65 덕분이다 — 읽는 길이 없었으면 손댈 수
없었다.

## 점진적으로 낼 수 있다

그릇(`MaskGroupBasedCorrections` → `Correction` → `CorrectionMasks`)이 같으므로
마스크 종류는 `What` 값과 좌표 몇 개 차이다.

```text
1단계   Mask/Gradient (선형) + Local 슬라이더 넷    구조 검증
2단계   방사형 · MaskBlendMode
3단계   Mask/Image 계열 (피사체 · 하늘)            별도 캡처 필요
```

## 체크리스트

- [x] `$LCs` 가 XMP XML 문자열임을 확인 — 짐작이 종류부터 틀렸다
- [x] 보정·마스크 계층 구조 확인
- [x] 선형 그레이디언트는 정규화 좌표 두 점
- [x] `MaskBlendMode` 가 마스크마다 붙는다
- [x] **국소 노출 눈금 4:1 을 두 점으로 확정**
- [x] 대화상자가 기본값을 채워 넣는다
- [ ] 방사형 · 범위 · AI 마스크의 `What` 값과 좌표 — 미캡처
- [ ] 국소 슬라이더 나머지의 눈금 — 노출 말고는 안 쟀다
- [ ] 구현 — 아직 안 했다
