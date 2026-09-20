# CLAUDE.md

이 파일은 Claude Code가 이 저장소에서 작업할 때 참고하는 지침입니다.

작업 시작 시 반드시 `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` 를 먼저 읽습니다.

## 프로젝트 개요

PhotoshopMCP — Photoshop를 MCP(Model Context Protocol) 서버로 제어하는 모노레포.

Core는 Photoshop을 이해하고, Extension은 작업 도메인을 이해합니다. (ARCHITECTURE §1)

## 현재 상태

**Phase 13 까지 완료. 남은 것은 Phase 14 (Distribution) 하나다.**

Core Tool **78개** · Resource 6개. Extension 예제 2개(`example` 2 · `milkyscape` 5).

Tool 개수를 셀 때 주의한다. `photoshop.diagnostics` 의 `registry.tools` 는 Extension
Tool 까지 더한 수다(지금 85). 한동안 이 값을 Core 개수로 옮겨 적어 "Core Tool 46개"
라는 틀린 문장이 문서 세 곳에 남아 있었다. **Core 목록의 기준은 `docs/CORE_API.md` §4** 이고
`tests/core-api-doc.test.ts` 가 레지스트리와 대조한다.

- 조회: `ping`, `document.get`, `layer.list`
- 레이어: create / duplicate / rename / select / set_visibility / set_opacity / reorder
- 스마트 오브젝트: `smart_object.convert` — 뒤에 거는 필터가 스마트 필터가 된다
- 그룹: create / move_layer · History: undo
- 조정 레이어: curves / levels / brightness_contrast
- 마스크: create / enable / disable · 선택: clear / invert
- 필터: gaussian_blur · high_pass · minimum_maximum (기본은 픽셀 직접 적용)
- §8.6 공백 보완: selection.set · layer.set_blend_mode · adjustment.hue_saturation · vibrance

- 파일 저장: `workspace.status` · `document.save_as` · `document.export` · `document.save`
- 캡처: `document.capture` · `layer.capture` · `selection.capture` · `window.capture`
- 구도: `document.crop` — 캔버스만 줄이고 **픽셀은 버리지 않는다**. 그래서 `edit` 이다
- 수평: `document.rotate` — 기울기를 세운다. 빈 모서리를 뺀 `safeBounds` 를 함께 준다
- 측정: `measure.tilt` — 경계선 기울기. **각도와 잔차를 함께 준다**
- 측정: `document.statistics` — **전체 해상도 원본**에서 히스토그램·채널 통계
- 결함 제거: `retouch.remove_spots` — 먼지·잡티. **배경 레이어는 거절한다**
- 국소 명암: `dodge_burn.dab` — 부드러운 원형 얼룩. **softLight 빈 레이어에 칠한다**
- 칠하기: `paint.dab` (색) · `mask.dab` (마스크에 **더한다**)
- 텍스트: `text.create` · `text.set` · `font.list` — **워터마크·서명 범위**
- 액션: `action.list` (조회) · `action.declared` · `action.run` — **선언한 것만**
- Camera Raw: `camera_raw.apply` — **Tool 은 이 하나뿐이다**

## 캡처 (ROADMAP §17.10)

**호출자가 자기 편집 결과를 본다.** 이것이 없어서 보정 열 단계를 다 쌓은 뒤
내보내기로 확인하고 나서야 하늘이 보라색이 된 것을 발견한 적이 있다.

ROADMAP §17.9 에 "결과를 볼 수 없다 · Tool 을 더 만들어 풀 문제가 아니다" 라고 적었던
것은 **틀렸다.** UXP `imaging` API 가 축소한 픽셀을 메모리로 준다. 없던 것은 능력이
아니라 그 능력을 쓰는 Tool 이었다.

권한은 셋 다 `read` 다 — 파일을 만들지 않고 폴더 승인도 필요 없다. `document.export`
로도 볼 수 있지만 원본을 디스크에 쓰고 `external` 을 요구한다.

결과는 **MCP image content block** 으로 나간다. base64 를 텍스트 JSON 에 담으면
LLM 은 그것을 볼 수 없고 토큰만 먹는다. 서버가 알아보는 기준은 `CapturedImage`
계약 하나다(`photoshop-bridge/src/capture.ts`). 크기는 텍스트로 함께 준다.

긴 변 기본 1024 · 상한 2048. 구도·색·노출 판단에는 충분하다.

## 창 캡처 (ROADMAP §17.11)

`photoshop.window.capture` 는 위 셋과 다른 물건이다. 문서의 픽셀이 아니라 **Photoshop
창**을 찍는다 — 패널·툴바·대화상자까지.

처음에 "찍히는 것은 픽셀이 아니라 패널과 툴바라 쓸모없다" 고 적었는데 **판단이
좁았다.** 쓸모는 하나지만 그것이 크다. **대화상자가 떠 있으면 Photoshop 이 명령을
받지 못하는데**, batchPlay 가 응답하지 않아 호출자는 타임아웃만 본다.
`photoshop.diagnostics` 도 못 본다 — Bridge 가 응답 못 하는 상태라 Photoshop 에게
물어볼 방법 자체가 없다. 밖에서 창을 찍는 것이 유일한 길이다.

**UXP 가 아니라 서버가 직접 찍는다.** Bridge 가 localhost WebSocket 이라 서버는
Photoshop 과 같은 기계에 있다. 헬퍼 실행 파일을 따로 깔 이유가 없다. Windows 는
PowerShell + `PrintWindow` 로 의존성 0 이다.

`PrintWindow` 여야 한다. 화면 복사(`CopyFromScreen`)는 **위에 있는 딴 창**을 찍는다.
Photoshop 이 뒤에 있어도 대화상자를 볼 수 있어야 하므로 이 차이가 결정적이다.
`PW_RENDERFULLCONTENT`(2) 를 줘야 GPU 캔버스가 검게 나오지 않는다.

**권한이 `read` 가 아니라 `external` 이다.** 찍는 것이 문서가 아니라 사용자의 화면이다 —
파일 경로·최근 문서·계정 이름이 함께 찍힌다. 기본 허용 밖이라 꺼져 있는 것이 기본이다.

대상은 **Photoshop 메인 창으로 고정**한다. 호출자가 창을 고를 수 있으면 임의 창 캡처
도구가 되고 §23 이 막으려던 것과 같아진다. 같은 이유로 LLM 이 준 값은 스크립트
문자열에 섞이지 않는다 — 스크립트는 고정 상수이고 `longEdge` 는 환경 변수로만 간다.

최소화된 창은 `IsIconic` 으로 잡아 **실패로 돌려준다.** `PrintWindow` 는 오류 없이
빈 화면을 주는데, 그대로 돌려주면 호출자가 현재 화면이라고 믿는다.

**모든 창을 찍는다.** `EnumWindows` 로 같은 프로세스의 보이는 최상위 창을 모아
**대화상자를 먼저** 놓는다 — 막힌 원인이 먼저 보여야 한다. 결과가 한 장이 아니라
여러 장이고, 서버가 창마다 image 블록을 내보낸다.

처음에는 메인 창 하나만 찍어서 **이 Tool 의 존재 이유인 경우를 놓쳤다** — Camera Raw
같은 대화상자는 별도 최상위 창이라 메인 창에 안 들어온다. (ROADMAP §17.17)

`GetWindowTextW` 는 **`CharSet.Unicode` 로 선언한다.** 없으면 ANSI 로 마샬링되어
제목이 첫 글자에서 잘린다 — `_DSC0601.NEF @ 25% ...` 가 `_` 로 왔다.

macOS 는 미지원이다. 목록에는 노출하되 이유를 말하며 실패한다.

Imaging API 는 **8비트만 인코딩한다.** `componentSize: 8` 요청도, `format: "png"`
회피도, 알파 포함도 전부 막힌다. 받은 픽셀을 JS 에서 8비트 RGB 로 낮춰 다시 감싼다.
**Photoshop 의 16비트는 0–65535 가 아니라 0–32768 이다** — `>> 8` 로 낮추면 오류 없이
딱 절반 밝기가 나온다.
자세한 것은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 에 있다.

## 측정 (ROADMAP §17.13)

**보는 것과 재는 것은 다른 일이고 둘 다 필요하다.** 캡처가 "보는" 문제를 풀었지만
어두운 영역의 색 편향·미세한 캐스트·작은 클리핑은 봐서 잡히지 않는다. 실기에서
보라색 하늘과 초록색 하늘을 두 번 통과시킨 뒤에 만들었다.

**미리보기를 재지 않는다.** 축소하면 단일 픽셀 클리핑이 평균에 묻히고 8비트로
내리면 값이 바뀐다. `targetSize` 를 주지 않고 전체 해상도로 읽는다 — 2440만 픽셀이
400ms 다. 표본 추출을 하지 않는다.

값은 0–255 로 정규화하되 **클리핑 판정은 원래 심도에서** 한다. 16비트를 먼저 내리면
32768 과 32700 이 똑같이 255 가 되어 클리핑이 부풀려진다.

**DOM 에 `document.histogram` 이 없다.** 첫 구현이 두 경로를 모두 확인하도록 만들어
재 보고 알았다. 짐작으로 골랐으면 없는 API 를 썼다.

**채널마다 노이즈 σ 를 함께 준다.** 이웃 차의 **중앙값** 기반이다 — 평균을 쓰면
가장자리와 별이 노이즈로 읽힌다. 실기에서 증폭 배율이 곡선 기울기와 세 자리까지
맞았다(1.87 대 1.875). **평탄한 영역에서 재야 한다** — 촘촘한 질감은 구분되지 않는다.
잴 수 없으면 0 이 아니라 `null` 이다.

**조정 레이어에 `layerId` 를 주면 거절한다.** 실기에서 재 보니 마스크 영역을 재서
모든 채널 평균이 255 로 나왔다. 픽셀 수까지 그럴듯하게 달라 더 그럴듯하다 —
그대로 돌려주면 "이 레이어는 순백" 으로 읽힌다.

## 결함 제거 (ROADMAP §17.14)

타원 선택 + **내용 인식 채우기**다. 치유 브러시는 붓질을 요구하는데, batchPlay 로
획을 흉내 내면 호출자가 descriptor 를 조립하는 것과 다를 바 없어진다(§23).

**배경 레이어를 거절한다.** 먼지 제거는 원본 촬영 픽셀을 지우는 것이 목적인 유일한
작업이다 — 필터는 효과를 입히지만 이것은 있던 것을 없앤다. 막으면서 `layer.duplicate`
로 복제하라고 말한다. `isBackgroundLayer` 를 **모르면 막지 않는다** — 없는 것을
참으로 읽어 멀쩡한 호출을 막는 것이 더 나쁘다.

배경을 막아 두었으므로 사라지는 것은 이미 사본이고, 그래서 `edit` 이다.

선택을 `finally` 에서 해제한다. 남기면 다음 Command 가 조용히 그 범위에만 걸린다.

**먼지와 새를 구분하는 것은 자동화되지 않았다.** 검출기를 돌리면 새·비행기·구조물이
같이 걸린다 — 실기에서 후보 16개가 전부 새였다. Tool 은 주어진 좌표를 지울 뿐이고
좌표 판단은 눈으로 한다.

## 조정 레이어는 `luminosity` 로 (ROADMAP §17.16)

**합성 채널에 톤 곡선을 걸면 채도도 같이 오른다.** 실기에서 두 번 겪고 두 번 다
보정 레이어를 덧대어 되돌린 뒤에야 알았다 — `layer.set_blend_mode` 에 `luminosity`
가 이미 있었다. 재 보니 하늘 B−휘도가 12.35 로 손대기 전 12.30 과 사실상 같았다.

**공백이라고 적기 전에 있는 것부터 확인한다.** 두 번 모두 "도구가 부족하다" 가
아니라 "쓸 줄 몰랐다" 였다.

## 닷징 · 버닝 (ROADMAP §17.31)

**브러시가 아니라 얼룩이다.** 치유 브러시를 만들지 않은 이유(§17.14)는 획 경로가
필요하다는 것이었는데, 닷징·버닝은 `중심 · 반지름 · 강도 · 경도` 로 결정된다.
타원 선택 → 페더 → 채우기로, `fill` descriptor 는 §17.14 에서 검증된 것이다.

**빈 투명 레이어에 칠한다.** Soft Light 에서 투명 픽셀도 회색과 같이 중립이라
50% 회색을 채울 필요가 없다. 레이어 준비는 이 Command 가 하지 않는다 —
`layer.create` + `layer.set_blend_mode softLight` 다.

**실효 범위가 지정 반지름의 약 2.5배다.** 경도 0 이면 페더가 반지름과 같고 페더는
양쪽으로 번진다. 실기에서 반지름 600 이 1500 까지 닿았고 600 지점에 아직 절반이
남아 있었다. 모르면 옆 영역까지 밝힌다.

**성운에는 맞지 않는다** — 원형 얼룩이 구조를 못 따라간다. 형태가 복잡하면
`selection.color_range` + `adjustment.curves` 쪽이다.

## 액션 (ROADMAP §17.34)

액션은 사용자가 녹화한 것이라 LLM 이 내용을 만들지는 못하지만 **무엇을 하는지도
알 수 없다** — 실기 목록에 이미 `내보내기 > PSD로 저장` 이 있어 승인된 작업 폴더
밖으로 파일을 쓴다. 그래서 **`action.run` 은 `destructive`** 이고 기본 허용 밖이다.

**`actions.json` 은 권한이 아니라 목록이다.** 레벨을 액션마다 선언하게 하지
않았다 — 안을 읽을 수 없는데 `edit` 이라고 적으면 희망이지 사실이 아니다.
이 파일은 **어느 것을 부를 수 있는가**만 정한다. `set` 과 `action` 둘 다 필요하다.

**이름을 그대로 받는 Tool 을 내놓지 않았다.** `action.play` 는 없다 — 있으면
허용 목록이 무의미해진다.

**`app.displayDialogs` 가 UXP 에 없어 대화상자를 끄지 못한다.** 결과의
`dialogsSuppressed` 가 그 사실을 담는다. 액션의 대화상자 토글은 사용자가 꺼 둬야
한다. 안 그러면 플러그인이 멈춘다.

**UXP 는 속성 하나마다 Photoshop 으로 왕복한다.** 액션 91개를 한 번에 읽으려다
두 번 타임아웃했다(속성 3개 300왕복 · 2개 200왕복). `action.list` 는 **두 단계**다 —
`set` 없으면 세트 이름만(22왕복 6.5초), 주면 그 세트의 액션만.

액션 이름은 **유일하지 않다.** `B and C Landscape` 가 두 세트에 있었다.

## 텍스트 (ROADMAP §17.33)

**워터마크·서명까지만 열었다.** 자간·행간·단락·워프는 `CORE_API.md` §5.12 에
남아 있다 — 안 쓰는 파라미터가 스키마에 있으면 호출자가 무엇이 중요한지 모른다.

**DOM 에 있는지 재 봤고 있었다** — `document.createTextLayer` · `textItem.
characterStyle` · `app.fonts`. batchPlay 를 한 줄도 쓰지 않았다.

**`SolidColor` 는 통째로 대입할 수 없다.** `app.SolidColor` 로 만들고
`solid.rgb.red = 255` 처럼 **속성을 하나씩** 넣는다. `{ rgb: {...} }` 도
`solid.rgb = {...}` 도 거절당한다.

**없는 폰트는 조용히 대체된다.** 오류 없이 다른 폰트로 그려서 호출자는 걸렸다고
믿는다. `app.fonts` 에서 미리 찾아보고 거절한다. `font.list` 가 주는
**`postScriptName`** 이 `font` 에 넣을 값이고 화면 이름이 아니다.

## 마스크에 칠하기 (ROADMAP §17.32)

`dodge_burn.dab` 의 논리는 내용과 대상을 바꿔도 성립한다 — `paint.dab` 은 지정한
색을 픽셀에, `mask.dab` 은 흰색·검정을 **마스크에** 칠한다. 공통 경로는 `dab.ts` 다.

**`mask.dab` 이 더 중요하다.** 조정 레이어의 마스크를 다듬으므로 비파괴 보정
한가운데에 들어간다. `mask.gradient` 가 마스크를 덮어쓰는 것과 달리 **더한다.**
선형·방사형으로 맞출 수 없는 비대칭한 빛 공해가 이것으로 풀린다.

**이미 끝까지 간 마스크는 더 움직일 수 없다.** 검정인 곳에 `hide`, 흰색인 곳에
`reveal` 은 아무 일도 하지 않는데 **오류도 나지 않는다.** 실기에서 두 번 겪었다.
그때는 마스크가 아니라 곡선 자체를 고쳐야 한다.

`reveal`/`hide` 로 받는다. `white`/`black` 이면 호출자가 매번 어느 쪽이 보이는
쪽인지 되짚어야 한다.

**`RGBColor` 의 녹색 키는 `green` 이 아니라 `grain` 이다.**

## 마스크는 밝기가 아니라 형태로 (ROADMAP §17.28)

**밝기 마스크와 `shadows` 는 서로를 무효화한다.**

```text
selection.color_range highlights  →  어두운 부분을 뺀다
camera_raw shadows                →  어두운 부분에만 작용한다
```

교량 보정에서 실제로 겪었다. 입체감이 필요한 곳은 상판 아래와 교각 — 어두운
면인데 마스크가 바로 그곳을 제외했다. 같은 값으로 두 마스크를 비교하면 이렇다.

```text
             밝기 마스크        피사체 마스크
교각 σ       1.134 → 1.134     1.134 → 1.273
```

`photoshop.selection.subject` 는 **형태**로 잡으므로 어두운 면이 함께 들어온다.
무엇을 피사체로 볼지는 Photoshop 이 정하니 결과의 `bounds` 를 확인한다.

**`texture` · `clarity` 는 대상에 따라 효과가 크게 다르다.** 달(매끄러운 면)은
`texture 18` 로 σ +29% 였는데 교량(초점 맞은 금속 구조)은 `texture 25` 로 +6.7%
였다. 이미 국소 대비가 높으면 금방 포화한다.

**국소 보정이 격리됐는지는 σ 로 본다.** 밝기는 거의 안 변하면서 노이즈만 변하는
경우가 있어 L 만 보면 놓친다.

## 국소 보정은 별도 레이어에 (ROADMAP §17.27)

**스마트 필터 마스크는 레이어당 하나다.** 전역 Camera Raw 가 걸린 Smart Object 에
선택 영역을 주고 한 번 더 걸면 그 마스크가 **스택 전체**에 걸린다 — 맞춰 둔 전역
톤까지 그 선택 안에만 적용된다. 그래서 국소 보정은 별도 레이어여야 한다.

```text
layer.duplicate / stamp_visible
 ↓
selection.*  →  mask.create { from: "fromSelection" }
 ↓
smart_object.convert
 ↓
camera_raw.apply            → 스마트 필터로 남아 값만 고칠 수 있다
```

**`mask.create` 의 `from` 기본값은 `revealAll` 이다.** 선택이 있어도 자동으로 쓰지
않는다. 빠뜨리면 전부 흰 마스크가 되어 국소 보정이 조용히 전역에 걸린다.

`smart_object.convert` 하면 **마스크가 SO 안으로 흡수되고 SO 가 그 범위로 잘린다.**
`hasMask` 가 `false` 가 되는 것이 그 증거다. 그리고 **id 가 바뀐다** — 옛 id 는
사라지므로 결과의 `layer.id` 를 이어 쓴다. `previousId` 가 옛 값을 담는다.

이미 스마트 오브젝트면 `converted: false` 로 답하고 아무것도 하지 않는다. 겹치면
스마트 오브젝트 안에 스마트 오브젝트가 생긴다.

**국소 보정이 격리됐는지는 레이어를 껐다 켜며 같은 영역을 재서 확인한다.**
실기에서 `from` 을 빠뜨려 전역에 걸린 것을 눈으로는 못 봤다 — 밝기가 거의 안
변했기 때문이다(하늘 L 25.11 → 25.08). 잡아낸 것은 노이즈였다(σ 0.93 → 1.24).

## Camera Raw (ROADMAP §17.17)

**Tool 은 `camera_raw.apply` 하나뿐이다.** 슬라이더마다 Tool 을 두지 않는다 —
Camera Raw 는 슬라이더들이 한 렌더링 파이프라인 안에서 함께 계산되고, 한 번 걸 때마다
픽셀이 구워진다. 실기에서 같은 네 설정을 네 번 나눠 걸었더니 중간값이 19% 어긋났다.
`basic` · `detail` 같은 묶음 Tool 도 두지 않는다 — 이어 부르면 똑같이 두 번 구워진다.

**키는 짐작한 것이 하나도 없다.** `addNotificationListener(["all"])` 로 잡아냈다.
**색상 혼합(HSL) 24개**도 같은 방법으로 잡았다(ROADMAP §17.29) — `$HA_*` 색조 ·
`$SA_*` 채도 · `$LA_*` 광도, 접미사는 `R·O·Y·G·A·B·P·M` 이다. 이쪽은 **정수**로 간다.

**곡선**도 있다(ROADMAP §17.30) — `$PC_H·L·D·S` 파라메트릭, `$PC_1·2·3` 구간 경계,
`curve`·`$CrvR·G·B` 포인트, `$crfs` 채도 미세 조정.

**`curve` 에는 `$` 가 없다** — `saturation` 에 이은 두 번째 예외다.

**파라메트릭 곡선은 구간 경계가 함께 있어야 적용된다.** 없으면 `ok` 를 돌려주면서
아무 일도 안 한다 — 실기에서 달이 1레벨도 안 움직였다. 빌더가 기본값 25·50·75 를
채운다. 이 프로젝트의 "조용한 실패" 세 번째다(배경 `set_opacity` · `$Ex12` · 이것).

descriptor 를 캡처할 때: **이벤트 버퍼는 MCP 서버 프로세스에 있다.** 서버 하나를
띄워 둔 채로 사람이 메뉴를 실행해야 한다. 그리고 **빈 레이어(`layer.create`)에는
걸리지 않는다** — 조정할 색이 없어 색상 혼합이 흑백 믹서로 떨어진다.
`layer.stamp_visible` 로 내용이 있는 레이어를 만든다.

함정 넷. **`$Ex12` 에 정수가 가면 조용히 무시된다** — `ok:true` 를 돌려주면서 아무것도
안 한다. 빌더가 0.0001 밀어 실수로 만든다. **`saturation` 만 `$` 가 없다.**
**`temperature` 는 켈빈이 아니라 −100~100** 이다. **버전 키는 넣지 않는다** —
빼도 동작하고, 박아 넣으면 다른 Camera Raw 버전에서 깨진다.

**숨긴 레이어는 미리 막는다.** Photoshop 이 "명령을 사용할 수 없습니다" 라고만 답해
이유를 알 수 없다.

대화상자는 `_options: { dialogOptions: "display" }` 로 **열린다**(옵션 객체가 아니다).
다만 열려 있는 동안 플러그인이 멈춰 Bridge 가 15초에 타임아웃하므로 Tool 로 내놓지
않았다. Job 시스템과 함께 다룰 일이다.

노이즈 감소는 `filter` 쪽 `denoise` 보다 훨씬 낫다 — 실기에서 σ 6.72 → 3.42(49%)
이면서 색은 소수점 둘째 자리까지 그대로였다. `denoise` 는 최대 강도로도 7% 였다.

## 조정 레이어의 종류 (ROADMAP §17.24)

`layer.list` 가 `adjustmentType` 을 담는다. 그전에는 "조정 레이어다" 까지만 말해서
**저장한 PSD 를 다시 열면 이름으로 짐작해야 했다.**

구현하고 실기 문서를 읽으니 "곡선" 이라는 이름의 넷 중 셋이 Color Balance 였다.

클래스 이름이 UI 이름과 다른 것이 있다 — `brightnessEvent` 가 밝기/대비다.
아는 것만 옮기고 모르면 `null` + `rawAdjustmentType` 이다.

**조정 레이어에만 묻는다.** 픽셀 레이어에 물으면 batchPlay 묶음이 통째로 실패해
마스크 상태까지 잃는다.

## 레이어 순서 (ROADMAP §17.23)

`photoshop.layer.reorder` 의 `top` · `bottom` · `up` · `down` 은 **같은 부모
안에서만** 움직인다. 그룹을 넘나드는 이동은 `group.move_layer` 가 한다.

Photoshop UI 는 그룹 끝에서 한 번 더 누르면 밖으로 나가는데 그것을 흉내내지
않았다 — 호출자가 "지금 그룹의 몇 번째인지" 를 알아야 결과를 예측할 수 있게 된다.
`above` · `below` 만 부모가 바뀔 수 있고 결과의 `parentId` 에 드러난다.

**맨 위에서 `up` 은 오류가 아니다.** `moved: false` 로 말한다. `index` · `siblings`
는 옮긴 뒤 실제로 읽은 값이고 형제 기준이다 — 전체 목록의 인덱스가 아니다.

## 마스크 그라디언트 (ROADMAP §17.22)

`type` 은 `linear`(기본) 과 `radial` 이다. **`radial` 에서는 `from` 이 중심이고
`from`→`to` 거리가 반지름**이며 방향은 무시된다. 기본은 중심이 검은색이라
광원 쪽을 강하게 주려면 `reverse` 가 필요하다.

빛 공해는 광원에서 **2차원으로** 감쇠한다. 선형 마스크를 가로·세로로 겹쳐도
모서리는 구조적으로 남는다 — 실기에서 중간 행은 ±1레벨로 맞았는데 모서리가 ±8
남았고, 그룹 마스크를 곱해 우회하느라 조정 레이어가 넷 더 들었다.

`angle` · `reflected` · `diamond` 는 없다. 모르는 값을 조용히 `linear` 로
떨어뜨리지 않고 **거절한다.**

## 기울기 측정 (ROADMAP §17.21)

`photoshop.measure.tilt` 가 `document.rotate` 의 **입력을 만든다.** 이것이 없던
동안 수평선을 잴 때마다 캡처를 밖으로 내보내 PowerShell 로 Theil-Sen 을 새로 짰다.

**각도만 돌려주지 않는다.** 실기에서 세 번 쟀고 두 번은 돌리지 않는 것이 답이었다 —
경계가 직선이 아니었고, 세 번 다 그럴듯한 각도가 나왔다. 가른 것은 `residualIqr` 이다.
잔차는 `risePixels`(그 구간에서 경계가 오르내린 높이)와 **견주어** 읽는다.

`reliable` 같은 판정은 담지 않는다. 임계가 영역 크기에 따라 달라진다.

**보정이 쌓인 문서에서는 `layerId` 로 원본 레이어를 지정한다.** 합성에서는 대비가
낮아져 실기에서 1000열 중 83열만 잡혔고 잔차가 경계 높이보다 컸다.

Mock 은 픽셀을 모르므로 **실패한다.** 각도를 지어내면 Mock 으로 돌린 워크플로가
엉뚱한 회전을 하고 그것이 성공으로 보인다.

## 회전 (ROADMAP §17.19)

**수평 교정은 자르기로 풀리지 않는다.** 실기에서 수평선이 −1.87° 기울어 있는 것을
재 놓고 고치지 못했다. `document.crop` 은 사각형을 덜어낼 뿐이다.

자르기를 합치지 않았다. 회전하면 빈 모서리가 생기지만, 합치면 "회전만 하고 구도는
직접 잡는다" 를 할 수 없다. 대신 **빈 영역이 한 픽셀도 안 들어오는 최대 직사각형**을
`safeBounds` 로 돌려준다 — `crop` 의 `bounds` 에 그대로 넘긴다. 계산은 서버가 한다.
호출자가 삼각함수를 맞게 쓰기를 기대하지 않는다.

`angle` 은 −45 ~ 45 다. 세로/가로를 바꾸는 도구가 아니고, **이 범위에서는 회전이
캔버스를 반드시 키우므로 "정말 돌았는가" 를 크기로 확인할 수 있다.** 180° 를 넣으면
크기가 그대로라 그 확인이 성립하지 않는다. 오류 없이 아무 일도 안 하는 경로는
이 프로젝트에서 이미 두 번 나왔다(배경 `set_opacity`, Camera Raw 정수).

**DOM 에 `rotate` 가 있는지 짐작하지 않았다 — 재 봤고, 있었다**(Photoshop 27.8).
`document.histogram` 때와 같은 방식으로 두 경로를 준비하고 `method` 로 답을 받았다.
답이 나온 뒤 **한 번도 실행되지 않은 batchPlay 경로는 지웠다.** 짐작으로 남겨 두면
그 경로가 처음 실행되는 날 그것이 맞는지 아무도 모른다.

부호는 **시계 방향 양수**다. 이것도 한 번 걸어 다시 재서 확인했다.

## 그룹은 어디에 생기는가 (ROADMAP §17.20)

`photoshop.group.create` 는 **기본적으로 최상위**에 만든다. 그룹 안에 만들려면
`parentId` 로 명시한다.

Photoshop 자체는 **활성 레이어가 있는 곳**에 만든다. 실기 보정에서 이것이 조용히
연쇄를 만들었다 — 그룹을 선택한 뒤 새 그룹을 만들었더니 그 안에 들어갔고, 마지막
조정 레이어는 세 겹 마스크에 갇혀 아무 데도 걸리지 않았다. **오류는 없었다.**

호출자가 "지금 활성 레이어가 어디 있는지" 를 추적해야 결과를 예측할 수 있는 API 는
조용히 틀린다. 그래서 기본을 위치에 의존하지 않는 쪽으로 두었다.

**검증은 만들기 전에 한다.** 처음에는 생성 뒤에 확인해서, 없는 `parentId` 를 주면
오류를 돌려주면서 그룹은 남았다.

`adjustment.*` 는 손대지 않았다. 활성 레이어 위에 쌓이는 것이 오히려 자연스럽고,
연쇄의 시작점은 `group.create` 였다.

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

`document.open` 은 승인된 폴더 안의 파일만 연다(ROADMAP §17.26). 저장과 같은 규칙이다 —
읽기라고 느슨하게 두면 어느 파일이든 가져와 캡처로 볼 수 있다.

**RAW 는 거절한다.** Camera Raw 대화상자가 떠 플러그인이 멈춘다. 대화상자는 이
프로젝트에서 세 번 반복된 실패 유형이다(§17.11 · §17.25 · §17.26). 열 수 있는
형식을 늘릴 때는 **실기에서 대화상자가 뜨지 않는 것을 확인한다.**

`alreadyOpen` 은 Photoshop 이 같은 파일을 두 번 열지 않고 기존 창을 활성화한다는
사실을 드러낸다. 편집 중이면 디스크의 것과 다르다.

`document.flatten` · `document.close` 를 만들었다(ROADMAP §17.25). 둘 다 `destructive` 다.

**평탄화는 숨긴 레이어를 버린다** — 합쳐지는 것이 아니다. 결과의 `hiddenDiscarded`
가 그것을 알린다. 보통은 평탄화 대신 `document.export` 를 쓴다.

**닫기는 언제나 저장하지 않는다.** 인자 없이 `close()` 하면 저장 여부를 묻는 창이
뜨고 **플러그인이 멈춘다** — §17.11 이 `window.capture` 를 만든 그 상황이다.
`SaveOptions.DONOTSAVECHANGES` 상수를 얻지 못하면 시험 삼아 부르지 않고 실패한다.
`discardChanges: true` 를 리터럴로 요구하며 기본값이 없다.

`layer.delete` 는 만들었다(ROADMAP §17.18). **id 를 명시하고 패턴을 받지 않는다** —
`workspace.delete` 와 같은 규칙이다. 지운 뒤 목록을 다시 읽어 **확인한 것만**
`deleted` 에 담고, 문서를 비우는 요청은 거절한다.

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

**배경 레이어는 편집을 세 가지로 다르게 받는다.** 실기에서 LLM 으로 테스트하다 잡았다.

| 편집 | Photoshop 동작 |
|---|---|
| `set_opacity` | **승격 또는 무시.** 아래 참조 |
| `rename` | 거부. 문서는 바뀌지 않는다 |
| `set_blend_mode` | 거부. 문서는 바뀌지 않는다 |

`set_opacity` 의 결과는 두 갈래다. 배경이 유일한 레이어면 **일반 레이어로 승격**되며
적용되고, 레이어가 둘 이상이면 **예외 없이 무시된다** — 값도 그대로다. 어느 쪽이 될지
Photoshop 이 무엇을 기준으로 정하는지는 모른다. 규칙을 짐작해 못 박지 않는다.

그래서 **쓴 값이 실제로 들어갔는지 확인한다.** 무시된 경우 성공으로 보고하면 호출자는
적용되었다고 믿는다 — 반환값에 옛 값이 담겨 있어도 성공/실패 신호를 먼저 읽는다.
비교는 `opacityApplied` 가 한다. Photoshop 이 0–255 로 저장하므로 정확히 비교하면
오탐이 난다.

승격이 위험하다. 레이어 객체가 통째로 교체되어 **원래 참조로 결과를 읽으면 던진다.**
변경은 이미 일어났는데 그 예외가 `COMMAND_FAILED` 로 올라가면 호출자는 아무 일도
없었다고 믿는다. 안 했다고 말하고 뭔가를 하는 것이 가장 나쁜 실패다.

`LayerInfo.isBackground` 로 이 사실을 드러낸다. **Photoshop 이 알려줄 때만 담는다** —
값을 얻지 못하면 필드가 아예 없다. 없는 것을 `false` 로 덮으면 "배경이 아니다" 라는
틀린 사실을 말하게 된다. (`rawBitDepth` · `rawKind` 와 같은 원칙)

`MockPhotoshopBridge` 도 승격을 흉내낸다. Mock 이 현실과 다르면 그 경로는 테스트에
영원히 나오지 않는다 — 이 버그가 실기에서만 드러난 이유가 그것이다.

그래서 속성을 바꾸는 Command 는 `mutate()` 로 감싼다 — 변경 **전에** id 목록을 떠 두고,
변경 뒤 "없던 id" 로 결과를 찾는다. (`photoshop-uxp/src/dom/mutation-result.ts`)
위치나 활성 레이어로 추정하지 않는다. 근거가 없으면 추측 대신 "변경은 적용되었지만
결과를 확인하지 못했습니다" 라고 말한다.

**`document.activeLayers` 는 배열이고 그 순서는 레이어 순서가 아니다.** 편집 Command 는
`layerId` 를 생략하면 `activeLayers[0]` 을 대상으로 삼는다. `photoshop.layer.get_active`
는 그 순서를 그대로 보고해야 한다 — 레이어 순서로 정렬했다가 실기에서 어긋났다.
보고는 id 14, 실제 편집은 id 13 이었다. 순서 규칙은
`photoshop-uxp/src/dom/active-order.ts` 에 떼어 두고 단위 테스트로 고정했다.

`batchPlay` 는 조정·마스크·선택·필터에 쓴다. DOM 에 API 가 없는 경우다.
descriptor 는 반드시 플러그인이 검증된 파라미터로 조립한다.
호출자가 descriptor 를 넘기는 통로를 만들지 않는다. (ARCHITECTURE §13, §23)

UXP 의 실기 제약은 [photoshop-uxp/README.md](photoshop-uxp/README.md) 에 정리되어 있다.
바꾸기 전에 그 문서를 먼저 읽는다.

**플러그인 적재는 UXP DevTools CLI 로 자동화할 수 있다.** 사람에게 Reload 를 부탁하지
않아도 된다. 설치에 Adobe 패키징 버그 우회가 필요하며 저장소 의존성에는 넣지 않았다 —
설치법과 `load` → `reload` 순서는 위 README 에 있다.

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

**Photoshop 알림은 동작한다 — `["all"]` 로 등록해야 한다.** (ROADMAP §17.17, §17.28)

한동안 "알림이 하나도 오지 않는다" 고 적어 두었는데 **틀렸다.** 그때는 이름 있는
이벤트로만 시험했다. §17.28 에서 `startNotifications` 를 `["all"]` 로 고쳤고
`photoshop.event.recent` 로 실제 수신을 확인했다. 아는 액션만 이름을 붙이고
나머지는 `photoshop.unknown` 으로 원본과 함께 나간다.

**이벤트 버퍼는 MCP 서버 프로세스에 있다.** 스크립트를 돌릴 때마다 새 서버가 떠서
버퍼가 빈다 — descriptor 를 잡으려면 서버를 띄워 둔 채로 사람이 메뉴를 실행해야 한다.

이것으로 Camera Raw 와 `autoCutout` 의 descriptor 를 잡아냈다. 막혀 있는 batchPlay
이름은 문서에서 가져오지 말고 이 방법으로 확인한다.

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
| `PHOTOSHOP_MCP_ACTIONS` | `<cwd>/actions.json` | 액션 허용 목록 |

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
