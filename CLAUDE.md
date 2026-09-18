# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침입니다.

작업 시작 시 반드시 `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` 를 먼저 읽습니다.

## 프로젝트 개요

PhotoshopMCP — Photoshop를 MCP(Model Context Protocol) 서버로 제어하는 모노레포.

Core는 Photoshop을 이해하고, Extension은 작업 도메인을 이해합니다. (ARCHITECTURE §1)

## 현재 상태

**Phase 13 까지 완료. 남은 것은 Phase 14 (Distribution) 하나다.**

Core Tool **40개** · Resource 6개. Extension 예제 2개(`example` 2 · `milkyscape` 5).

Tool 개수를 셀 때 주의한다. `photoshop.diagnostics` 의 `registry.tools` 는 Extension
Tool 까지 더한 수다(지금 47). 한동안 이 값을 Core 개수로 옮겨 적어 "Core Tool 46개"
라는 틀린 문장이 문서 세 곳에 남아 있었다. **Core 목록의 기준은 `docs/CORE_API.md` §4** 이고
`tests/core-api-doc.test.ts` 가 레지스트리와 대조한다.

- 조회: `ping`, `document.get`, `layer.list`
- 레이어: create / duplicate / rename / select / set_visibility / set_opacity
- 그룹: create / move_layer · History: undo
- 조정 레이어: curves / levels / brightness_contrast
- 마스크: create / enable / disable · 선택: clear / invert
- 필터: gaussian_blur (기본 스마트 필터)
- §8.6 공백 보완: selection.set · layer.set_blend_mode · adjustment.hue_saturation · vibrance

- 파일 저장: `workspace.status` · `document.save_as` · `document.export` · `document.save`

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

## 파일 저장 (ROADMAP §8.5)

레이어 편집은 전부 비파괴다. 파일 쓰기만 `external` · `destructive` 다.

저장 폴더는 **사용자가 플러그인 패널 버튼으로 승인한다.** `getFolder()` 가 사용자
제스처를 요구해서 서버가 대신할 수 없다. 제약이자 안전장치다 — LLM 은 폴더를 고를 수 없고
파일 이름만 준다. 경로 구분자와 `..` 는 스키마가 거부한다.

토큰은 `createPersistentToken` 으로 만들어 플러그인 `localStorage` 에 둔다.
저장은 batchPlay 가 아니라 DOM 의 `document.saveAs.*` 를 쓴다 — 이 API 가 경로 문자열이
아니라 File entry 를 받기 때문에 폴더 제한이 그대로 유지된다.

`save_as` 와 `export` 는 **덮어쓰지 않는다.** 그래서 `external` 로 분류할 수 있다.
덮어쓰기는 `save` 하나로 모아 `destructive` 로 둔다.

형식: `save_as` 는 psd · psb (레이어 유지), `export` 는 png · jpg · tiff (평탄화).

**TIFF 는 batchPlay 경로다.** UXP DOM 에 `saveAs.tif` 가 없다. 외부 천체사진 처리기가
16비트 TIFF 를 교환 형식으로 쓰므로 필요하다 — PNG 8비트로는 계조가 무너진다.
**복제본**을 만들어 평탄화·심도 변환 후 저장하고 닫는다. 원본을 건드리지 않기 위함이다.
`bitDepth` 는 8 또는 16, 생략하면 문서 심도를 따른다. 결과의 `bitDepth` 는 요청값이
아니라 **실제값**이다.

`layer.delete` · `document.flatten` · `document.close` 는 분류 체계만 섰고 구현은 없다.

## Capability (ARCHITECTURE §19, ROADMAP §12)

Extension 은 특정 프로그램이 아니라 기능을 요청한다 — `ctx.capabilities.execute("gradientRemoval", …)`.

안전 규칙은 batchPlay 와 같다. **임의의 프로그램과 인자를 실행할 수 없다.**
실행 파일은 `capabilities.json` 에서만 오고(절대 경로), argv 는 선언된 파라미터로만
조립되며, `shell: false` 로 돌린다. 입출력은 승인된 작업 폴더 안의 파일 이름뿐이다.

Tool 은 `photoshop.capability.list` (조회) 하나만 노출한다. 실행 Tool 은 만들지 않는다 —
Capability 실행은 전체 흐름의 가운데 토막이고, 그 흐름을 아는 것은 Extension 이다.

출력이 여럿인 처리기가 있다. StarNet2 는 별 제거본과 별 이미지를 함께 만든다.
`ProviderConfig.outputs` 로 선언하고 템플릿에서 `{{output.stars}}` 로 참조한다.
선언·요청·실제 생성 세 가지가 모두 맞는지 검사한다.

**요청한 이름·형식으로 만들어 주지 않는 처리기도 있다.** GraXpert 3.0.2 는 `-output
out.tif` 를 줘도 `out.tif.fits` 를 만들고, 출력 형식 옵션이 없어 우회할 수 없다.
`outputSuffix` · `convert` 로 **설정에 선언한다.** Registry 가 실제 파일을 찾아
변환하고 중간 파일을 지운다. Command 와 Extension 은 요청한 파일이 나온다고만 알면
된다 — 처리기의 버릇을 도메인 코드가 알면 처리기를 바꿀 때 도메인 코드가 따라 바뀐다.

FITS → TIFF 변환에서 조심할 것은 **정규화**다. min/max 로 무조건 늘리면 그래디언트를
제거한 결과의 계조가 조용히 바뀐다. 값 범위로 의도한 인코딩을 추정만 하고 늘리지 않는다.
(`packages/mcp-core/src/capabilities/fits.ts`)

동기 실행만 한다. 긴 작업의 진행률·취소는 Job System(Phase 10) 이 맡는다.

`photoshop.layer.place` 가 돌아오는 길이다. 승인된 폴더의 파일을 스마트 오브젝트로
가져온다. 권한은 `external` — `export` 가 쓰기로 넘듯 읽기로 경계를 넘는다.

실기에서 확인한 `place` 동작: 문서 맨 위가 아니라 **활성 레이어 바로 위**에 놓이고,
활성 레이어가 그룹 안이면 같은 그룹으로 들어가며, **opacity 를 물려받는다.**
셋 다 처음 가정과 달랐다. 위치가 중요하면 먼저 `layer.select` 한다.

`batchPlay` 는 조정·마스크·선택·필터에 쓴다. DOM 에 API 가 없는 경우다.
descriptor 는 반드시 플러그인이 검증된 파라미터로 조립한다.
호출자가 descriptor 를 넘기는 통로를 만들지 않는다. (ARCHITECTURE §13, §23)

UXP 의 실기 제약은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 에 정리되어 있다.
바꾸기 전에 그 문서를 먼저 읽는다.

**Extension.** 서버는 기동 시 `extensions/` 를 한 단계 훑어 `<name>/extension.json` 을 적재한다.
`PHOTOSHOP_MCP_EXTENSIONS` 로 디렉터리를 바꾼다. Extension 은 자신의 namespace 로만 Tool 을
등록할 수 있고, Photoshop 은 Core Command 로만 건드린다. Bridge 에는 닿지 않는다.
하나가 실패해도 나머지와 서버는 계속 기동한다.

`ExtensionContext` 에는 **대응 런타임이 있는 것만 넣는다.** 동작하지 않는 껍데기를 두면
Extension 작성자가 있는 줄 알고 쓴다. 그래서 `capabilities`(Phase 8) · `jobs`(Phase 10) ·
`events`(Phase 11) · `resources`(Phase 12) 는 각 런타임이 생긴 뒤에 추가했다.

`photoshop` 은 아직 없다. `PhotoshopService` 가 정의된 적이 없다.

왕복이 실기에서 검증되었다 — 4032×6048 16비트 문서로
`export(tiff) → StarNet2(68초) → place ×2` 를 통과시켰고 16비트가 전 구간 유지된다.

GraXpert 도 실기에서 검증했다 — 같은 문서로 `export(tiff) → GraXpert(7초, GPU) →
FITS → TIFF 변환 → place` 를 통과시켰다. 변환기가 `0..1 float` 로 판정해 늘리지
않았고 표본 픽셀 범위는 7844–25656 이었다.

**Phase 6 첫 슬라이스 완료.** `extensions/milkyscape` 에 별 워크플로 Tool 4개가 있고
실기 검증했다 — StarNet2 67초, BXT 10초.

`create_sky_mask` · `create_foreground_mask` 는 **범위에서 뺐다.** 기존 MilkyScape 는
하늘 마스크를 만들지 않고 사용자가 만든 것을 소비한다. 짐작으로 알고리즘을 만들지 않는다.

Extension 은 워크스페이스 안에 있어야 한다. 밖에 두면 `@photoshop-mcp/extension-sdk`
해석이 실패한다.

**MilkyScape 기능을 더 옮기지 않는다.** 이 프로젝트의 목적은 PhotoshopMCP 자체이고
MilkyScape 는 아키텍처 검증 소재다. 기존 CEP 패널은 사람이 슬라이더를 보며 조절하는
도구로 그대로 둔다 — 미리보기 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다.

Extension 은 지금 수준으로 충분하다. 이후 작업은 **Core · Job · Workflow** 쪽이다.

## Job (ARCHITECTURE §25, ROADMAP §14)

**MCP 기본 요청 타임아웃은 60초다.** 외부 처리기는 그보다 오래 걸린다 — 실기에서
StarNet2 가 67초 걸려 실제 클라이언트로 부르니 `-32001 Request timed out` 이 났다.

오래 걸리는 Tool 은 `context.jobs.start()` 로 등록하고 **즉시 jobId 를 반환한다.**
짧게 끝나도 마찬가지다 — 반환 타입이 상황에 따라 달라지면 호출자가 매번 판단해야 한다.

`photoshop.job.status` · `.list` · `.cancel` 은 전부 즉시 반환한다. 완료를 기다리면
타임아웃 문제가 그대로 돌아온다.

취소는 `AbortSignal` 이 자식 프로세스까지 내려가 `SIGKILL` 한다. 신호만 받고 계속
돌면 취소가 거짓말이다. `stop()` 은 진행 중인 Job 을 모두 취소한다 — 그러지 않으면
외부 프로세스가 서버보다 오래 산다.

Job 은 메모리에만 있다. 서버를 다시 띄우면 사라진다.

**긴 Tool 을 새로 만들 때는 반드시 실제 MCP 클라이언트(`client.callTool`)로 확인한다.**
`tools.invoke` 로 서버 내부를 직접 부르면 타임아웃을 놓친다.

## Resource (ROADMAP §16)

Tool 은 **행동**이고 Resource 는 **맥락**이다. `photoshop://layers` 등 6개를 노출한다.
읽을 때마다 실제 상태를 조회하며 캐시하지 않는다.

**`notifications/resources/updated` 가 진짜 push 채널이다.** Phase 11 에서 "MCP 에
push 가 없다" 고 적은 것은 *임의 이벤트*에 한한 이야기였다. 문서를 바꾸는 Command 가
끝나면 관련 리소스가 낡았다고 알린다 — Photoshop 알림이 안 되는 환경에서도
**우리가 만든 변경**은 알릴 수 있다.

Extension 은 자기 namespace 의 URI 만 등록한다 (`milky://state`). unload 하면
함께 사라진다.

## 진단과 임시 파일 (ROADMAP §17)

**무언가 안 되면 `photoshop.diagnostics` 를 먼저 부른다.** 상태와 함께 막힌 이유·고치는
방법을 준다.

외부 처리기는 한 번 돌 때마다 140MB 짜리 TIFF 를 여러 개 만든다. 실기 검증만으로
1.7GB 가 쌓인 적이 있다. `photoshop.workspace.usage` 로 확인하고
`photoshop.workspace.delete` 로 **이름을 명시해** 지운다. 패턴은 받지 않는다 —
승인된 폴더는 사용자의 폴더다.

로그는 기본적으로 조용하다. `PHOTOSHOP_MCP_DEBUG=1` 로 correlation ID 추적을 켠다.
**실패는 디버그가 아니어도 남긴다** — 조용히 실패하면 원인을 못 찾는다.

## Event (ROADMAP §15)

**Command 수명 이벤트는 동작한다** — `command.started` · `command.completed` ·
`command.failed`. Photoshop 연결이 없어도 난다.

**Photoshop 알림은 이 환경에서 동작하지 않는다.** Photoshop 27.8 / manifestVersion 4
에서 API 는 있고 등록도 성공하는데(문자열·객체 양쪽) 알림이 하나도 오지 않는다.
플러그인 자신의 동작과 사용자 편집 모두 확인했다. 원인을 찾지 못했고 추측으로
코드를 더 넣지 않았다.

배선은 남겨두되 `photoshop.notifications.registered` 가 `delivery: "unverified"` 를
담아 동작하는 것처럼 읽히지 않게 했다. **`command.*` 만 신뢰할 수 있다.**

LLM 은 구독하지 않고 `photoshop.event.recent` 로 조회한다. MCP 에 임의 이벤트 통로가
없기 때문이다. Extension 은 `context.events.on()` 으로 구독하며 unload 때 자동 해제된다.

이름을 짐작하지 않는다. 해석하지 못한 알림은 `photoshop.unknown` 으로 두고 원본을
보존한다.

## Workflow (ROADMAP §11)

`workflows.json` 에 Tool 순서를 선언한다. Extension 을 만들려면 TypeScript 를 쓰고
빌드해야 하는데, 순서만 바꾸고 싶을 때는 과하다.

**Extension 이 이미 워크플로다.** `milky.remove_stars` 가 5단계를 한 Job 으로 묶는다.
이 계층은 코드 없이 정의하는 경우만 더한다.

값 전달은 `{{steps.0.result.layer.id}}` 형태만 허용한다. 임의 식을 평가하지 않는다 —
그 순간 워크플로가 실행 엔진이 되고 §23 이 무너진다. 값 전체가 참조면 타입을 유지한다.

**되돌리지 않는다.** History 를 되감으면 워크플로가 도는 동안 사용자가 한 편집까지
날아간다. 무엇이 어디까지 됐는지 알려주고 판단은 사용자에게 맡긴다.

Job 을 부르는 단계는 `awaitJob: true` 를 명시한다. 알아서 기다리면 우연히 `jobId`
필드를 가진 결과까지 기다리게 된다.

알 수 없는 열거형 값은 기본값으로 덮지 않는다. `null` + 원본(`rawBitDepth` · `rawKind` ·
`rawBlendMode`)을 함께 반환한다. 이 원칙으로 실기에서 세 번 실제 버그를 잡았다.

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
npm run typecheck:tests   # tests/ 타입체크 (tsc -b 대상이 아니다)
npm run check        # format + lint + build + typecheck:tests + test
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
| `PHOTOSHOP_MCP_PORT` | `8765` | Bridge WebSocket 포트 |
| `PHOTOSHOP_MCP_EXTENSIONS` | `<cwd>/extensions` | Extension 디렉터리 |
| `PHOTOSHOP_MCP_ALLOW` | `read,edit` | 허용 권한. `all` · `none` 도 쓸 수 있다 |
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
