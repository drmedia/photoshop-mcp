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
Phase 4   Extended Photoshop Tools
Phase 5   Extension SDK
Phase 6   MilkyScapeTools Extension
Phase 7   Workflow System
Phase 8   Capability System
Phase 9   Permission / Safety
Phase 10  Job System
Phase 11  Events
Phase 12  MCP Resources
Phase 13  Production Hardening
Phase 14  Distribution
```

각 Phase 의 항목별 진행 상황은 해당 섹션의 체크박스로 추적한다.

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

## 8.5 Document

추가:

```text
photoshop.document.save

photoshop.document.save_as

photoshop.document.export
```

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

requires

permissions
```

---

## 9.2 Extension Manager

구현:

- [ ] discover
- [ ] validate
- [ ] load
- [ ] activate
- [ ] deactivate
- [ ] unload

---

## 9.3 Extension Context

구현:

```typescript
interface ExtensionContext {
  tools: ToolRegistry;

  commands: CommandEngine;

  resources: ResourceRegistry;

  capabilities: CapabilityRegistry;

  photoshop: PhotoshopService;

  logger: Logger;
}
```

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

---

## 9.5 Example Extension

테스트 Extension:

```text
extensions/example-extension
```

Tool:

```text
example.hello
```

---

## Phase 5 Completion Criteria

Photoshop MCP Core 코드를 수정하지 않고 Extension Tool을 추가할 수 있어야 한다.

예:

```text
example.hello
```

가 Extension 설치만으로 MCP Tool 목록에 나타나야 한다.

---

# 10. Phase 6 — MilkyScapeTools Extension

## Objective

MilkyScapeTools를 첫 번째 실제 Photoshop MCP Extension으로 사용한다.

MilkyScapeTools 로직은 Photoshop MCP Core에 넣지 않는다.

---

## Initial Tools

1차 후보:

```text
milky.get_state

milky.create_sky_mask

milky.create_foreground_mask

milky.remove_gradient

milky.remove_stars

milky.enhance

milky.restore_stars
```

---

## External Tools

연결 대상:

```text
GraXpert

StarNet2

BXT
```

이들은 Core가 아니라 MilkyScapeTools 또는 Capability Provider로 구현한다.

---

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

- [ ] Capability Registry
- [ ] Provider Registration
- [ ] Provider Availability
- [ ] Provider Selection
- [ ] Provider Configuration

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

- [ ] Permission metadata
- [ ] Tool Permission
- [ ] Command Permission
- [ ] Extension Permission
- [ ] User approval strategy
- [ ] Destructive protection

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
