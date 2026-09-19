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

- [ ] `layer.delete` · `document.flatten` · `document.close` — 분류 체계는 섰지만
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

## `openDialog` 은 미룬다

`dialogOptions` 를 `_options` 안에 주면 대화상자가 뜨지만, **Bridge 가 15초에
타임아웃**한다. 성공했는데 실패로 보고하게 된다. Job 시스템(§14)과 함께 다룰 일이다.

## 미확인으로 남긴 키

`$GLWA`·`$GLWR`·`$GLWW`·`$GLWS`·`$GLST`, `$TMMs`, `$PGTM`, `RGBSetupClass`.
이름을 짐작하지 않는다.

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
