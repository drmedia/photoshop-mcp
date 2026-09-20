# GraXpert Extension

GraXpert Photoshop 패널의 **Gradient Removal(AI)** 과 **Noise Reduction** 을 MCP 에서 실행한다.

## Tool

| Tool | Permission | 설명 |
|---|---|---|
| `gx.status` | `read` | 패널이 열려 있는지 · 처리 중인지. 아무것도 실행하지 않는다 |
| `gx.run_gradient` | `external` | AI 그래디언트 제거. **선택 영역이 필요하다** |
| `gx.run_denoise` | `external` | 노이즈 감소 |

실행 Tool 은 **즉시 `jobId` 를 반환한다.** 실기에서 노이즈 감소가 75초, 사용자 환경에
따라 2분을 넘었다 — MCP 기본 요청 타임아웃 60초 안에 끝낼 수 없다.

```text
photoshop.selection.sky        하늘을 고른다 (사람 또는 LLM)
 ↓
gx.run_gradient                jobId 를 받는다
 ↓
photoshop.job.status           completed 가 되면 result.layers
```

## 액션으로는 안 된다

이 패널의 처리는 **Photoshop 에 descriptor 를 남기지 않는다.**
`addNotificationListener(["all"])` 로 들어 보니 레이어를 두 장 만드는 동안
`make` 가 하나도 오지 않았다. 온 것은 이게 전부다.

```text
hostFocusChanged  active:true    dontRecord:true    _isCommand:false
invokeCommand     commandID:-1007                   _isCommand:false
invokeCommand     commandID:-1007                   _isCommand:false
hostFocusChanged  active:false   dontRecord:true    _isCommand:false
```

액션이 기록하는 것이 바로 그 descriptor 경로다. 그래서 녹화 버튼을 눌러도 잡을 것이
없고 `photoshop.action.run` 으로도 부를 수 없다.

갈리는 기준은 "플러그인이냐" 가 아니라 **"메뉴를 거치느냐"** 다. StarXTerminator 는
`필터 > RC-Astro` 메뉴를 거치므로 녹화되고 실제로 `action.run` 으로 동작한다.

## CLI Capability 로 대체할 수 없다

GraXpert 실행 자체는 CLI 와 **같은 인자**다.

```text
-cmd background-extraction {input} -cli -gpu … -correction … -smoothing … -output …
```

다른 것은 **입력**이다. AI 모드는 선택 영역으로 하늘 마스크를 만들고, 지상부를
합성 평면으로 덮은 뒤(`sky-fill.js` 의 채널별 평면 맞추기 + MAD 이상치 제거)
GraXpert 에 넣고, 결과를 하늘에만 합성한다. 원본을 그대로 CLI 에 넣으면 산·나무가
그래디언트 모델을 끌어당긴다.

## 하늘은 사용자가 고른다

패널은 하늘을 스스로 찾지 않는다. **활성 선택 영역**(없으면 활성 레이어의 마스크)을
하늘로 삼는다. "AI 자동" 은 GraXpert 의 배경 추출이 자동이라는 뜻이지 하늘 선택이
자동이라는 뜻이 아니다.

선택이 없으면 패널은 오류를 내지 않고 **말없이 일반 처리로 떨어진다.**

```js
if (skyAI && !maskToken) { skyAI = false; scope = "layer"; }
```

레이어가 생기고 진행 막대도 끝까지 가서 성공처럼 보인다. 실기에서 걸렸고, 결과
레이어 이름에 ` - Sky Merged` 가 없는 것만이 유일한 단서였다.

그래서 **Job 을 띄우기 전에** 선택을 확인하고 막는다. 선택을 대신 만들지는 않는다 —
무엇을 하늘로 볼지는 이 Extension 이 정할 일이 아니다.

끝난 뒤에도 **레이어 이름으로 실제 여부를 확인해** `skyApplied` 로 보고한다.
설정값을 되읽으면 "AI 로 요청했다" 까지만 알 수 있고 "AI 로 돌았다" 는 알 수 없다.

## `sample` 방식은 열지 않았다

패널의 다른 방식은 사용자가 배경 포인트를 화면에서 찍는 작업이다. 미리보기를 보며
점을 옮기는 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다 — MilkyScape 패널을 사람
도구로 남겨 둔 것과 같은 판단이다.

## 패널 쪽 패치가 필요하다

이 Extension 은 패널이 원래 자기 샘플 에디터 창과 쓰던 **파일 명령 통로**를 쓴다.
`%TEMP%/GraXpert_Photoshop/gradient_editor_command.json` 을 350ms 마다 읽는다.

그 통로에 `run` 명령을 더해야 한다. 패널 `client/main.js` 의
`handleSampleEditorCommand` 에서, 샘플 에디터 전용 guard **앞에** 둔다 — AI 모드와
denoise 는 샘플 포인트를 쓰지 않아 `previewState` 가 없다.

`runBtn.onclick()` 이 아니라 `runBtn.click()` 을 쓴다. 직접 부르면 처리 중이라
비활성화된 버튼까지 눌려서 또 돈다.

함께 넣으면 좋은 것이 `setBusy` 의 자기 기록이다. `panelBusy` 를 켠 시각·라벨·호출
스택을 남기면, 버튼만 회색일 때 **진짜 처리 중인지 `setBusy(false)` 가 빠진 것인지**
가릴 수 있다.

### 명령 파일은 실행 후 지운다

**남기면 패널을 다시 열 때 옛 명령이 그대로 한 번 더 실행된다.** 재시작이 중복 방지
상태(`lastSampleCommandId` · 파일 스탬프)를 지우는데 파일은 디스크에 남아 있기
때문이다. 실기에서 겪었다 — 누른 적 없는 실행이 한 번 더 돌았다.

## 취소

`photoshop.job.cancel` 은 **기다리기를 그만둘 뿐 패널 처리를 멈추지 않는다.**
멈추려면 패널의 취소 버튼을 쓴다. 결과에 그 사실을 적어 돌려준다.
