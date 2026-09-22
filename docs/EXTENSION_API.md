# Extension 규격

PhotoshopMCP 에 Tool 을 더하는 방법입니다.

이 문서는 **코드가 강제하는 것만** 적습니다. 계획이나 권장은 들어 있지 않습니다.
어긋난 것을 발견하면 코드가 맞습니다.

참조 구현은 두 개입니다.

| | 범위 |
|---|---|
| `extensions/example-extension` | 최소 — Tool 2개, `read` 만 |
| `extensions/graxpert` | 실제 — 외부 프로그램 구동, 긴 작업, `external` |

---

## 1. 무엇을 만드는 것인가

**Core 는 Photoshop 을 알고, Extension 은 작업 도메인을 압니다.**

Core 에는 `photoshop.layer.create` 처럼 Photoshop 자체의 기능이 들어갑니다.
특정 프로그램·패널을 부리는 것은 Extension 입니다 — Core 에 넣으면 그것을
설치하지 않은 사람에게도 Tool 목록에 보이고, 무엇이 이 서버의 능력인지
흐려집니다.

`extensions/graxpert` 가 그 예입니다. GraXpert 패널은 Photoshop 기능이 아니라
서드파티 패널이므로, 패널의 버릇을 아는 얇은 어댑터가 Extension 으로 있습니다.

**따라서 Extension 은 보통 도구와 함께 배포됩니다.** 도구를 만든 사람이
어댑터도 같이 넣는 것이 자연스럽습니다.

---

## 2. 패키지 구조

```text
<루트>/
  extension.json      필수. 매니페스트
  package.json         type: "module"
  src/index.ts
  dist/index.js        extension.json 의 main 이 가리키는 곳
```

`extension.json` 이 루트에 없으면 서버가 조용히 건너뜁니다.

**ESM 으로 빌드합니다.** 서버가 동적 `import()` 로 적재합니다.

---

## 3. `extension.json`

스키마는 `.strict()` 입니다 — 아래에 없는 키를 넣으면 적재가 거부됩니다.

```json
{
  "id": "com.example.mytool",
  "name": "My Tool",
  "version": "0.1.0",
  "namespace": "mytool",
  "main": "dist/index.js",
  "description": "무엇을 하는지 한 줄",
  "requires": { "photoshopMcp": "^0.1.0" },
  "permissions": ["photoshop.read", "photoshop.external"]
}
```

| 키 | 필수 | 규칙 |
|---|---|---|
| `id` | O | 1–200자. 역방향 도메인 표기 권장 |
| `name` | O | 1–200자 |
| `version` | O | 1–64자. semver 권장, 강제하지 않음 |
| `namespace` | O | `^[a-z][a-z0-9-]*$`, 1–64자. `photoshop` 은 예약 |
| `main` | O | 루트 기준 상대 경로 |
| `description` | | 최대 1000자 |
| `requires.photoshopMcp` | | 아직 검증하지 않음 |
| `permissions` | | 아래 §6 |

**`namespace` 가 Tool 이름의 접두사입니다.** 디렉터리 이름이 아니라 이 값이
`photoshop.diagnostics` 와 서버 설정에 나타납니다.

---

## 4. 진입점

```ts
export function activate(context) { /* ... */ }
export function deactivate() { /* ... */ }   // 선택
```

`activate` 를 내보내지 않으면 적재가 실패합니다. `default` export 에
`activate` 를 담아도 됩니다. 둘 다 `Promise` 를 돌려줘도 되고 아니어도 됩니다.

`activate` 가 던지면 그 Extension 만 실패하고 **서버와 다른 Extension 은 계속
기동합니다.**

`deactivate` 에서는 타이머·소켓처럼 **서버가 모르는 자원**만 정리합니다.
등록한 Tool·Resource 와 구독한 이벤트는 서버가 되돌립니다.

---

## 5. Tool 등록

```ts
context.tools.register({
  name: "mytool.do_something",
  description: "LLM 이 읽는 설명. 언제 쓰는지와 실패 조건을 적는다",
  permission: "read",
  inputSchema: SomeZodSchema,
  handler: async (input, toolContext) => ({ ok: true }),
});
```

| 필드 | |
|---|---|
| `name` | **`<namespace>.` 로 시작해야 합니다.** 아니면 `EXTENSION_NAMESPACE_VIOLATION` |
| `description` | 필수 |
| `permission` | 필수. `read` · `edit` · `external` · `destructive` 중 하나 |
| `inputSchema` | `parse` 를 가진 객체. zod 를 쓰면 됩니다 |
| `handler` | `(input, toolContext) => Promise<result>` |

`permission` 은 선택 필드가 아닙니다. 기본값을 두면 새 Tool 이 조용히 관대한
값을 갖습니다.

`inputSchema` 는 `parse` 만 호출됩니다. **자기가 설치한 zod 사본으로 충분합니다** —
서버의 zod 와 같은 인스턴스일 필요가 없습니다.

`context.tools` 는 등록과 `has(name)` 만 제공합니다. 다른 Tool 을 조회·해제·호출할
수 없습니다.

### 입력 스키마는 좁게

`.strict()` 를 쓰고 범위를 제한합니다. LLM 이 호출자이므로, 스키마가 곧
사용 설명서입니다. 쓰지 않는 파라미터가 있으면 무엇이 중요한지 알 수 없습니다.

---

## 6. Permission

manifest 의 `permissions` 가 **상한입니다.**

```text
photoshop.read         조회
photoshop.edit         레이어·조정 (비파괴)
photoshop.external     파일 쓰기 · 외부 프로그램 · 화면 캡처
photoshop.destructive  덮어쓰기 · 삭제 · 평탄화
```

강제되는 지점이 둘입니다.

1. **Tool 등록** — 선언 밖의 `permission` 을 요구하면 등록이 거부됩니다.
   호출 시점에 막으면 목록에는 떠 있는데 항상 실패하는 상태가 됩니다.
2. **Command 호출 · Capability 실행** — 같은 상한이 걸립니다. Extension 은
   Tool 을 거치지 않고 Command 를 직접 부를 수 있기 때문입니다.

**`permissions` 를 생략하면 아무 권한도 없습니다.** 기본값이 없습니다.

manifest 가 선언해도 **서버 정책이 허용해야** 실제로 돕니다.
`PHOTOSHOP_MCP_ALLOW` 의 기본값은 `read,edit` 이므로, `external` 이 필요한
Extension 은 사용자가 그 값을 넣어야 합니다. 설명서에 적어 두는 것이 좋습니다.

---

## 7. Core Command 호출

Photoshop 은 Core Command 로만 건드립니다.

```ts
const document = await context.commands.execute(
  { type: "DOCUMENT_GET", params: {} },
  { requestId: toolContext.requestId },
);
```

`requestId` 를 넘기면 Tool 호출부터 Photoshop 까지 추적이 이어집니다.

**Command 의 결과 모양은 같은 이름의 Tool 과 다를 수 있습니다.**
`photoshop.layer.list` Tool 은 `{ layers }` 로 감싸지만 `LAYER_LIST` Command 는
배열을 그대로 줍니다. Core Tool 을 다시 호출하지 마십시오 — Command 가 그
아래 계층입니다.

이름 목록은 `docs/CORE_API.md` §4 에 있습니다. 저장소 안이라면
`@photoshop-mcp/extension-api` 가 상수로 내보내므로 오타가 컴파일에 잡힙니다.

---

## 8. 긴 작업

**MCP 기본 요청 타임아웃은 60초입니다.** 외부 처리기는 그보다 오래 걸립니다.

```ts
handler: async () => {
  const jobId = context.jobs.start("mytool.render", async (job) => {
    job.progress(20, "처리 중");
    return await doWork(job.signal);
  });
  return { jobId, note: "photoshop.job.status 로 진행 상황을 확인하세요." };
},
```

- `start` 는 **즉시** Job ID 를 돌려줍니다
- 짧게 끝나도 같은 모양으로 돌려줍니다. 반환 타입이 상황에 따라 달라지면
  호출자가 매번 판단해야 합니다
- `job.signal` 을 자식 프로세스까지 내려보냅니다. 신호만 받고 계속 돌면
  취소가 거짓말이 됩니다
- `run` 안에서 던지면 Job 이 `failed` 가 됩니다. 이미 ID 를 돌려준 뒤이므로
  호출자에게 전파되지 않습니다
- 자기가 시작한 Job 만 `context.jobs.get(id)` 로 조회할 수 있습니다

진행 상황은 사용자가 `photoshop.job.status` 로 봅니다.

---

## 9. 나머지 표면

```ts
context.manifest      자신의 manifest
context.logger        debug · info · warn · error (stderr 로 나간다)
context.events        on(name, listener) · recent(query)
context.resources     register({ uri, name, read }) · touch(uri)
context.capabilities  외부 처리기 실행 요청
```

- **`events`** — 구독만 합니다. 발행은 없습니다. `unload` 때 자동 해제됩니다
- **`resources`** — 자기 namespace 의 URI 만 등록할 수 있습니다 (`mytool://state`).
  읽기·구독은 제공하지 않습니다 — 제공할 뿐 들여다볼 수 없습니다
- **`capabilities`** — 등록·설정 변경은 없습니다. 요청만 할 수 있고
  `photoshop.external` 이 필요합니다

**`context.logger` 를 쓰고 `console.log` 를 쓰지 마십시오.** `stdout` 은 MCP
stdio 전송이 점유합니다.

---

## 10. 설치와 등록

**기본은 "아무 Extension 도 없다" 입니다.** 사용자가 설치한 것만 붙습니다.

1. 사용자가 폴더를 어디든 놓습니다 (도구 설치 관리자가 함께 놓으면 됩니다)
2. Photoshop 의 **PhotoshopMCP 패널 → `Extension` → `폴더 추가…`** 로 그 폴더를 고릅니다
3. **MCP 서버를 다시 연결**합니다

서버는 Bridge 가 붙을 때 플러그인에게 등록 목록을 물어 적재하고,
`tools/list_changed` 로 클라이언트에 알립니다.

**폴더를 고르는 것은 사용자만 할 수 있습니다.** UXP 의 `getFolder()` 가 사용자
제스처를 요구하므로 서버가 대신 부를 수 없습니다. 이것이 안전장치입니다 —
LLM 이 임의 폴더의 코드를 적재시킬 수 없습니다.

`extension.json` 이 없는 폴더는 고르는 자리에서 거부됩니다.

### namespace 가 겹치면

이미 적재된 namespace 는 두 번째가 거부됩니다. 서버 로그에 경고가 남습니다.
`photoshop` 은 예약이라 쓸 수 없습니다.

### 개발 중이라면

저장소의 `extensions/` 에 두고 `PHOTOSHOP_MCP_EXTENSIONS_ENABLED` 로 고를 수
있습니다. 값은 **디렉터리 이름이 아니라 namespace** 입니다.

---

## 11. 할 수 없는 것

Extension 은 Core 의 확장 지점이지 우회로가 아닙니다.

```text
임의 JavaScript 를 Photoshop 에서 실행       막힘
임의 batchPlay descriptor 실행               막힘
Bridge 직접 접근                             노출되지 않음
photoshop.* namespace 에 Tool 등록           거부
다른 Extension 의 Tool·Resource 조회         노출되지 않음
Core Command 추가 · 교체                     노출되지 않음
서버 정책·설정 변경                          노출되지 않음
manifest 에 없는 권한 사용                   거부
```

Photoshop 을 새로운 방식으로 건드려야 한다면 그것은 Extension 이 아니라
**Core Command** 가 할 일입니다.

---

## 12. 저장소 밖에서 만들 때의 현재 제약

`@photoshop-mcp/extension-api` 는 **아직 npm 에 없습니다.** 지금은 Core 패키지를
재수출하는 배럴이라, 저장소 밖에서 그 이름으로 import 하면 해석되지 않습니다.

그래서 밖에서 만들 때는 이렇게 합니다.

- **Command 이름은 문자열로 적습니다** — `{ type: "DOCUMENT_GET", params: {} }`.
  목록은 `docs/CORE_API.md` §4 입니다
- **타입은 직접 선언합니다.** 실제로 필요한 것은 몇 개뿐입니다

```ts
interface ExtensionContext {
  manifest: { id: string; name: string; version: string; namespace: string };
  tools: {
    register(tool: {
      name: string;
      description: string;
      permission: "read" | "edit" | "external" | "destructive";
      inputSchema: { parse(value: unknown): unknown };
      handler: (input: any, ctx: { requestId: string }) => Promise<unknown>;
    }): void;
    has(name: string): boolean;
  };
  commands: {
    execute<T>(
      command: { type: string; documentId?: number; params: unknown },
      options?: { requestId?: string },
    ): Promise<T>;
  };
  jobs: { start<T>(kind: string, run: (job: any) => Promise<T>): string };
  logger: { info(m: string): void; warn(m: string): void; error(m: string): void };
}
```

런타임 의존은 `zod` 뿐입니다 (또는 `parse` 를 가진 다른 무엇이든).

`extensions/graxpert` 를 복사해 시작하는 것이 가장 빠릅니다. 다만 그
`tsconfig.json` 의 `extends` 와 `references` 는 저장소 상대 경로이므로
밖에서는 지워야 합니다.
