# photoshop-uxp

Photoshop 안에서 실행되는 UXP 플러그인입니다. Photoshop MCP 의 실행 Agent 역할을 합니다.
(ARCHITECTURE §11)

```text
photoshop-uxp  →  photoshop-bridge (contracts, type-only)
```

contracts 는 **타입만** 가져옵니다. 컴파일 결과에 `require("@photoshop-mcp/...")` 가 남지 않으므로
번들러가 필요 없습니다. 런타임 의존은 UXP 가 제공하는 `photoshop` · `uxp` 모듈뿐입니다.

## 구조

```text
src/
├─ index.ts                 bootstrap — Dispatcher 구성, 접속, 패널 등록
├─ dispatcher/dispatcher.ts CommandDispatcher — Command → 처리 코드 연결
├─ transport/ws-client.ts   BridgeClient — 접속 · 3단계 핸드셰이크 · 재접속
├─ dom/document.ts          DOCUMENT_GET (Photoshop DOM)
├─ dom/layers.ts            LAYER_LIST (Photoshop DOM)
├─ dom/mappings.ts          열거형 매핑 (순수 함수, Photoshop 무관)
└─ types/photoshop.d.ts     UXP 모듈 최소 타입 선언
```

## 빌드

CommonJS 로 컴파일합니다. UXP 런타임이 `require("photoshop")` 를 쓰기 때문입니다.

```bash
npm run build          # 저장소 루트에서. dist/ 생성
```

`manifest.json` 의 `main` 은 `dist/index.js` 를 가리킵니다.

## 설치

1. `npm run build` 로 `dist/` 를 만듭니다.
2. Adobe UXP Developer Tool 에서 **Add Plugin** → 이 디렉터리의 `manifest.json` 선택
3. **Load** 로 Photoshop 에 적재합니다.
4. Photoshop 메뉴 `플러그인 > Photoshop MCP` 로 패널을 열어 Bridge 상태를 확인합니다.

MCP 서버가 `ws://127.0.0.1:8765` 에서 대기해야 합니다. 서버 먼저 띄울 필요는 없습니다 —
플러그인이 지수 백오프로 재접속합니다. (PROTOCOL.md §7)

## 핸드셰이크

접속 후 3단계를 거칩니다. (PROTOCOL.md §3.1)

```text
Plugin → hello       플러그인·호스트 정보와 등록된 Command 목록 보고
Server → hello_ack   수락 또는 버전 불일치 거부
Plugin → ready       Dispatcher 준비 완료 — 이 시점부터 Server 가 Command 를 보냄
```

`ready` 는 Dispatcher 구성이 끝난 뒤에만 보냅니다. 패널의 상태 표시는 이 단계를 반영합니다.

## UXP 제약 (실기 확인)

Photoshop 27.8 에서 확인한 내용이다. 추측이 아니라 실기에서 드러난 제약이므로
바꾸기 전에 반드시 재검증한다.

### `manifestVersion` 은 4 여야 한다

`manifestVersion: 5` 에서는 로컬 WebSocket 접속이 거부된다.

```
Permission denied to the url ws://127.0.0.1:8765. Manifest entry not found.
```

v5 는 network 권한 집행이 강화되어 `localhost` / `127.0.0.1` 을 허용하지 않는다.
`domains` 에 어떤 형식을 넣어도(스킴 포함/미포함, 포트 포함/미포함) 통하지 않았다.

### `domains` 는 스킴도 포트도 없는 호스트명

```json
"requiredPermissions": { "network": { "domains": ["localhost", "127.0.0.1"] } }
```

`"ws://127.0.0.1:8765"` 같은 전체 URL 형식은 매칭되지 않는다.

### `executeAsModal` 은 오류 객체를 감싼다

`core.executeAsModal()` 안에서 던진 오류는 Photoshop 이 다시 감싸 원래 타입과
`code` 를 잃는다. `DispatchError("DOCUMENT_NOT_FOUND")` 가 `COMMAND_FAILED` 로
뭉개졌다.

그래서 `dom/modal.ts` 의 `runModal()` 은 오류를 던지지 않고 **값으로** 돌려받은 뒤
modal 밖에서 다시 던진다. modal 안에서 직접 throw 하지 않는다.

### `document.layers` 는 배열이 아니다

배열 유사 컬렉션이라 `for...of` 하면 `TypeError: layers is not iterable` 이 난다.
`dom/layers.ts` 의 `toArray()` 로 변환해서 쓴다.

### 열거형 값이 문서와 다르다

`DocumentMode` 는 `"RGBColorMode"` 형태를 반환한다(`"RGB"` 가 아니다).
`dom/mappings.ts` 는 모르는 값을 예외 없이 처리하되, `colorMode` 는 원본을 보존한다.

### 코드 변경은 Reload 가 아니라 Unload → Load

UDT 의 `Reload` 는 변경된 `dist/` 를 반영하지 않는다. 반드시 `Unload` 후 `Load` 한다.

## 검증 상태

Photoshop 27.8 / UXP Developer Tool 실기 검증 완료.

| 항목 | 결과 |
|---|---|
| manifest UDT Load | 통과 |
| panel entrypoint 생성 | 통과 |
| WebSocket 연결 | 통과 |
| 핸드셰이크 `hello → hello_ack → ready` | 통과 |
| `photoshop.document.get` 실제 문서 | 통과 (`verify.psd` 3000×2000 RGB) |
| `photoshop.layer.list` 실제 레이어 | 통과 (group · pixel · adjustment · smartObject 매핑 확인) |
| 문서 없음 → `DOCUMENT_NOT_FOUND` | 통과 (`recoverable: true`) |
| 연결 끊김 → 재연결 | 통과 (Unload/Load 사이클) |

**미검증**: `bitDepth` 매핑. 8비트 문서로만 확인했다. 매핑 실패 시의 기본값도 `8` 이라
실제 값인지 fallback 인지 구분되지 않는다. 16/32비트 문서로 확인이 필요하다.
