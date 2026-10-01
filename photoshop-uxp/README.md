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

### Imaging API 는 8비트만 인코딩한다

`imaging.getPixels` 로 축소한 픽셀을 메모리로 받아 `encodeImageData` 로 jpeg base64
를 만든다. 파일도 폴더 승인도 필요 없다 — 그래서 캡처 Tool 의 권한이 `read` 다.

인코더가 8비트만 받는다. 16비트 문서에서 다음 네 가지가 전부 막혔다.

| 시도 | 결과 |
|---|---|
| `getPixels({componentSize: 8})` | `-32005 선택 영역을 저장할 수 없습니다` |
| 16비트 ImageData 를 그대로 인코딩 | `Only 8 bit image data can be encoded as jpeg` |
| `format: "png"` 으로 회피 | 같은 오류. 이 옵션은 무시되는 듯하다 |
| 알파 포함 4채널 | `Image data with alpha cannot be encoded as jpeg` |

`getData({chunky: true})` 로 버퍼를 꺼내 8비트 RGB 3채널로 줄인 뒤
`createImageDataFromBuffer` 로 다시 감싼다.

**Photoshop 의 16비트 최대값은 65535 가 아니라 32768 이다.** `>> 8` 로 낮추면
최대 128 이 되어 딱 절반 밝기가 나온다. 오류는 나지 않는다 — 결과를 눈으로 보기
전에는 모른다.

```ts
const scale = 255 / 32768;
```

`ImageData` 는 `dispose()` 로 직접 해제한다. 큰 문서에서 쌓인다.

### DOM 에 `document.histogram` 이 없다

통계를 만들 때 경로가 둘이었다 — Photoshop 이 계산해 주는 `document.histogram` 과
직접 세는 `imaging.getPixels`. 첫 구현이 둘 다 확인하도록 만들어 재 봤다.

```text
getPixels 6048x4032 comp=4 size=16   docHistogram=undefined   432ms
```

**`document.histogram` 은 `undefined` 다.** 짐작으로 골랐으면 없는 API 를 썼다.

`getPixels` 는 2440만 픽셀(6048×4032)을 **432ms** 에 준다. 통계를 낼 때
표본 추출이 필요 없다 — 전수로 센다. `targetSize` 를 주면 안 된다. 축소하면
단일 픽셀 클리핑이 평균에 묻혀 재는 의미가 사라진다.

조정 레이어에 `layerID` 를 주면 **마스크 영역**이 돌아온다. 오류가 나지 않고
픽셀 수까지 그럴듯하게 달라서 더 그럴듯하다.

```text
layer:2 (Curves)        24,385,536 px   모든 채널 평균 255
layer:3 (Curves+마스크)  10,378,368 px   모든 채널 평균 255
```

### `-32005` 를 modal 탓으로 짐작했다가 틀렸다

`-32005 선택 영역을 저장할 수 없습니다` 가 나오길래 `executeAsModal` 범위와
충돌하는 것으로 짐작했다. 아니었다 — 원인은 위 표의 `componentSize: 8` 이다.
캡처도 다른 Command 와 똑같이 `runModal` 안에서 돈다.

오류 메시지가 실제 원인과 무관할 때가 있다. 짐작을 그대로 적어 두면 그 자리를
다시 보지 않게 된다.

### 코드 변경은 Reload 가 아니라 Unload → Load

UDT **앱**의 `Reload` 는 변경된 `dist/` 를 반영하지 않는다. 반드시 `Unload` 후 `Load` 한다.

CLI 의 `plugin reload` 는 다르다 — 바뀐 `dist/` 가 반영되는 것을 확인했다. 아래 참조.

### UI 가 안 바뀌면 코드보다 재적재를 먼저 의심한다

CSS 를 두 번 고치고 두 번 캡처를 받았는데 그림이 똑같았다. 그 사실을 관측으로
삼아 "`height:100%` 가 여기서도 해석되지 않는다" 는 결론을 내리고 **주석에까지
적었다.** 실제로는 UDT 서비스가 꺼져 있어 **새 코드가 한 번도 돌지 않았다.**

바뀌지 않는 화면은 "이 코드가 틀렸다" 가 아니라 **"이 코드가 돌았다" 는 증거가
없는 상태**다. 둘을 구분하지 않으면 돌지도 않은 코드의 동작을 사실로 적게 된다.

CLI 는 이 상태를 말해 준다 — `plugin reload` 가
`No valid session present at the CLI Service` 로 실패한다. 서비스는 UDT 앱과
별개로 띄운다.

```bash
node $UXP service start   # 백그라운드로 띄워 둔다
node $UXP apps list       # PS 가 목록에 있어야 한다
node $UXP plugin load     # 서비스를 새로 띄웠으면 reload 가 아니라 load 다
```

### `place` 는 선택 영역의 중심에 놓는다

파일을 가져올 때 **활성 선택 영역이 있으면 그 중심**에 놓인다. 캔버스 중심이
아니다.

실기에서 하늘을 선택한 채로 GraXpert 결과를 가져왔더니 770px 위로 밀렸다 —
이미지와 캔버스가 똑같이 4032×6048 인데 아래가 비어 배경이 드러났다.

```text
selection:0,-770,4032,5278
높이 5278 − (−770) = 6048   크기는 맞다. 위치만 틀렸다
놓인 중심 −770 + 3024 = 2254   하늘 선택의 중심이다
```

처음에는 해상도 태그(`XResolution`)가 없어서라고 짐작했다가 **틀렸다** —
GraXpert 패널의 변환기도 그 태그를 안 쓰는데 멀쩡했다. 크기가 아니라 위치가
어긋난 것이라는 사실을 `selection.capture` 의 `source` 로 재고 나서 알았다.

**파일을 가져오는 일이 선택에 좌우되면 호출자가 결과를 예측할 수 없다.**
`layer.place` 가 선택을 임시 채널에 저장하고 해제한 뒤 가져오고 되돌린다.
GraXpert 패널도 같은 방식이다(`GX_restoreSelectionAndRemoveMask`).

되돌리기가 실패해도 **던지지 않는다.** 가져오기는 이미 끝났고, 여기서 던지면
호출자가 "아무 일도 없었다" 고 믿는다.

### 패널 UI 만 영어다

화면에 나가는 문자열은 영어, 주석과 문서는 한글이다. 선은 **누가 읽는가**로
긋는다.

```text
패널 UI              영어   사람이 직접 읽고 누른다
오류·진단 메시지       한글   LLM 이 받아 사용자 언어로 옮긴다
주석·문서            한글
```

서버 메시지 777개를 번역해도 **사용자가 보는 것은 안 바뀐다** — LLM 이 이미
옮기고 있다. Tool 의 `description` 은 LLM 이 Tool 을 고르는 근거라 언어를
바꾸면 선택 품질이 달라질 수 있는데 그걸 검증할 방법이 마땅치 않다.

**이음매가 하나 있었고 닫았다.** 플러그인 오류가 패널로 새어 나온다고 199곳이라
적었는데 **과장이었다** — 패널에 글자를 쓰는 곳(오류 상자 · 폴더 상태 줄 · 개수
줄 · 확장 등록 대화상자)이 무엇을 부르는지 따라가 세어 보니 **세 문구**였다.
나머지는 Command 가 던지는 오류라 서버를 거쳐 LLM 에게 간다.

```text
dom/workspace.ts          파일 시스템 API 를 쓸 수 없다
dom/extension-registry.ts 이 폴더에 extension.json 이 없다
transport/ws-client.ts    WebSocket 오류
```

세 문구만 영어로 바꿨다. **사전도 UI 언어 선택도 필요 없다.** 이 세 개를 검사하는
테스트는 없었다. 첫 번째는 LLM 쪽 Command 에서도 쓰이는 함수인데 LLM 은 영어도
읽으므로 계약에 문제가 없다. 새 오류가 패널에 닿는 경로를 만들면 **그 문구도
영어로 쓴다** — 선은 여전히 "누가 읽는가" 다.

### 패널 UI — 폭과 간격은 직접 못 박는다

패널이 좁다. 도킹하면 사용자가 높이를 늘리지 못하는 경우가 있고, 플로팅이어도
기본 크기가 작다. 실기 캡처로 세 가지를 확인했다.

**`<button>` 은 `min-width:0` 으로 줄지 않는다.** 두 글자짜리가 90px 을 먹는다.
`width` 는 존중하므로 **명시해야 한다.**

```text
min-width:0 만        "해제" 가 92px → 버튼 넷이 3행으로 접힌다
width 명시            존중된다
안쪽 여백 약 30px      글자 폭 + 30 보다 좁으면 말없이 잘린다
                      (`폴더 승인` → `폴더...`)
```

**flex 의 `gap` 을 무시한다.** `<span>` 둘을 나란히 두었더니 붙어 나왔다.

```text
액션 1Extension 3     gap:8px 를 줬는데 안 먹었다
액션 1 · 확장 3        한 요소에 구분자를 넣어 만든다
```

버튼 줄의 `gap:4px` 는 먹는 것처럼 보였다 — 요소 종류에 따라 다를 수 있으니
간격이 중요하면 margin 으로 둔다.

**`height:100%` 는 해석되지 않는다. `100vh` 를 쓴다.** 호스트가 준 루트 요소의
부모에 높이가 없어 `%` 가 풀리지 않는다. `100%` 로 두면 루트가 내용만큼 커져서
**고정 footer 가 화면 밖으로 밀리고 스크롤도 생기지 않는다.**

```text
height:100%    footer 가 사라진다. 스크롤바도 없다
height:100vh   footer 가 고정되고 가운데가 스크롤된다
```

**골격은 header · content · footer 셋이다.**

```text
header    flex-shrink:0            Bridge 상태. 가장 자주 본다
content   flex:1 · min-height:0    나머지. overflow-y:auto
footer    flex-shrink:0            버튼. 패널을 줄여도 남는다
```

`min-height:0` 이 빠지면 flex 자식이 내용만큼 커져 부모를 넘고 footer 가 밀린다.

**중요한 것은 스크롤되는 쪽에 두지 않는다.** 처음에는 Bridge 상태를 content 에
두었는데, 패널을 줄이자 위로 밀려 안 보였다. 잘리는 것은 아래만이 아니다 —
스크롤 영역에서는 위로도 사라진다.

**`absolute` 를 쓰지 않는다.** 스크롤 영역과 겹친다.

### `show` 에서 다시 만들면 첫 클릭이 먹지 않는다

`entrypoints` 의 `create` 와 `show` 에 같은 함수를 걸어 두고 그 안에서
`innerHTML` 을 다시 쓰면, **패널을 보이게 하는 순간 DOM 이 새로 만들어져 클릭이
시작된 요소가 사라진다.** 실기에서 "처음 버튼이 한 번에 안 된다" 로 드러났다.

```text
create   DOM 을 만들고 리스너를 건다        한 번만
show     값만 다시 읽는다                  DOM 은 건드리지 않는다
```

같은 루트가 다시 오면 다시 만들지 않는다.

**포커스가 없는 패널의 첫 클릭이 포커스에 쓰이는 것은 별개다.** 그건 호스트
동작이라 고칠 수 없다 — 패널이 활성화된 뒤에는 한 번으로 눌린다. 둘을 같은
문제로 보면 고쳐진 것을 안 고쳐졌다고 읽는다.

### 지원 목록이 전부는 아니다

[CSS Styles 레퍼런스](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-css/Styles/)
에 `cursor` 가 **없는데 동작한다.** `sp-action-button` 에 `cursor:pointer` 를
걸어 실기에서 확인했다.

```text
gap · row-gap · column-gap   목록에 없다 → 실기에서도 안 먹는다
direction                    목록에 없다 → 안 쓴다 (경로는 JS 로 자른다)
cursor                       목록에 없다 → 그런데 먹는다
```

**없다고 포기하지 말고 재 본다.** 반대로 있다고 믿지도 않는다 — 어느 쪽이든
실기가 답이다.

### 패널은 `window.capture` 로 못 찍는다

`photoshop.window.capture` 는 **같은 프로세스**의 보이는 최상위 창을 모은다.
UXP 패널은 별도 호스트 프로세스라 잡히지 않는다 — 두 번 찍어 둘 다 메인 창만
나왔다.

패널 UI 를 확인하려면 사람이 스크린샷을 줘야 한다. §17.11 이 "대화상자가 떠
Photoshop 이 멈췄을 때 밖에서 찍는다" 를 목적으로 만들어졌는데, **패널이 띄운
모달에는 그 수단이 듣지 않는다.**

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

**이 기기의 설치 위치는 `D:\Dev\uxp-cli` 다.** 한 번 임시 폴더에 깔았다가
다시 찾지 못해 재설치했다 — 위치를 적어 두지 않으면 실기 때마다 찾는다.

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

## `.ccx` 로 묶기

```bash
node $UXP service start        # 한 번 띄워 둔다 (UXP 변수는 위 '사용' 참조)
npm run build && npm run package:plugin
# → photoshop-uxp/out/com.drmedia.photoshopmcp_PS.ccx
```

`uxp plugin package` 는 폴더를 통째로 압축하므로 **스크립트가 임시 폴더에
`manifest.json` · `icons/` · `dist/*.js` 만 복사해 묶는다** (`scripts/package-plugin.mjs`).
UXP CLI 위치는 `UXP_CLI` 환경 변수로 주고 기본값은 `D:\Dev\uxp-cli` 다.

서비스가 없으면 CLI 가 오류를 내고도 **종료 코드 0** 으로 끝난다. 스크립트는
`.ccx` 가 실제로 생겼는지로 성공을 판정한다.

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
