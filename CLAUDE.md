# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침입니다.

작업 시작 시 반드시 `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` 를 먼저 읽습니다.

## 프로젝트 개요

PhotoshopMCP — Photoshop를 MCP(Model Context Protocol) 서버로 제어하는 모노레포.

Core는 Photoshop을 이해하고, Extension은 작업 도메인을 이해합니다. (ARCHITECTURE §1)

## 현재 상태

**Phase 2 (Photoshop Bridge) 완료.** 실제 Photoshop 27.8 에서 검증했다.

- Tool: `photoshop.ping`, `photoshop.document.get`, `photoshop.layer.list`
- Bridge: `MockPhotoshopBridge` (Photoshop 불필요) / `UXPPhotoshopBridge` (WebSocket + UXP)
- 알 수 없는 열거형 값은 기본값으로 덮지 않는다. `null` + 원본을 함께 반환한다.

UXP 의 실기 제약은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 에 정리되어 있다.
특히 `manifestVersion` 은 **4 여야 하고**, `executeAsModal` 안에서 직접 throw 하면
오류 코드를 잃는다. 바꾸기 전에 그 문서를 먼저 읽는다.

다음 작업은 **Phase 3 (Basic Photoshop Editing)** 이다. Phase 3 이전 기능을 선행 구현하지 않는다.

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
Core public API                (command-engine + photoshop-bridge contracts)
```

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
- `extensions/*` — `extension-sdk` 기반 확장. Core 내부 모듈을 직접 import 하지 않는다. (Phase 5)
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
