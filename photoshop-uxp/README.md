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

### 열거형 값이 Adobe 문서와 다르다

실기에서 확인한 실제 반환 값이다. 문서만 보고 작성했던 매핑이 **둘 다 틀렸다.**

| 속성 | Adobe 문서 표기 | 실제 반환 값 |
|---|---|---|
| `Document.mode` | `"RGB"` | `"RGBColorMode"` |
| `Document.bitsPerChannel` | `"sixteen"` | `"bitDepth16"` |
| `Layer.blendMode` (그룹) | 문서에 없음 | `"passThrough"` |

그룹 레이어의 기본 혼합 모드는 `passThrough` 다. 열거형에 없어 `rawBlendMode` 로 드러났다.
`normal` 로 떨어뜨렸다면 그룹의 통과 합성을 일반 합성으로 오인했을 것이다.
`passThrough` 는 그룹 전용이라 `layer.set_blend_mode` 의 입력에서는 제외한다.

`bitsPerChannel` 은 특히 위험했다. 해석 실패 시 `8` 로 떨어뜨리고 있어서
**16비트 문서가 8비트로 보고되었고, 그 값이 한 번도 실제 값이 아니었다는 사실이
드러나지 않았다.** 지금은 해석 실패 시 `null` 과 `rawBitDepth` 를 돌려준다.
모르는 값을 그럴듯한 기본값으로 덮지 않는다. (PROTOCOL.md §4)

### 레이어 생성·복제·그룹·이동은 모두 비동기다

`Document.createLayer()` · `Layer.duplicate()` · `Document.createLayerGroup()` ·
`Layer.move()` 는 모두 `Promise` 를 돌려준다. 동기로 다루면 Promise 객체의 속성을 읽어
`id` 와 `name` 이 빠진 결과가 나간다. `runModal` 은 async 콜백을 받는다.

### `Layer.move` 의 기준 객체는 Layer 여야 한다

Document 를 넘기면 Photoshop 이 거부한다.

```
'{"saveAs":{},"_id":70,...}' is of type object. Expecting type 레이어.
```

그룹에서 꺼낼 때는 최상위 레이어를 기준으로 `PLACEBEFORE` 한다.

### `historyStates` 는 되돌려도 줄지 않는다

`activeHistoryState` 포인터만 움직인다. 그래서 `states[length - 2]` 같은 절대 위치로
undo 하면 첫 번째 이후에는 같은 지점에 머문다. 현재 지점의 인덱스를 찾아 한 칸 뒤로 간다.

### 불투명도는 0–255 로 저장된다

`layer.opacity = 50` 을 넣으면 `50.19607843137255` 가 돌아온다. 프로토콜은 0–100 정수이므로
Plugin 이 반올림한다.

### 임의 경로에 파일을 쓸 수 없다

`localFileSystem: "fullAccess"` 를 주어도 `storage.createEntryWithUrl` 이
플러그인 밖 경로의 부모 폴더를 찾지 못한다.

```
Could not find an entry of 'file:///C:/Temp'
```

Photoshop 의 `save` 액션도 경로 문자열을 받지 않는다.

```
invalid file token used
```

세션 토큰이 필요한데 그 토큰은 storage API 로 얻은 entry 에서만 만들 수 있다.
자동화하려면 사용자가 폴더를 한 번 승인하고 persistent token 을 보관해야 한다.
그래서 문서 저장은 Phase 9 의 Permission System 과 함께 다룬다. (ROADMAP §8.5)

### 코드 변경은 Reload 가 아니라 Unload → Load

UDT **앱**의 `Reload` 는 변경된 `dist/` 를 반영하지 않는다. 반드시 `Unload` 후 `Load` 한다.

CLI 의 `plugin reload` 는 다르다 — 바뀐 `dist/` 가 반영되는 것을 확인했다. 아래 참조.

## UXP DevTools CLI 로 적재 자동화

사람이 UDT 앱에서 버튼을 누르지 않아도 된다. 실기 검증을 반복할 때 이것이 없으면
코드를 고칠 때마다 사람을 기다려야 한다.

**이 저장소의 의존성에 넣지 않았다.** Adobe 패키지의 `postinstall` 이 깨져 있어
`npm install` 전체를 실패시키기 때문이다. 쓸 사람만 따로 설치한다.

### 설치 — Adobe 패키징 버그 우회

`@adobe/uxp-devtools-helper` 의 `postinstall` 이 `tar` 를 `require` 하는데 의존성에
`tar` 가 없다. 그대로 설치하면 네이티브 애드온이 빠져 CLI 가 전부 실패한다.

```text
Error: No native build was found for platform=win32 arch=x64 runtime=electron ...
```

별도 디렉터리에서 스크립트를 건너뛰고 설치한 뒤 setup 을 직접 돌린다.

```bash
npm install --ignore-scripts @adobe/uxp-devtools-cli tar
node node_modules/@adobe/uxp-devtools-helper/scripts/devtools_setup.js
# → Adobe devToolsJS native add-on setup successfull.
```

### 사용

```bash
UXP=<설치경로>/node_modules/@adobe/uxp-devtools-cli/src/uxp.js

node $UXP apps list                      # Photoshop 이 붙었는지 확인
cd photoshop-uxp && node $UXP plugin load   # 최초 1회
node $UXP plugin reload                  # 이후 코드 변경 때마다
node $UXP plugin watch                    # 폴더 감시 후 자동 reload
```

### 검증용 문서도 명령으로 연다

실행 파일을 명시해야 한다. 파일만 주면 **기본 연결 프로그램**(다른 이미지 뷰어)이 뜬다.

```bash
powershell -NoProfile -Command   "Start-Process -FilePath 'C:/Program Files/Adobe/Adobe Photoshop 2026/Photoshop.exe'    -ArgumentList '<이미지 경로>'"
```

큰 TIFF 는 여는 데 시간이 걸리므로 `photoshop.document.get` 이 성공할 때까지 기다린다.

### `reload` 전에 반드시 `load` 를 해야 한다

CLI 는 **자기가 적재한 세션**만 다룬다. UDT 앱이 적재한 것은 별개 세션이라 바로
`reload` 하면 이렇게 실패한다.

```text
Command 'plugin reload' failed.
TypeError: Cannot read properties of undefined (reading 'sessions')
```

`uxp plugin load` 를 한 번 하면 그 뒤로 `reload` 가 동작한다.

`load` 는 플러그인 디렉터리에 `.uxprc` 를 만들어 세션 id 를 보관한다. 기기마다 다르고
`load` 할 때 다시 생기므로 `.gitignore` 에 있다.

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

| `bitDepth` 매핑 | 통과 (8비트 → `8`, 16비트 → `16`) |
| 저장 전 문서 이름 | 통과 (`"제목 없음-1"`) |
| 알 수 없는 값 → `null` + `rawBitDepth` | 통과 |
