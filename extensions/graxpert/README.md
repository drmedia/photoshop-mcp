# GraXpert Extension

GraXpert Photoshop 패널의 **Gradient Removal** 과 **Noise Reduction** 을 MCP 에서 실행한다.

패널의 **External Automation API** 를 쓴다. 계약은 패널 저장소의
`docs/EXTERNAL_AUTOMATION.md` 이고, 이 문서와 어긋나면 그쪽이 맞다.

## Tool

| Tool | Permission | 설명 |
|---|---|---|
| `gx.status` | `read` | 패널이 떠 있는지 · 자동화가 켜져 있는지. **명령을 보내지 않는다** |
| `gx.run_gradient` | `external` | 그래디언트 제거 (언제나 AI Auto) |
| `gx.run_denoise` | `external` | 노이즈 감소 |

실행 Tool 은 **즉시 `jobId` 를 반환한다.** 실기에서 노이즈 감소가 75초, 사용자
환경에 따라 2분을 넘었다 — MCP 기본 요청 타임아웃 60초 안에 끝낼 수 없다.

```text
photoshop.selection.sky        하늘을 고른다 (선택)
 ↓
gx.run_gradient                jobId 를 받는다
 ↓
photoshop.job.status           completed 가 되면 result.layers
```

## 먼저 켜야 한다

패널 설정의 **Allow External Automation** 이 기본으로 **꺼져** 있다. 꺼진 채로
부르면 패널이 `automation_disabled` 로 거절한다.

`gx.status` 가 `blocked` 에 그 사실과 고치는 방법을 담는다. 실행 Tool 은
**Job 을 띄우기 전에** 같은 검사를 하고 즉시 실패한다 — 상태 파일을 읽을 뿐이라
왕복이 없고, 즉시 알 수 있는 거절을 `job.status` 로 미루지 않는다.

## 하늘은 선택 영역이다

패널은 하늘을 스스로 찾지 않는다.

```text
선택 있음   →  선택을 하늘로 삼아 전경을 가상 하늘로 덮고 계산 → 하늘만 합성
선택 없음   →  활성 레이어 전체를 처리
```

**둘 다 정상 동작이라 한쪽을 막지 않는다.** 대신 어느 쪽으로 갔는지를 결과에
담는다 — `selectionAtStart` 와 `skyApplied` 다.

`skyApplied` 는 응답의 설정값이 아니라 **결과 레이어 이름**으로 판정한다. 패널이
하늘 경로를 탔을 때만 이름 끝에 ` - Sky Merged` 또는 ` - Sky Masked` 를 붙인다.
설정을 되읽으면 "AI 로 요청했다" 까지만 알 수 있고 "하늘로 돌았다" 는 알 수 없다.

실기에서 이게 필요했다. 노이즈 감소를 두 번 돌리는 사이 선택이 사라졌고, 그다음
그래디언트 제거가 12초 만에 끝나 성공처럼 보였다. 단서는 레이어 이름뿐이었다.

## 액션으로는 안 된다

이 패널의 처리는 **Photoshop 에 descriptor 를 남기지 않는다.**
`addNotificationListener(["all"])` 로 들어 보니 레이어를 두 장 만드는 동안
`make` 가 하나도 오지 않았다. 온 것은 이게 전부다.

```text
hostFocusChanged  active:true    dontRecord:true    _isCommand:false
invokeCommand     commandID:-1007                   _isCommand:false
hostFocusChanged  active:false   dontRecord:true    _isCommand:false
```

액션이 기록하는 것이 바로 그 descriptor 경로다. 그래서 녹화 버튼을 눌러도 잡을
것이 없고 `photoshop.action.run` 으로도 부를 수 없다.

갈리는 기준은 "플러그인이냐" 가 아니라 **"메뉴를 거치느냐"** 다. StarXTerminator 는
`필터 > RC-Astro` 메뉴를 거치므로 녹화되고 실제로 `action.run` 으로 동작한다.

> 패널 배포판에도 액션이 들어 있다(`GraXpert_Actions.atn`). 그건 녹화한 것이
> 아니라 **이 자동화 채널에 명령을 쓰는 JSX 스크립트**를 액션으로 감싼 것이다.

## CLI Capability 로 대체되지 않는다

GraXpert 실행 자체는 CLI 와 **같은 인자**다.

```text
-cmd background-extraction {input} -cli -gpu … -correction … -smoothing … -output …
```

다른 것은 **입력**이다. 하늘 워크플로는 선택 영역으로 마스크를 만들고 지상부를
합성 평면으로 덮은 뒤(패널의 `sky-fill.js`, 채널별 평면 맞추기 + MAD 이상치 제거)
GraXpert 에 넣는다. 원본을 그대로 CLI 에 넣으면 산·나무가 그래디언트 모델을
끌어당긴다.

## `sample` 방식은 통로에 없다

패널의 Sample Point 방식은 사용자가 배경 포인트를 화면에서 찍는 작업이다. 외부
자동화 채널이 아예 받지 않는다 — `method` 를 보내면 `unsupported_parameter` 다.

미리보기를 보며 점을 옮기는 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다.

## 완료를 어떻게 아는가

패널의 응답은 **"명령을 받았다" 까지다.** 끝났다고 알려주지 않는다.

그래서 실행 **전에** 레이어 id 목록을 떠 두고, 없던 id 가 나타날 때까지 3초마다
`layer.list` 를 본다. 이름이나 위치로 찾지 않는다 — 같은 이름이 열 장 쌓인 문서를
실기에서 봤고, 위치는 활성 레이어에 따라 달라진다.

## 취소

`photoshop.job.cancel` 은 **기다리기를 그만둘 뿐 패널 처리를 멈추지 않는다.**
멈추려면 패널의 취소 버튼을 쓴다. 결과 메시지에 그 사실을 적어 돌려준다.

## 테스트

`tests/graxpert.test.ts`. 패널이 없어도 고정할 수 있는 것을 고정한다 — 스키마,
상태 판정, 거절 안내, 권한, `skyApplied`. **패널을 흉내 내지 않는다.**

경로는 `PHOTOSHOP_MCP_GRAXPERT_DIR` 로 바꾼다. 테스트가 이것을 쓴다.

**이게 없으면 테스트가 진짜 패널을 건드린다.** 처음에 기본 경로를 그대로 두고
"패널이 없으면 Job 을 띄우지 않는다" 를 통과시켰는데, 그때 패널이 닫혀 있어
우연히 통과한 것이었다. 패널이 열려 있었다면 테스트가 **실제로 GraXpert 를
돌렸다.**

거절만 고정하면 "항상 거절한다" 도 통과한다. **준비된 경우에 Job 이 뜨는 것**을
함께 고정한다 — 그것이 Extension 이 주입된 경로를 본다는 증거이기도 하다.

## 응답은 id 로 가린다

`automation_response.json` 은 한 파일을 모두가 공유한다. 패널 배포판의 JSX
액션이 쓴 응답이 남아 있을 수 있다 — 실기에서 `client: "PhotoshopAction"` 응답이
그대로 있었다. 요청 `id` 가 에코되므로 그것으로 대조한다.

읽기 전에 파일을 지우지 않는다. 패널이 쓰는 중과 겹친다.
