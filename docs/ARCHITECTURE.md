# Photoshop MCP Server Architecture

## 1. Purpose

Photoshop MCP Server는 LLM 클라이언트가 Adobe Photoshop을 안전하고 구조화된 방식으로 제어할 수 있도록 하는 범용 MCP 서버이다.

이 프로젝트는 특정 도메인에 종속되지 않는다.

예를 들어 다음 기능은 Core에 포함될 수 있다.

- 문서 정보 조회
- 레이어 조회 및 생성
- 레이어 복제
- 마스크 생성
- 선택 영역 제어
- Curves / Levels 조정
- 필터 실행
- 이미지 저장 및 내보내기

반면 다음과 같은 특정 목적의 기능은 Extension으로 구현한다.

- MilkyScapeTools
- Portrait Retouch
- Landscape Processing
- Product Photography
- Astro Processing

핵심 원칙은 다음과 같다.

> Core는 Photoshop을 이해하고, Extension은 작업 도메인을 이해한다.

---

# 2. High-Level Architecture

전체 시스템은 다음 구조를 사용한다.

```text
LLM Client
ChatGPT / Claude / Claude Code / Other MCP Client
                     │
                     │ MCP
                     ▼
┌─────────────────────────────────────┐
│        Photoshop MCP Server         │
│                                     │
│  MCP Protocol                       │
│  Tool Registry                      │
│  Resource Registry                  │
│  Command Engine                     │
│  Extension Manager                  │
│  Permission / Safety                │
│  Session / Job Manager              │
└──────────────────┬──────────────────┘
                   │
                   │ Photoshop Bridge Protocol
                   ▼
┌─────────────────────────────────────┐
│          Photoshop Bridge           │
│                                     │
│  Transport                          │
│  Request / Response                 │
│  Event Routing                      │
│  Connection Management              │
└──────────────────┬──────────────────┘
                   │
                   │ WebSocket
                   ▼
┌─────────────────────────────────────┐
│       Photoshop UXP Plugin          │
│                                     │
│  Command Dispatcher                 │
│  Photoshop DOM Adapter              │
│  batchPlay Adapter                  │
│  Event Publisher                    │
└──────────────────┬──────────────────┘
                   │
                   ▼
             Adobe Photoshop
```

Extension은 MCP Server 내부에서 Core 기능을 사용한다.

```text
                    MCP Server

          ┌────────────┴────────────┐
          │                         │
    Photoshop Core            Extension Manager
                                    │
                         ┌──────────┼──────────┐
                         │          │          │
                      Milky      Portrait   Landscape
```

---

# 3. Core Design Principles

## 3.1 Domain Independence

Core에는 특정 사진 장르나 보정 목적에 관한 로직을 넣지 않는다.

Core에 허용되는 예:

```text
photoshop.document.get
photoshop.layer.list
photoshop.layer.create
photoshop.layer.duplicate
photoshop.mask.create
photoshop.adjustment.curves
photoshop.adjustment.levels
```

Core에 넣지 않는 예:

```text
rcastro.bxt
portrait.skin_retouch
landscape.sky_enhance
astro.remove_stars
```

이 기능들은 Extension에 속한다.

---

## 3.2 MCP Tool과 Photoshop Command 분리

MCP Tool과 내부 Command를 같은 개념으로 만들지 않는다.

```text
MCP Tool
    │
    ▼
Tool Handler
    │
    ▼
Command Engine
    │
    ▼
Command
    │
    ▼
Photoshop Bridge
```

예:

```text
photoshop.layer.duplicate
```

MCP Tool이 호출되면 내부적으로:

```text
LAYER_DUPLICATE
```

Command가 실행된다.

Extension 역시 MCP Tool을 다시 호출하지 않고 Command Engine을 직접 사용한다.

잘못된 구조:

```text
Extension
   ↓
MCP Tool
   ↓
Core
```

권장 구조:

```text
Extension
   ↓
Command Engine
   ↓
Photoshop Bridge
```

MCP는 외부 인터페이스다.

Command Engine은 내부 실행 인터페이스다.

---

# 4. Major Components

## 4.1 MCP Server

MCP Client와 통신하는 최상위 인터페이스이다.

주요 역할:

- Tool 노출
- Resource 노출
- Extension Tool 통합
- 입력 Schema 검증
- Tool Handler 호출
- 결과 반환

MCP Server 자체에는 Photoshop 구현 로직을 넣지 않는다.

---

# 5. Tool Registry

모든 Tool은 Tool Registry를 통해 등록한다.

예:

```typescript
toolRegistry.register({
  name: "photoshop.layer.create",
  description: "Create a Photoshop layer",
  inputSchema: CreateLayerSchema,
  handler: createLayerHandler,
});
```

Tool 종류는 두 가지이다.

### Core Tool

```text
photoshop.*
```

예:

```text
photoshop.document.get
photoshop.layer.list
photoshop.layer.create
```

### Extension Tool

Extension namespace를 사용한다.

예:

```text
rcastro.*
portrait.*
landscape.*
```

Extension은 `photoshop.*` namespace에 Tool을 등록할 수 없다.

---

# 6. Command Engine

Command Engine은 Photoshop 작업을 실행하는 핵심 계층이다.

MCP와 독립적으로 동작해야 한다.

예:

```text
LAYER_CREATE

LAYER_DUPLICATE

LAYER_DELETE

LAYER_RENAME

GROUP_CREATE

MASK_CREATE

SELECTION_CLEAR

ADJUSTMENT_CURVES

ADJUSTMENT_LEVELS

FILTER_GAUSSIAN_BLUR
```

Command 구조 예:

```typescript
interface PhotoshopCommand<T = unknown> {
  type: string;
  documentId?: number;
  params: T;
}
```

예:

```json
{
  "type": "LAYER_DUPLICATE",
  "documentId": 10,
  "params": {
    "layerId": 25
  }
}
```

---

# 7. Command Registry

Command Handler도 Registry 기반으로 관리한다.

```typescript
commandRegistry.register("LAYER_DUPLICATE", duplicateLayerCommandHandler);
```

이를 통해 Command 추가 시 Core Dispatcher를 수정할 필요가 없도록 한다.

---

# 8. Photoshop Bridge

MCP Server는 Photoshop UXP API를 직접 호출하지 않는다.

Photoshop 접근은 반드시 Bridge를 통해 수행한다.

```text
Command Engine
      ↓
Photoshop Bridge
      ↓
UXP Plugin
      ↓
Photoshop
```

Bridge Interface 예:

```typescript
interface PhotoshopBridge {
  isConnected(): boolean;

  executeCommand<T>(command: PhotoshopCommand): Promise<T>;

  getDocumentInfo(): Promise<DocumentInfo>;

  getLayers(): Promise<LayerInfo[]>;
}
```

첫 개발 단계에서는 실제 Photoshop 대신 Mock Bridge를 사용한다.

```text
Command Engine
      ↓
MockPhotoshopBridge
```

이후 동일 Interface를 유지한 상태에서:

```text
MockPhotoshopBridge
        ↓
UXPPhotoshopBridge
```

로 교체한다.

---

# 9. Transport

MCP Server와 UXP Plugin 간 통신은 Transport 계층을 통해 이루어진다.

초기 구현은 WebSocket을 사용한다.

```text
MCP Server
     │
WebSocket
     │
UXP Plugin
```

Transport는 Photoshop 기능과 분리한다.

향후 다른 방식으로 변경할 수 있어야 한다.

예:

```text
WebSocketTransport

LocalSocketTransport

HTTPTransport
```

---

# 10. Bridge Message Protocol

기본 요청 구조:

```json
{
  "id": "request-id",
  "type": "command",
  "command": "LAYER_DUPLICATE",
  "payload": {
    "documentId": 10,
    "layerId": 25
  }
}
```

성공 응답:

```json
{
  "id": "request-id",
  "success": true,
  "result": {
    "layerId": 26
  }
}
```

실패 응답:

```json
{
  "id": "request-id",
  "success": false,
  "error": {
    "code": "LAYER_NOT_FOUND",
    "message": "Layer 25 was not found."
  }
}
```

---

# 11. Photoshop UXP Plugin

UXP Plugin은 Photoshop MCP Server의 실행 Agent 역할을 한다.

UXP의 주요 역할:

```text
Command 수신

↓

Command Dispatcher

↓

Photoshop DOM
또는
batchPlay

↓

결과 반환
```

UXP Plugin 자체에는 MCP 로직을 넣지 않는다.

---

# 12. UXP Command Dispatcher

Command Dispatcher는 Command 이름을 실제 Photoshop 처리 코드에 연결한다.

예:

```typescript
dispatcher.register("LAYER_DUPLICATE", duplicateLayer);
```

실행:

```text
LAYER_DUPLICATE
      ↓
duplicateLayer()
      ↓
Photoshop DOM
```

---

# 13. Photoshop API Usage Policy

가능하면 Photoshop DOM API를 우선 사용한다.

DOM으로 처리하기 어려운 기능만 `batchPlay`를 사용한다.

```text
Photoshop DOM
      ↓
가능하지 않을 경우
      ↓
batchPlay
```

Photoshop 상태를 변경하는 작업은 적절한 modal execution 환경에서 수행한다.

LLM이 임의의 `batchPlay` descriptor 또는 JavaScript를 직접 생성하고 실행하는 기능은 제공하지 않는다.

---

# 14. Extension Architecture

Extension은 특정 도메인의 Photoshop Workflow를 구현한다.

예:

```text
MilkyScapeTools

PortraitTools

LandscapeTools

ProductPhotoTools
```

Extension 구조:

```text
extension/
│
├─ extension.json
├─ index.ts
│
├─ tools/
├─ commands/
├─ workflows/
└─ resources/
```

---

# 15. Extension Manifest

예:

```json
{
  "id": "milky-scape",
  "name": "MilkyScapeTools",
  "version": "1.0.0",

  "namespace": "milky",

  "requires": {
    "photoshopMcp": ">=1.0.0"
  },

  "permissions": ["photoshop.read", "photoshop.edit"]
}
```

---

# 16. Extension Interface

```typescript
export interface PhotoshopMcpExtension {
  manifest: ExtensionManifest;

  activate(context: ExtensionContext): Promise<void>;

  deactivate?(): Promise<void>;
}
```

Extension Context:

```typescript
interface ExtensionContext {
  manifest: ExtensionManifest;

  tools: ExtensionToolRegistry;

  commands: ExtensionCommandEngine;

  capabilities: ExtensionCapabilityRegistry;

  jobs: ExtensionJobRegistry;

  events: ExtensionEventBus;

  resources: ExtensionResourceRegistry;

  logger: Logger;
}
```

**전체 레지스트리를 주지 않는다.** 각 필드는 `Extension*` 로 좁힌 표면이며
Extension 에 필요한 것만 담는다 — 등록은 하되 조회·해제·호출은 못 한다.
최소 권한 원칙이다. (§17)

`photoshop: PhotoshopService` 는 **없다.** 정의된 적이 없으므로 넣지 않는다 —
동작하지 않는 껍데기를 두면 Extension 작성자가 있는 줄 알고 쓴다.

기준은 `photoshop-bridge/src/extension.ts` 이고, 작성 규격은
[EXTENSION_API.md](EXTENSION_API.md) 다.

---

# 17. Extension Tool Registration

예:

```typescript
export async function activate(ctx: ExtensionContext) {
  ctx.tools.register({
    name: "rcastro.bxt",
    description: "Sharpen with BlurXTerminator",
    permission: "edit",
    inputSchema: EnhanceSchema,
    handler: enhanceMilkyWay,
  });
}
```

**`permission` 은 선택 필드가 아니다.** 빠지면 등록이 거부된다. 그리고
manifest 의 `permissions` 안에 있어야 한다 — 밖이면 호출 시점이 아니라
**등록 시점에** 막는다. 호출 때 막으면 목록에는 떠 있는데 항상 실패하는
상태가 된다. (§22)

Extension은 자신의 namespace만 사용할 수 있다.

허용:

```text
rcastro.bxt

rcastro.nxt
```

금지:

```text
photoshop.layer.create

portrait.skin_retouch
```

---

# 18. Extension Workflow

Extension은 여러 Photoshop Command를 조합해서 하나의 Workflow를 만들 수 있다.

예:

```text
starnet.remove_stars
```

내부:

```text
LAYER_DUPLICATE

↓

GROUP_CREATE

↓

MASK_CREATE

↓

ADJUSTMENT_CURVES
```

MCP Client에서는 하나의 Tool처럼 보일 수 있다.

---

# 19. Capability Registry

특정 프로그램에 직접 의존하지 않도록 Capability 계층을 지원할 수 있다.

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

Extension은 가능하면 특정 실행 프로그램보다 Capability를 요청한다.

예:

```typescript
ctx.capabilities.execute("starRemoval", options);
```

---

# 20. Resources

Core Resource 예:

```text
photoshop://document/current

photoshop://layers

photoshop://selection

photoshop://history

photoshop://capabilities

photoshop://extensions
```

Extension Resource 예:

```text
milky://state

milky://workflow
```

---

# 21. Events

Photoshop 상태 변경을 Event로 제공할 수 있도록 설계한다.

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

흐름:

```text
Photoshop
   ↓
UXP Event
   ↓
Bridge
   ↓
Event Manager
   ↓
Interested Components
```

초기 버전에서는 필수가 아니며 추후 단계에서 추가한다.

---

# 22. Permission Model

모든 작업은 Permission Level을 가진다.

기본 분류:

```text
READ

EDIT

EXTERNAL

DESTRUCTIVE
```

예:

| Operation          | Level       |
| ------------------ | ----------- |
| document.get       | READ        |
| layer.list         | READ        |
| layer.create       | EDIT        |
| curves             | EDIT        |
| external processor | EXTERNAL    |
| layer.delete       | DESTRUCTIVE |
| flatten            | DESTRUCTIVE |
| close without save | DESTRUCTIVE |

Extension도 동일한 Permission System을 사용한다.

---

# 23. Safety Rules

다음 규칙을 기본으로 한다.

1. LLM이 임의의 JavaScript를 Photoshop에서 실행할 수 없도록 한다.

2. LLM이 임의의 `batchPlay` descriptor를 실행할 수 없도록 한다.

3. 모든 Photoshop 수정은 등록된 Command를 통해 실행한다.

4. destructive 작업은 명시적으로 분류한다.

5. Extension은 Core command를 우회해서 Photoshop을 직접 제어하지 않는다.

6. Extension namespace 충돌을 허용하지 않는다.

7. Photoshop Core Tool을 Extension이 override할 수 없다.

---

# 24. Session Management

여러 MCP 요청이 동일한 Photoshop 작업 상태를 공유할 수 있도록 Session 개념을 둔다.

Session 예:

```typescript
interface PhotoshopSession {
  id: string;

  documentId?: number;

  startedAt: number;

  lastActivityAt: number;
}
```

초기 구현에서는 단일 Photoshop Connection만 지원해도 된다.

---

# 25. Job System

GraXpert, StarNet2 같은 외부 프로그램 실행 또는 긴 Photoshop 작업을 위해 Job abstraction을 지원할 수 있다.

```text
QUEUED

RUNNING

COMPLETED

FAILED

CANCELLED
```

초기 Photoshop Core에서는 필수가 아니다.

Extension 단계에서 추가할 수 있다.

---

# 26. Project Structure

권장 Monorepo 구조:

```text
PhotoshopMCP/
│
├─ CLAUDE.md
├─ README.md
│
├─ docs/
│   ├─ ARCHITECTURE.md
│   ├─ CORE_API.md
│   ├─ PROTOCOL.md
│   ├─ ROADMAP.md
│   └─ EXTENSION_API.md
│
├─ packages/
│   │
│   ├─ mcp-core/
│   │   ├─ server/
│   │   ├─ tools/
│   │   └─ resources/
│   │
│   ├─ command-engine/
│   │   ├─ registry/
│   │   ├─ dispatcher/
│   │   └─ validation/
│   │
│   ├─ photoshop-tools/
│   │   ├─ document/
│   │   ├─ layers/
│   │   ├─ masks/
│   │   ├─ selections/
│   │   ├─ adjustments/
│   │   └─ filters/
│   │
│   ├─ photoshop-bridge/
│   │   ├─ protocol/
│   │   └─ transport/
│   │
│   └─ extension-api/
│       ├─ manifest/
│       ├─ api/
│       └─ types/
│
├─ photoshop-uxp/
│   ├─ manifest.json
│   │
│   └─ src/
│       ├─ transport/
│       ├─ dispatcher/
│       ├─ dom/
│       ├─ batchplay/
│       └─ events/
│
├─ extensions/
│   └─ example-extension/
│
└─ tests/
```

---

# 27. Repository Boundary

Photoshop MCP Server와 특정 Domain Extension은 가능하면 별도 Repository로 관리한다.

예:

```text
PhotoshopMCP/

MilkyScapeTools/
```

관계:

```text
Photoshop MCP
      ↑
 Extension SDK
      │
MilkyScapeTools
```

MilkyScapeTools에는 필요 시 다음 모듈을 둔다.

```text
MilkyScapeTools/
│
├─ core/
├─ photoshop-ui/
├─ helper/
└─ photoshop-mcp-extension/
```

---

# 28. Core Tool 노출 순서

기능이 안정되기 전에 Photoshop API 전체를 MCP Tool 로 노출하지 않는다.
Phase 번호와 범위는 `docs/ROADMAP.md` 를 따른다.

**Phase 1 — 조회** (구현 완료)

```text
photoshop.ping
photoshop.document.get
photoshop.layer.list
```

**Phase 3 — 비파괴 편집** (구현 완료)

```text
photoshop.layer.create
photoshop.layer.duplicate
photoshop.layer.rename
photoshop.layer.select
photoshop.layer.set_visibility
photoshop.layer.set_opacity
photoshop.group.create
photoshop.group.move_layer
photoshop.history.undo
```

**Phase 4 — 마스크 · 선택 · 조정 · 필터 · 저장**

```text
photoshop.mask.create
photoshop.mask.enable
photoshop.mask.disable
photoshop.selection.clear
photoshop.selection.invert
photoshop.adjustment.curves
photoshop.adjustment.levels
photoshop.adjustment.brightness_contrast
photoshop.filter.gaussian_blur
photoshop.document.save
photoshop.document.save_as
photoshop.document.export
```

Phase 2 는 Tool 을 추가하지 않는다. Phase 1 의 세 Tool 을 Mock 에서
실제 Photoshop 으로 연결하는 단계다.

destructive Tool (`photoshop.layer.delete`, `photoshop.document.flatten`,
`photoshop.document.close`) 은 Phase 9 의 Permission System 과 함께 도입한다.
그전에는 노출하지 않는다. (§23)

---

# 29. Development Phases

Phase 의 **기준은 `docs/ROADMAP.md`** 다. 이 절은 구조를 이해하기 위한 요약이며,
항목별 진행 상황과 완료 기준은 ROADMAP 의 체크박스를 따른다.

번호나 범위가 ROADMAP 과 달라지면 ROADMAP 이 맞다.

| Phase | 범위 | 상태 |
|---|---|---|
| 0 | Project Bootstrap — 모노레포, TypeScript, Lint, Test, CI | 완료 |
| 1 | MCP Core — ToolRegistry, CommandRegistry, CommandEngine, MockPhotoshopBridge | 완료 |
| 2 | Photoshop Bridge — WebSocket Transport, UXP Plugin, 실제 `DOCUMENT_GET` / `LAYER_LIST` | 완료 |
| 3 | Basic Photoshop Editing — 레이어 생성·복제·이름·선택·표시·불투명도, 그룹, Undo | 완료 |
| 4 | Extended Photoshop Tools — Mask, Selection, Curves / Levels, Filter, Save / Export | |
| 5 | Extension SDK — Manifest, Manager, Context, namespace 검증 | |
| 6 | MilkyScapeTools Extension — 첫 실제 Extension | |
| 7 | Workflow System | |
| 8 | Capability System | |
| 9 | Permission / Safety | |
| 10 | Job System | |
| 11 | Events | |
| 12 | MCP Resources | |
| 13 | Production Hardening | |
| 14 | Distribution | |

## 원칙

Phase 2 까지는 Photoshop 을 **읽기만** 한다. Phase 3 부터 상태를 바꾸되
비파괴 작업으로 제한한다.

destructive 작업(`layer.delete`, `flatten`, `close_without_save`)은 Phase 9 의
Permission System 과 함께 도입한다. 그전에는 Tool 로 노출하지 않는다. (§23)

Extension 관련 기능은 Core 가 안정된 뒤(Phase 5)에 시작한다.
MilkyScapeTools 로직은 어느 Phase 에서도 Core 에 넣지 않는다. (§1)

---

# 30. Testing Strategy

각 계층을 독립적으로 테스트한다.

```text
MCP
 ↓
Mock Tool Handler

Command Engine
 ↓
Mock Bridge

Bridge
 ↓
Mock UXP

UXP
 ↓
Photoshop
```

가능한 테스트:

```text
Tool Registry registration

Namespace validation

Command validation

Bridge request / response

Timeout handling

Invalid command handling

Permission checks

Extension loading

Extension unload
```

테스트를 통과시키기 위해 기존 테스트를 제거하거나 완화하지 않는다.

---

# 31. Logging

모든 주요 요청에는 correlation ID를 사용한다.

예:

```text
MCP Request

↓

Tool Call

↓

Command

↓

Bridge Request

↓

UXP Command
```

동일한 ID로 추적할 수 있어야 한다.

로그 예:

```text
[req-4819]
MCP tool photoshop.layer.duplicate

[req-4819]
Command LAYER_DUPLICATE

[req-4819]
Bridge send

[req-4819]
UXP success
```

---

# 32. Error Model

공통 오류 구조를 사용한다.

```typescript
interface PhotoshopMcpError {
  code: string;

  message: string;

  details?: unknown;

  recoverable?: boolean;
}
```

예:

```text
PHOTOSHOP_NOT_CONNECTED

DOCUMENT_NOT_FOUND

LAYER_NOT_FOUND

INVALID_PARAMETER

COMMAND_NOT_SUPPORTED

EXTENSION_LOAD_FAILED

PERMISSION_DENIED

COMMAND_TIMEOUT
```

---

# 33. Non-Goals

초기 Photoshop MCP Server의 목표가 아닌 것:

```text
Photoshop 전체 API 완전 지원

사용자가 입력한 임의 JavaScript 실행

임의 batchPlay 실행

모든 Photoshop Action 자동 변환

MilkyScapeTools 구현

AI 이미지 분석

자동 보정 판단

완전 자율형 Photoshop Agent
```

이 기능들은 Core가 안정된 이후 별도 단계에서 검토한다.

---

# 34. Architectural Rule Summary

가장 중요한 규칙은 다음과 같다.

```text
LLM
 ↓
MCP Tool
 ↓
Tool Handler
 ↓
Command Engine
 ↓
Photoshop Bridge
 ↓
UXP Command Dispatcher
 ↓
Photoshop
```

그리고 Extension의 경우:

```text
LLM
 ↓
Extension MCP Tool
 ↓
Extension Workflow
 ↓
Command Engine
 ↓
Photoshop Bridge
 ↓
Photoshop
```

MCP와 Photoshop 구현 사이에는 항상 Command Engine이 존재한다.

---

# 35. Core vs Extension

최종적으로 다음 기준을 사용한다.

### Core

질문:

> Photoshop 자체의 일반 기능인가?

YES라면 Core 후보이다.

예:

```text
Create Layer
Curves
Mask
Selection
Export
```

### Extension

질문:

> 특정 사진 종류나 작업 목적에 특화된 기능인가?

YES라면 Extension이다.

예:

```text
Milky Way Enhancement

Skin Retouch

Product Background Cleanup

Landscape Sky Enhancement
```

---

# 36. Final Architecture Principle

Photoshop MCP Server는 Photoshop을 LLM에게 직접 노출하는 단순 Proxy가 아니다.

다음과 같은 계층화된 플랫폼을 목표로 한다.

```text
                 LLM
                  │
                 MCP
                  │
        ┌─────────▼──────────┐
        │ Photoshop MCP Core │
        │                    │
        │ Tool Registry      │
        │ Command Engine     │
        │ Extension Manager  │
        │ Permission System  │
        └─────────┬──────────┘
                  │
          Photoshop Bridge
                  │
             UXP Plugin
                  │
              Photoshop
                  ▲
                  │
       ┌──────────┴──────────┐
       │                     │
 MilkyScapeTools        Other Extensions
```

이를 통해 Photoshop MCP Core는 재사용 가능하고, MilkyScapeTools를 포함한 다양한 Photoshop 전용 AI Workflow를 독립적인 Extension으로 개발할 수 있다.
