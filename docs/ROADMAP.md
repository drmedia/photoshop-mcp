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
milky.*
portrait.*
landscape.*
product.*
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
Phase 6   MilkyScapeTools Extension    보류 — 외부 도구가 Phase 8 에 의존
Phase 7   Workflow System
Phase 8   Capability System            다음
Phase 9   Permission / Safety          완료
Phase 10  Job System
Phase 11  Events
Phase 12  MCP Resources
Phase 13  Production Hardening
Phase 14  Distribution
```

각 Phase 의 항목별 진행 상황은 해당 섹션의 체크박스로 추적한다.

번호 순서대로 진행하지 않는다. Phase 6 의 Tool 7개 중 4개(`remove_gradient` ·
`remove_stars` · `restore_stars` · `enhance`)가 GraXpert · StarNet2 · BXT 같은 외부
프로그램을 필요로 하는데, ROADMAP 자신이 "외부 도구는 Capability Provider 로 구현한다"
(§12) 고 정하고 있다. 그래서 Phase 9 → Phase 8 → Phase 6 순으로 간다.
파일 접근이 Phase 9 에서 풀렸으므로 외부 프로그램에 픽셀을 넘길 통로도 생겼다.

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
│   └─ EXTENSION_SDK.md
│
├─ packages/
│   ├─ mcp-core/
│   ├─ command-engine/
│   ├─ photoshop-tools/
│   ├─ photoshop-bridge/
│   └─ extension-sdk/
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
- [ ] `resources` — Phase 12 (MCP Resources) 에서 추가한다.
- [ ] `capabilities` — Phase 8 (Capability Registry) 에서 추가한다.
- [ ] `photoshop` — `PhotoshopService` 는 아직 정의된 적이 없다. 정의될 때 추가한다.

대응하는 런타임이 없는 필드는 넣지 않았다. 동작하지 않는 껍데기를 두면 Extension 작성자가
있는 줄 알고 쓴다.

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

---

## Initial Tools

1차 후보였던 목록과 실제 결과:

- [x] `milky.get_state` — 문서·작업 폴더·처리기·기존 결과 + **막힌 이유**
- [x] `milky.remove_stars` — TIFF 내보내기 → StarNet2 → 별 제거본·별 두 레이어
- [x] `milky.restore_stars` — 별 레이어 스크린 혼합 + 불투명도
- [x] `milky.enhance` — BlurXTerminator 선명화
- [ ] `milky.remove_gradient` — GraXpert CLI 가 Photoshop 이 못 읽는 FITS 만 출력한다
- [ ] ~~`milky.create_sky_mask`~~ · ~~`milky.create_foreground_mask`~~ — **범위에서 뺀다**

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
| GraXpert | `.tif` → **`.fits`** | **막힘.** Photoshop 이 FITS 를 못 읽는다 |

GraXpert 3.0.2 CLI 에는 출력 형식 옵션이 없다(`-h` 로 확인). `-output out.tif` 를 줘도
`out.tif.fits` 가 나온다. 기존 CEP 패널은 FITS → TIFF 변환을 JS 로 직접 구현해 두었다
(`GraXpert-Photoshop-Panel/client/main.js` 2607~3050행, 약 450줄).

---

## 실기 검증

Photoshop 27.8, 문서 `새비재01_04.tif` 4032×6048 16비트 RGB.

```text
milky.get_state    문서·폴더·처리기·결과 + 막힌 이유 2건 정확히 보고
milky.remove_stars StarNet2 67초 → StarNet2_별제거_01 · StarNet2_별_01(screen)
milky.restore_stars opacity 80 적용
milky.enhance      BXT 10초 → BXT_선명화_01
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

## Requirements

- [ ] Workflow Definition
- [ ] Sequential Command execution
- [ ] Failure handling
- [ ] Rollback strategy 검토
- [ ] Workflow result
- [ ] Progress event

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

**GraXpert 는 예제에서 뺐다.** 3.0.2 CLI 에는 출력 형식 옵션이 없고 항상 FITS 를 쓴다
(`-h` 로 확인). `-output out.tif` 를 줘도 `out.tif.fits` 가 나온다. Photoshop 이 못 여는
형식이라 FITS → TIFF 변환 없이는 왕복이 성립하지 않는다. 동작하지 않는 설정을 예제에
두면 복사해서 쓰는 사람이 속는다.

기존 CEP 패널(`GraXpert-Photoshop-Panel`)은 이 변환을 JS 로 직접 구현해 두었다
(`client/main.js` 2607~3050행, 약 450줄: BITPIX · NAXIS · BSCALE/BZERO · 채널 축 배치 ·
정규화). GraXpert 를 붙이려면 이만큼의 작업이 따로 필요하다.

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

- [ ] `layer.delete` · `document.flatten` · `document.close` — 분류 체계는 섰지만
      각각의 구현은 아직 없다.

---

# 14. Phase 10 — Job System

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

- [ ] Job ID
- [ ] Progress
- [ ] Result
- [ ] Cancel
- [ ] Timeout
- [ ] Cleanup

---

# 15. Phase 11 — Events

Photoshop 변경 사항을 시스템에서 감지할 수 있도록 한다.

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

- [ ] Crash recovery
- [ ] Bridge reconnect
- [ ] Request timeout
- [ ] Process cleanup
- [ ] Temporary file cleanup
- [ ] Invalid Extension isolation

---

# 18. Phase 14 — Distribution

검토 대상:

```text
MCP Server Installer

Photoshop UXP Plugin Installer

Extension Package

Configuration UI
```

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

이 경로가 안정된 후 기능을 확장한다.
