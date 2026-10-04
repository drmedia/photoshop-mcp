# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침입니다.

작업 시작 시 `CLAUDE.md` 와 `docs/ARCHITECTURE.md` 를 읽습니다. **`docs/ROADMAP.md` 는 통째로 읽지
않습니다**(약 56만 바이트) — 관련 § 를 검색해 그 부분만 읽습니다.

## 프로젝트 개요

PhotoshopMCP — Photoshop를 MCP(Model Context Protocol) 서버로 제어하는 모노레포.

Core는 Photoshop을 이해하고, Extension은 작업 도메인을 이해합니다. (ARCHITECTURE §1)

## 현재 상태

**Phase 13 까지 완료. 남은 것은 Phase 14 (Distribution) 하나다.**

Core Tool **176개** · Resource 6개. Extension 4개(`example` 2 · `graxpert` 2 ·
`rcastro` 3 · `starnet` 1).

Tool 개수를 셀 때 주의한다. `photoshop.diagnostics` 의 `registry.tools` 는 Extension
Tool 까지 더한 수다(Core 176 + Extension 8 = 184). **Core 목록의 기준은
`docs/CORE_API.md` §4** 이고 `tests/core-api-doc.test.ts` 가 레지스트리와 대조한다.

Tool 별 사용법과 함정(176개 전체)은 `docs/FIELD_NOTES.md` 의 「현재 상태」 절에 있다.

## 현장 노트 색인 (`docs/FIELD_NOTES.md`)

실기에서 배운 것을 옮겨 둔 문서다(약 2.1만 토큰). **건드릴 영역의 절만 찾아 읽는다.**
절 제목으로 검색한다.

| 건드릴 때 | 절 제목 |
|---|---|
| Tool 의 동작 · 함정 전반 | 현재 상태 |
| 보정 지침(`instructions` · `retouch` 프롬프트) | 보정 절차 안내 |
| 문서·레이어·선택·창 캡처, 측정 | 캡처 · 창 캡처 · 측정 |
| 먼지 제거 · 닷징/버닝 · 마스크 칠하기 · 마스크 · 국소 보정 | 결함 제거 · 닷징 · 버닝 · 마스크에 칠하기 · 마스크는 밝기가 아니라 형태로 · 국소 보정은 별도 레이어에 |
| 조정 레이어 | 조정 레이어는 `luminosity` 로 · `presetKind` · 조정 레이어의 종류 · `luminosity` 에는 조건이 있다 |
| Camera Raw (슬라이더 · 곡선 · 국소 보정 · 샤픈) | Camera Raw |
| 액션 | 액션 |
| GraXpert · 외부 처리기 · Capability | GraXpert 는 CLI 로 부른다 · Capability |
| 텍스트 | 텍스트 |
| 레이어 순서 · 그룹 · 마스크 그라디언트 · 기울기 · 회전 | 레이어 순서 · 그룹은 어디에 생기는가 · 마스크 그라디언트 · 기울기 측정 · 회전 |
| 파일 저장 · 열기 · 평탄화 · 닫기 · 배경 레이어 · `place` | 파일 저장 |
| 긴 작업 | Job |
| Extension 등록 · 해제 · `tools/list_changed` | Extension 은 기동 뒤에도 붙는다 |
| Resource | Resource |
| Bridge 포트 | Bridge 포트는 범위다 |
| Tool 프로필 · 목록에 없는 Tool · 감춘 Tool 진단 | Tool 프로필 |
| Ollama 로 Claude Code 를 쓸 때 (500 · 컨텍스트 · 입력 토큰 재기) | Ollama + Claude Code |
| 안 될 때 · 진단 · 임시 파일 · 로그 | 진단과 임시 파일 |
| Photoshop 알림 · descriptor 캡처 | Event |
| 워크플로 | Workflow |

## 자주 밟는 함정

각 줄의 근거와 사례는 `docs/FIELD_NOTES.md` 와 ROADMAP 에 있다.

- **오류 없이 아무 일도 안 하는 경로가 이 프로젝트의 주된 버그 유형이다.** 쓴 값을 읽어 확인하고
  (`applied`) "했다" 와 "됐다" 를 가른다. 정수가 무시되는 Camera Raw 키, 배경 레이어 편집,
  `SampleType` 빠진 국소 마스크가 그 예다.
- **API 를 짐작하지 않는다.** DOM 에 있는지 재 보고, Adobe UXP 레퍼런스를 먼저 본다(예제 코드가
  서명보다 많이 말한다). batchPlay descriptor 는 알림 `["all"]` 로 캡처한다 — 이벤트 버퍼는
  MCP 서버 프로세스에 있어서 서버를 띄워 둔 채로 사람이 메뉴를 실행해야 한다. 읽기(`get`)는
  캡처 없이 직접 물어 알아낸다. "공백이다" 라고 적기 전에 있는 것부터 확인한다.
- **Photoshop 은 정수를 정수로 돌려주지 않는다**(220 → `220.00000208`). 되돌리기용 값은 반올림한다.
- **대화상자가 뜨면 플러그인이 멈추고** 호출자는 타임아웃만 본다(RAW 열기 · 액션 · 저장 여부를
  묻는 닫기). 대화상자가 안 뜨는 것을 실기에서 확인하기 전에는 열 수 있는 형식을 늘리지 않는다.
  막힌 원인은 `photoshop.window.capture` 로 밖에서 본다.
- **`npm run check` 는 실기 반영 확인이 아니다.** `dist` 를 다시 만들어도 Photoshop 은
  `uxp plugin reload` 전까지 옛 사본을 돈다. 서로 달라야 할 두 입력이 같은 값을 내면 빌드를 의심한다.
- **새 Command 는 만드는 것만이 아니라 고치는 · 되돌리는 경로까지 확인한다.** 화면이 맞다고 다음
  작업이 되는 것은 아니다.
- **Mock 은 현실과 같게 흉내 내거나, 실패하거나, `null` 이어야 한다.** 짐작한 값은 거짓으로 굳는다.
- **한 클라이언트에 uxp 서버와 mock 서버를 함께 붙이지 않는다.** Core Tool 176개가 양쪽에
  똑같이 있어 클라이언트가 어느 쪽으로 보낼지 알 수 없고, mock 은 가짜 문서에 성공을 돌려줘
  **했다고 말하고 아무것도 안 하는** 상태가 된다. `.mcp.json` 에도 mock 서버를 두지 않는다 —
  껐다가도 되살아난다. mock 은 `PHOTOSHOP_MCP_BRIDGE=mock npm run dev` 로 따로 띄운다.
- **무언가 안 되면 `photoshop.diagnostics` 를 먼저 부른다.** 클라이언트가 붙기 전에는
  `npx photoshop-mcp doctor`. 서버는 8765 부터 연속 10개 중 첫 빈 포트를 연다.
- **MCP 기본 요청 타임아웃은 60초다.** 오래 걸리는 Tool 은 `context.jobs.start()` 로 jobId 를
  즉시 반환한다. 긴 Tool 은 `tools.invoke` 가 아니라 실제 MCP 클라이언트(`client.callTool`)로 확인한다.
- **`stdout` 은 MCP stdio 전송이 점유한다.** 로그는 `stderr` 로만 낸다.
- **Copilot 등 다른 클라이언트에서 쓸 때는 저장소가 아닌 폴더를 열고 서버를 사용자 수준
  설정에 절대 경로로 둔다.** 이 파일이 매 요청에 실린다(ROADMAP §102 측정). 그때는
  `PHOTOSHOP_MCP_EXTENSIONS` · `PHOTOSHOP_MCP_CAPABILITIES` 도 절대 경로로 준다.


## Permission (ARCHITECTURE §22)

레벨은 `read` · `edit` · `external` · `destructive` 네 가지다. Tool 과 Command 모두
**필수** 필드로 선언한다. 선택 필드로 두면 새로 추가한 것이 조용히 관대한 값을 갖는다.

**강제 지점은 Command Engine 이다.** Extension 은 Tool 을 거치지 않고 Command 를 직접
호출한다(ARCHITECTURE §3.2). Tool 의 레벨은 `tools/list` 메타데이터이자 빠른 실패용이다.

기본 허용은 `read` · `edit` 뿐이다. `PHOTOSHOP_MCP_ALLOW` 로 바꾸며, 값을 주면 그것이
**전체 목록**이다 — 기본값에 더하지 않는다. `read` 만 주면 읽기 전용 서버가 된다.

대화형 승인은 하지 않는다. 서버가 stdio 를 전송에 쓰므로 프롬프트를 띄울 수 없고,
elicitation 은 클라이언트가 무시하면 보장이 사라진다. 대화형 승인은 MCP 클라이언트의 역할이다.

Extension 의 manifest `permissions` 는 **강제된다.** 선언 밖의 Tool 은 등록 자체가
막히고, Command 호출에도 같은 상한이 걸린다. 선언하지 않으면 아무 권한도 없다.

## Phase 기준

**`docs/ROADMAP.md` 가 Phase 의 유일한 기준이다.** 번호·범위·완료 여부 모두 그 문서를 따른다.
`docs/ARCHITECTURE.md` 는 구조와 원칙을 다루며, Phase 관련 기술이 ROADMAP 과 어긋나면
ROADMAP 이 맞다. 어긋난 것을 발견하면 ARCHITECTURE 를 고친다.

완료 판단은 ROADMAP 해당 섹션의 체크박스로 한다. 체크는 실제로 검증된 항목에만 한다.

**API 목록·Permission·이름의 기준은 `docs/CORE_API.md` 다.** Phase 열을 두지 않는다 —
예전에 두었다가 ROADMAP 과 같은 낱말이 다른 뜻을 갖게 되어 둘 다 믿을 수 없게 되었다.
Tool 을 추가·삭제하거나 Permission 을 바꾸면 그 문서의 §4 를 함께 고친다.
`tests/core-api-doc.test.ts` 가 문서를 읽어 레지스트리와 대조하므로 빠뜨리면 테스트가 깨진다.

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
extension-api
   ↓
Core public API                (photoshop-tools + command-engine + photoshop-bridge contracts)
```

`extension-api` 는 Core Command **이름 상수**를 재노출한다. Command 핸들러 · `CommandRegistry` ·
`ToolRegistry` · `PhotoshopBridge` 는 노출하지 않는다. Extension 은 Core Command 를 호출할 수
있을 뿐 Core 의 구성을 바꿀 수 없다.

규칙:

1. **Core → Extension 의존 금지.** Extension → Core public API(`extension-api`) 방향만 허용한다.
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

   값으로 import 하면 `require("@photoshop-mcp/...")` 가 산출물에 남고, UXP 샌드박스에는
   `node_modules` 가 없어 **플러그인 전체가 로드에 실패한다.** 패널이 빈 채로 열리고
   Bridge 도 연결되지 않는다. 타입 검사와 빌드는 통과하므로 실기에서만 드러난다.
   `tests/uxp-bundle.test.ts` 가 산출물을 훑어 막는다.

   Plugin 과 서버가 같은 계산을 해야 하면 **서버에서 끝내고 결과를 보낸다.**
   Plugin 은 실행 Agent 다.
7. Extension 은 `photoshop.*` namespace 에 Tool 을 등록할 수 없다.

## 디렉터리 규칙

- `packages/*` — 각자 독립된 package.json 과 tsconfig.json 을 가진다.
- `photoshop-uxp/` — Photoshop 내부에서 실행되는 UXP 플러그인. **CommonJS 로 컴파일한다**
  (UXP 가 `require("photoshop")` 를 쓴다). Node API 사용 불가 — tsconfig 에 `types: []` 로 차단.
- `extensions/*` — `extension-api` 기반 확장. Core 내부 모듈을 직접 import 하지 않는다.
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
- **README 는 두 벌이다.** `README.md`(영어)가 바깥에서 보이는 첫 화면이고
  `README_KO.md`(한글)가 자세한 쪽이다. **한쪽만 고치면 갈라진다** — 사실이
  바뀌면 둘 다 본다. 영어본은 요약이라 세부는 한글본과 `docs/` 로 보낸다.
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

npx photoshop-mcp doctor   # 무엇이 막혀 있는지 (빌드 필요)
npx photoshop-mcp init     # capabilities.json 을 찾아서 만든다
npm run lint
npm run typecheck:tests   # tests/ 타입체크 (tsc -b 대상이 아니다)
npm run check        # format + lint + build + typecheck:tests + test
npm run release:build    # 배포할 여섯 패키지의 dist 를 지우고 처음부터 빌드 (낡은 산출물 제거)
npm run release:check    # 배포 직전 점검: 낡은 파일 · 불필요한 파일. publish 의 prepublishOnly 도 건다
npm run release:verify   # 여섯 패키지를 pack 해 빈 폴더에 설치하고 MCP 핸드셰이크 (publish 없이). -- --keep <폴더> 로 설치를 남긴다
```

`tests/` 는 `tsc -b` 의 project reference 에 들어 있지 않다. 테스트가 패키지 **소스**를
참조하는데(vitest alias 와 같은 해석), composite 프로젝트로 참조하면 `dist` 의 `.d.ts` 를
보게 되어 vitest 와 어긋나기 때문이다. 대신 `tsconfig.test.json` 으로 따로 검사한다.
이것이 없던 동안 테스트 시그니처 오류가 컴파일이 아니라 런타임에서 드러났다.

`npm start` 는 `dist/` 를 참조합니다. 빌드 없이 실행하면 안내 메시지와 함께 종료 코드 1 로
끝나며, 이는 의도된 동작입니다. 자동 빌드를 걸지 않습니다. 개발 중에는 `npm run dev` 를 사용합니다.

환경 변수:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PHOTOSHOP_MCP_BRIDGE` | `uxp` | `uxp` 또는 `mock` |
| `PHOTOSHOP_MCP_PORT` | (생략=8765 부터 첫 빈 포트) | Bridge 포트를 **고정**. 8765~8774 안이어야 Plugin 이 찾는다 |
| `PHOTOSHOP_MCP_EXTENSIONS` | `<cwd>/extensions` | Extension 디렉터리 |
| `PHOTOSHOP_MCP_EXTENSIONS_ENABLED` | (생략=전부) | 적재할 **namespace**. `none` 이면 하나도 안 함 |
| `PHOTOSHOP_MCP_ALLOW` | `read,edit` | 허용 권한. `all` · `none` 도 쓸 수 있다 |
| `PHOTOSHOP_MCP_PROFILE` | `full` | `tools/list` 에 보일 Tool. `full` · `retouch`(보정에 쓰는 것만) · `readonly`(read 만). **목록만 줄이고 권한은 그대로다** (ROADMAP §102) |
| `PHOTOSHOP_MCP_CAPABILITIES` | `<cwd>/capabilities.json` | 외부 처리기 설정 |
| `PHOTOSHOP_MCP_WORKFLOWS` | `<cwd>/workflows.json` | 워크플로 설정 |

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
