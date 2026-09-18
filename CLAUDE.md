# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침입니다.

작업 시작 시 반드시 `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` 를 먼저 읽습니다.

## 프로젝트 개요

PhotoshopMCP — Photoshop를 MCP(Model Context Protocol) 서버로 제어하는 모노레포.

Core는 Photoshop을 이해하고, Extension은 작업 도메인을 이해합니다. (ARCHITECTURE §1)

## 현재 상태

**Phase 5 (Extension SDK) 완료.** Core Tool 25개는 실제 Photoshop 27.8 에서 검증했다.

- 조회: `ping`, `document.get`, `layer.list`
- 레이어: create / duplicate / rename / select / set_visibility / set_opacity
- 그룹: create / move_layer · History: undo
- 조정 레이어: curves / levels / brightness_contrast
- 마스크: create / enable / disable · 선택: clear / invert
- 필터: gaussian_blur (기본 스마트 필터)
- §8.6 공백 보완: selection.set · layer.set_blend_mode · adjustment.hue_saturation · vibrance

**전부 비파괴다.** destructive 명령과 문서 저장은 Phase 9 의 Permission System 과
함께 도입한다. 저장은 UXP 샌드박스가 임의 경로 쓰기를 막아 폴더 승인·토큰 보관이
필요하고, 그것이 Permission 설계 그 자체이기 때문이다. (ROADMAP §8.5)

`batchPlay` 는 조정·마스크·선택·필터에 쓴다. DOM 에 API 가 없는 경우다.
descriptor 는 반드시 플러그인이 검증된 파라미터로 조립한다.
호출자가 descriptor 를 넘기는 통로를 만들지 않는다. (ARCHITECTURE §13, §23)

UXP 의 실기 제약은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 에 정리되어 있다.
바꾸기 전에 그 문서를 먼저 읽는다.

**Extension.** 서버는 기동 시 `extensions/` 를 한 단계 훑어 `<name>/extension.json` 을 적재한다.
`PHOTOSHOP_MCP_EXTENSIONS` 로 디렉터리를 바꾼다. Extension 은 자신의 namespace 로만 Tool 을
등록할 수 있고, Photoshop 은 Core Command 로만 건드린다. Bridge 에는 닿지 않는다.
하나가 실패해도 나머지와 서버는 계속 기동한다.

manifest 의 `permissions` 는 **선언만 받고 강제하지 않는다.** 강제는 Phase 9 다.
`ExtensionContext` 에는 대응 런타임이 있는 것만 넣는다 — `resources`(Phase 12) ·
`capabilities`(Phase 8) · `photoshop` 은 아직 없다. 동작하지 않는 껍데기를 두면
Extension 작성자가 있는 줄 알고 쓴다.

다음 작업은 **Phase 6** 다. 범위는 `docs/ROADMAP.md` 를 따른다.

알 수 없는 열거형 값은 기본값으로 덮지 않는다. `null` + 원본(`rawBitDepth` · `rawKind` ·
`rawBlendMode`)을 함께 반환한다. 이 원칙으로 실기에서 세 번 실제 버그를 잡았다.

## Phase 기준

**`docs/ROADMAP.md` 가 Phase 의 유일한 기준이다.** 번호·범위·완료 여부 모두 그 문서를 따른다.
`docs/ARCHITECTURE.md` 는 구조와 원칙을 다루며, Phase 관련 기술이 ROADMAP 과 어긋나면
ROADMAP 이 맞다. 어긋난 것을 발견하면 ARCHITECTURE 를 고친다.

완료 판단은 ROADMAP 해당 섹션의 체크박스로 한다. 체크는 실제로 검증된 항목에만 한다.

## 스택

- TypeScript 5.9 / Node 22.12+ / ESM (`module: NodeNext`)
  (런타임 자체는 Node 18+ 로 동작하지만, 개발/테스트 도구가 22.12 를 요구한다)
- npm workspaces, `tsc -b` project references
- Vitest, ESLint 10 flat config, Prettier
- `@modelcontextprotocol/sdk` + zod

## 의존 방향

단방향만 허용합니다. 역방향 import 를 추가하지 않습니다.

```text
mcp-server                     실행 진입점 (bin)
   ↓
mcp-core                       MCP 서버 · Core 조립
   ↓
photoshop-tools                Core Tool / Command 정의
   ↓
command-engine                 Command Registry · Engine
   ↓
photoshop-bridge  contracts    Bridge 인터페이스 · 프로토콜 타입 · 에러 모델 · Tool 계약
   ↑
photoshop-uxp                  Photoshop 내부 실행 Agent (contracts 타입만 참조)
```

별도 계통:

```text
extensions
   ↓
extension-sdk
   ↓
Core public API                (photoshop-tools + command-engine + photoshop-bridge contracts)
```

`extension-sdk` 는 Core Command **이름 상수**를 재노출한다. Command 핸들러 · `CommandRegistry` ·
`ToolRegistry` · `PhotoshopBridge` 는 노출하지 않는다. Extension 은 Core Command 를 호출할 수
있을 뿐 Core 의 구성을 바꿀 수 없다.

규칙:

1. **Core → Extension 의존 금지.** Extension → Core public API(`extension-sdk`) 방향만 허용한다.
2. `photoshop-bridge` 는 최하위 **contracts** 계층이다. 모든 계층이 여기에만 직접 의존할 수 있다.
   `ToolDefinition` · `ToolRegistry` 도 여기에 둔다. MCP 서버 구현과 Tool 정의가 서로를 참조하지
   않게 하기 위함이다.
3. MCP / Tool 계층은 Photoshop Bridge 를 직접 호출하지 않고 **반드시 Command Engine 을 거친다.**
   (ARCHITECTURE §34)
4. Command Engine 은 Photoshop Bridge **abstraction 까지만** 의존한다.
   전송 방식이나 UXP 구현을 알지 못한다.
5. `mcp-core` 는 라이브러리이며 실행 진입점을 갖지 않는다. `bin` 은 `mcp-server` 에만 있다.
6. `photoshop-uxp` 는 contracts 를 **타입으로만** 참조한다. 컴파일 결과에 npm 의존이 남지
   않으므로 번들러가 필요 없다. MCP 로직을 넣지 않는다. (ARCHITECTURE §11)
7. Extension 은 `photoshop.*` namespace 에 Tool 을 등록할 수 없다.

## 디렉터리 규칙

- `packages/*` — 각자 독립된 package.json 과 tsconfig.json 을 가진다.
- `photoshop-uxp/` — Photoshop 내부에서 실행되는 UXP 플러그인. **CommonJS 로 컴파일한다**
  (UXP 가 `require("photoshop")` 를 쓴다). Node API 사용 불가 — tsconfig 에 `types: []` 로 차단.
- `extensions/*` — `extension-sdk` 기반 확장. Core 내부 모듈을 직접 import 하지 않는다.
- `tests/` — 테스트는 소스 옆이 아니라 여기에 모은다.
- `docs/` — 설계 문서. 한글로 작성한다. Prettier 대상에서 제외되어 있다(`.prettierignore`).

빈 디렉터리(`validation/`, `resources/`)는 이후 Phase 의 자리 표시이며 `.gitkeep` 만 있습니다.

## 안전 규칙 (ARCHITECTURE §23)

1. LLM 이 임의의 JavaScript 를 Photoshop 에서 실행할 수 없다.
2. LLM 이 임의의 `batchPlay` descriptor 를 실행할 수 없다.
3. 모든 Photoshop 수정은 등록된 Command 를 통해서만 실행한다.
4. destructive 작업은 명시적으로 분류한다.

## 작업 규칙

- 문서와 주석은 한글로 작성한다.
- 현재 Phase 만 구현한다. 이후 Phase 기능을 선행 구현하지 않는다.
- 작업 종료 시 순서: Build → Test → 실패 수정 → 변경 파일 검토 → ROADMAP 체크박스 → 관련 문서.
- 테스트를 통과시키기 위해 기존 테스트를 제거하거나 완화하지 않는다.
- `stdout` 은 MCP stdio 전송이 점유한다. 로그는 반드시 `stderr` 로 출력한다.

## 명령

```bash
npm install

npm run dev          # 빌드 없이 src 를 tsx 로 실행 (개발)
npm run dev:watch    # 변경 시 재시작

npm run build        # tsc -b
npm start            # 빌드된 dist 를 bin launcher 로 실행 (프로덕션)

npm test             # vitest run
npm run lint
npm run check        # lint + build + test
```

`npm start` 는 `dist/` 를 참조합니다. 빌드 없이 실행하면 안내 메시지와 함께 종료 코드 1 로
끝나며, 이는 의도된 동작입니다. 자동 빌드를 걸지 않습니다. 개발 중에는 `npm run dev` 를 사용합니다.

환경 변수:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PHOTOSHOP_MCP_BRIDGE` | `uxp` | `uxp` 또는 `mock` |
| `PHOTOSHOP_MCP_PORT` | `8765` | Bridge WebSocket 포트 |

Photoshop 없이 돌릴 때는 `PHOTOSHOP_MCP_BRIDGE=mock` 을 사용합니다.

### mcp-server 역할 경계

```text
bin/photoshop-mcp.js   최소 CLI launcher. 컴파일 안 함. shebang 포함.
                       비즈니스 로직 · Tool 등록 · Command Engine 구성 금지.
src/index.ts           public library API
src/start.ts           조립 + 기동. 로그 · process 조작 금지.
src/run.ts             CLI bootstrap. 로그 · 시그널 · 종료 코드.
```

각 패키지 `package.json` 의 `exports` 에는 `development` 조건이 있어 `--conditions development`
로 실행하면 `dist` 대신 `src` 를 해석합니다. `tsc` 는 이 조건을 무시하고 `types` 를 사용합니다.
