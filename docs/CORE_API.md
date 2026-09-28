# Photoshop MCP Core API

## 0. 이 문서의 위치

**Core API 목록이다.** `photoshop.*` namespace 에 무엇이 있고, 무엇이 아직 후보이며,
무엇을 의도적으로 넣지 않는지를 한 곳에서 본다.

기준이 되는 문서는 따로 있다.

| 무엇 | 어느 문서가 기준인가 |
|---|---|
| Phase 번호 · 범위 · 완료 여부 | `docs/ROADMAP.md` |
| 계층 구조 · 안전 원칙 | `docs/ARCHITECTURE.md` |
| **API 목록 · Permission · 이름** | 이 문서 |

**이 문서에 Phase 열을 두지 않는다.** 예전에는 API 마다 Phase 번호를 적어 두었는데,
ROADMAP 의 Phase 5 이후가 Extension SDK · Capability · Job 같은 인프라로 채워지면서
여기 적힌 "Phase 5 = Advanced Core" 가 통째로 틀린 값이 되었다. 두 문서가 같은 낱말에
다른 뜻을 담으면 둘 다 믿을 수 없게 된다. Phase 는 ROADMAP 이 혼자 관리한다.

대신 **구현 여부**를 적는다. 그것은 이 문서가 스스로 확인할 수 있는 사실이다.

§4 의 목록은 서버에 실제로 등록된 것이다. **`tests/core-api-doc.test.ts` 가 이 문서를
읽어 레지스트리와 대조한다** — 이름과 Permission 이 어긋나면 테스트가 깨진다.

그 테스트가 없는 동안 이 문서가 실제로 썩었다. Tool 이 13개 늘고 Permission 이 세 개
바뀌었는데 문서는 그대로였다. `docs/` 는 `.prettierignore` 에 있어 형식 검사도 지나가므로
사람이 읽기 전까지 알려주는 장치가 하나도 없었다.

---

## 1. 원칙

Core API 는 다음을 따른다.

- Photoshop 일반 기능만 포함한다
- 특정 사진 장르나 도메인 기능은 제외한다 (§7)
- 도메인 기능은 Extension 으로 구현한다 — `rcastro.*` · `starnet.*` · `portrait.*`
- 모든 API 는 `photoshop.*` namespace 를 쓴다
- 모든 API 는 Permission Level 을 **필수로** 선언한다

Extension 은 `photoshop.*` 에 Tool 을 등록할 수 없다. 이름이 겹치면 적재가 거부된다.

---

## 2. Permission

네 단계다. Tool 과 Command 양쪽에서 **필수 필드**다. 선택 필드로 두면 새로 추가한
것이 조용히 관대한 값을 갖는다.

| Level | 의미 |
|---|---|
| `READ` | Photoshop 상태 조회. 아무것도 바꾸지 않는다 |
| `EDIT` | 비파괴 편집. Photoshop 안에서만 일어난다 |
| `EXTERNAL` | Photoshop 밖으로 나간다 — 파일 쓰기·읽기, 외부 프로세스 |
| `DESTRUCTIVE` | 덮어쓰기·삭제·병합. 되돌릴 수 없다 |

기본 허용은 `READ` · `EDIT` 뿐이다. `PHOTOSHOP_MCP_ALLOW` 로 바꾸며, 값을 주면 그것이
전체 목록이다 — 기본값에 더하지 않는다.

**강제 지점은 Command Engine 이다.** Extension 은 Tool 을 거치지 않고 Command 를 직접
호출하기 때문이다. Tool 의 Level 은 `tools/list` 메타데이터이자 빠른 실패용이다.

### EXTERNAL 과 EDIT 의 경계

처음에는 `save_as` · `export` 를 EDIT 으로 적어 두었다. 파일을 쓰는 것뿐이니
파괴적이지 않다고 본 것이다. 그러나 **경계를 넘는지**가 기준이어야 했다.

- `save_as` · `export` — 승인된 폴더로 나간다 → `EXTERNAL`
- `layer.place` — 승인된 폴더에서 들어온다 → `EXTERNAL` (읽기여도 경계를 넘는다)
- `save` — 원본을 덮어쓴다 → `DESTRUCTIVE`
- `window.capture` — **사용자의 화면**을 읽는다 → `EXTERNAL`

덮어쓰지 않는 것과 덮어쓰는 것을 나눠 놓았기 때문에 `save_as` 와 `export` 를
`EXTERNAL` 로 둘 수 있다. 덮어쓰기는 `save` 하나에 모았다.

`window.capture` 가 같은 기준의 다른 방향이다. 문서를 찍는 캡처 셋은 `READ` 지만
이것은 Photoshop 창 — 파일 경로, 최근 문서 목록, 계정 이름, 떠 있는 대화상자가
함께 찍힌다. **무엇을 찍느냐가 아니라 어디까지 보이느냐**가 경계다.

---

## 3. 우선순위

후보 API 에만 붙인다. 구현된 것에는 의미가 없다.

```text
P0  MVP 핵심
P1  실사용 필수
P2  고급 편집
P3  확장 기능
```

권장 구현 순서는 `P0 → P1 → P2 → 실사용 검증 → P3` 다. P3 까지 한 번에 구현하지 않는다.

---

## 4. 구현된 Core API (86개)

서버에 등록되어 있고 `tools/list` 에 나온다.

### 4.1 조회

| API | Permission | 비고 |
|---|---|---|
| `photoshop.ping` | READ | 서버 상태와 Bridge 연결 여부 |
| `photoshop.host.get` | READ | 버전 + **이 서버가 쓰는 API 의 유무**. 문서 없으면 `document.*` 는 `null` |
| `photoshop.document.list` | READ | 열린 문서 전체. **`active` 를 함께 준다.** 없으면 빈 배열 |
| `photoshop.document.create` | EDIT | 새 문서. **`applied` 로 요청값이 들어갔는지 확인한다** |
| `photoshop.document.get` | READ | 활성 문서 정보 |
| `photoshop.layer.list` | READ | 활성 문서의 레이어 목록 |
| `photoshop.layer.get` | READ | 한 레이어의 상세. **`bounds` 를 준다** — 목록에는 없다 |
| `photoshop.layer.select_multiple` | EDIT | 여러 장을 한 번에. **순서는 Photoshop 이 정한다** |
| `photoshop.document.capture` | READ | 문서를 합성해 **그림으로** 돌려준다 |
| `photoshop.layer.capture` | READ | 레이어 하나만 그림으로 |
| `photoshop.selection.capture` | READ | 선택 영역(경계 상자)을 그림으로 |
| `photoshop.layer.get_active` | READ | 지금 선택된 레이어. `layers` 에 전부, `layer` 에 첫 번째 |
| `photoshop.document.statistics` | READ | 히스토그램·채널 통계·**노이즈 σ**. 전체 해상도 원본에서 |

노이즈 σ 는 **평탄한 영역에서** 재야 한다. 나뭇잎처럼 촘촘한 질감은 노이즈와
구분되지 않으므로 `region: selection` 으로 하늘 같은 곳을 좁혀 지정한다.

캡처와 통계는 **짝이다.** 캡처는 보고, 통계는 잰다. 구도·마스크 경계·전체 인상은
봐야 잡히고, 어두운 영역의 색 편향·미세한 캐스트·작은 클리핑은 재야 잡힌다.
(RETOUCH_PROCESS §4.3)

### 4.1.1 구도

| API | Permission | 비고 |
|---|---|---|
| `photoshop.document.crop` | EDIT | 캔버스를 줄인다. **픽셀은 버리지 않는다** |
| `photoshop.document.rotate` | EDIT | 문서 전체를 돌린다. **수평 교정용** |
| `photoshop.document.open` | EXTERNAL | 승인된 폴더의 파일을 연다. **RAW 는 거절한다** |
| `photoshop.document.flatten` | DESTRUCTIVE | 하나로 합친다. **숨긴 레이어는 버려진다** |
| `photoshop.document.close` | DESTRUCTIVE | 닫는다. **저장하지 않는다** |
| `photoshop.measure.tilt` | READ | 경계선 기울기. **각도와 잔차를 함께 준다** |

`bounds` 는 **남길** 영역이다. 문서 밖으로 나가면 거부한다 — 캔버스를 넓히는 것은
자르기가 아니고, 조용히 넓혀 주면 호출자는 잘린 줄 안다.

`delete: false` 로 실행하므로 바깥 픽셀이 레이어에 남는다. 그래서 `DESTRUCTIVE` 가
아니라 `EDIT` 이다 — 되돌릴 수 있고 잃는 것이 없다. 대신 파일 크기는 줄지 않으며
결과의 `pixelsRetained` 가 그 사실을 알린다.

버리는 자르기를 옵션으로 두지 않았다. **파라미터 하나로 Permission 이 올라가면
정적 선언이 거짓이 된다** — §2 가 Permission 을 필수 정적 필드로 둔 이유다.

`rotate` 의 `angle` 은 도 단위이고 **시계 방향이 양수**다. 범위는 −45 ~ 45 이며
0 은 거부한다. 세로/가로를 바꾸는 도구가 아니라 기울어진 수평선을 세우는 도구다.
자르기로는 절대 풀리지 않는 종류의 문제다.

회전하면 캔버스가 커지고 모서리에 빈 영역이 생긴다. 결과의 `safeBounds` 가
**빈 영역이 한 픽셀도 들어오지 않는 최대 직사각형**(원본 종횡비 유지)이며
`crop` 의 `bounds` 에 그대로 넘긴다. 계산은 서버가 한다 — 호출자가 삼각함수를
맞게 쓰기를 기대하지 않는다.

자르기를 합치지 않았다. 합치면 "회전만 하고 구도는 직접 잡는다" 를 할 수 없다.

픽셀을 **재보간**하므로 자르기보다 무겁지만 `EDIT` 이다. History 로 되돌아가고,
`DESTRUCTIVE` 로 올리면 기본 허용 밖이라 **기본 설정에서 수평 교정이 막힌다.**
다만 재보간은 반복하면 쌓이므로 각도를 나눠 여러 번 부르지 않는다.

범위를 −45 ~ 45 로 좁힌 데에는 이유가 하나 더 있다. 이 범위에서는 회전이 캔버스를
**반드시** 키우므로 플러그인이 "정말 돌았는가" 를 크기 변화로 확인할 수 있다.
180° 를 허용하면 크기가 그대로라 그 확인이 성립하지 않는다.

`measure.tilt` 가 `rotate` 의 **입력을 만든다.** `bounds` 안의 경계선을 열(또는 행)
마다 서브픽셀로 찾아 Theil-Sen 으로 기울기를 낸다. 부호 규약이 같으므로 잰 값의
부호를 뒤집어 `rotate` 에 넘긴다.

**각도만 돌려주지 않는다.** 실기에서 세 번 쟀고 두 번은 돌리지 않는 것이 답이었다 —
경계가 직선이 아니었기 때문이고, 그것을 가른 것은 각도가 아니라 `residualIqr` 이다.
세 번 다 그럴듯한 각도가 나왔다.

`reliable` 같은 판정은 담지 않는다. 임계가 영역 크기에 따라 달라지기 때문이다.
대신 `spanPixels` · `risePixels` 를 함께 주어 잔차를 **경계가 실제로 오르내린
높이와 견주어** 읽게 한다.

Mock Bridge 는 픽셀을 읽지 않으므로 **실패한다.** 그럴듯한 각도를 지어내면 Mock 으로
돌린 워크플로가 엉뚱한 회전을 하고 그것이 성공으로 보인다.

`flatten` 은 조정 레이어를 굽고 투명 영역을 배경색으로 채운다. **숨긴 레이어는
합쳐지는 것이 아니라 버려지므로** 결과의 `hiddenDiscarded` 를 확인한다.

보통은 평탄화하지 않고 `document.export` 를 쓴다 — 사본을 만들 뿐 원본 레이어를
건드리지 않는다. 평탄화가 필요한 경우는 **그 상태로 저장해야 할 때**다.

`close` 는 **언제나 저장하지 않고 닫는다.** `discardChanges: true` 를 명시해야 하며
기본값이 없다 — 작업을 잃는 선택이기 때문이다. 저장하려면 `document.save` 나
`save_as` 를 먼저 부른다.

인자 없이 닫으면 Photoshop 이 저장 여부를 묻는 창을 띄우고 **플러그인이 멈춘다.**
§17.11 이 `window.capture` 를 만든 이유가 그 상황이었다. 그래서 상수를 얻지 못하면
인자 없이 부르지 않고 실패한다.

`remainingDocuments` 가 0 이면 이후 Command 가 전부 `DOCUMENT_NOT_FOUND` 로 실패한다.

`open` 은 **승인된 작업 폴더 안**으로 가둔다. 저장과 같은 규칙이다 — 호출자는
폴더를 고를 수 없고 파일 이름만 준다. 읽기라고 느슨하게 두지 않았다: 임의 경로를
열 수 있으면 사용자의 어느 파일이든 Photoshop 으로 가져와 캡처로 볼 수 있다.

열 수 있는 형식은 `psd` · `psb` · `tif` · `tiff` · `png` · `jpg` · `jpeg` 다.
**카메라 RAW 는 거절한다** — Camera Raw 대화상자가 떠 플러그인이 멈춘다.
RAW 의 현상 설정은 슬라이더를 보며 정하는 일이라 사람이 직접 여는 편이 맞다.

`alreadyOpen` 이 `true` 면 그 파일이 이미 열려 있어 **디스크에서 다시 읽은 것이
아니라 기존 창이 활성화된 것**이다. 편집 중인 내용이 있으면 디스크의 것과 다르다.

### 4.1.2 결함 제거

| API | Permission | 비고 |
|---|---|---|
| `photoshop.retouch.remove_spots` | EDIT | 센서 먼지·잡티. **배경 레이어는 거절한다** |
| `photoshop.dodge_burn.dab` | EDIT | 부드러운 원형 얼룩. **softLight 빈 레이어에 칠한다** |
| `photoshop.paint.dab` | EDIT | 지정한 색 얼룩. 배경은 거절한다 |

### 4.2.1 텍스트

워터마크·서명 범위다. 자간·행간·단락·변형은 §5.12 에 남겨 두었다.

| API | Permission | 비고 |
|---|---|---|
| `photoshop.text.create` | EDIT | 내용·위치·폰트·크기·색·불투명도·정렬 |
| `photoshop.text.set` | EDIT | 기존 텍스트 레이어 수정. **텍스트가 아니면 거절** |
| `photoshop.font.list` | READ | **`postScriptName` 이 `font` 에 넣을 값** |

### 4.2.2 액션

**실행은 사용자가 Photoshop 패널에서 고른 것만** 된다 — 액션은 내용을 알 수 없고
실기 목록에 이미 `내보내기 > PSD로 저장` 이 있었다. 그래서 `run` 은 `DESTRUCTIVE` 다.

설정 파일을 쓰지 않는다. 액션은 Photoshop 안에 있고 고를 수 있는 것은 사용자뿐이라,
작업 폴더 승인(§8.5)과 같이 **패널에서 고르고 플러그인이 보관한다.**

| API | Permission | 비고 |
|---|---|---|
| `photoshop.action.list` | READ | **두 단계** — `set` 없으면 세트만, 있으면 그 세트의 액션 |
| `photoshop.action.declared` | READ | **사용자가 패널에서 고른** 부를 수 있는 것 |
| `photoshop.action.run` | DESTRUCTIVE | 고른 것만. `set`+`action`. **내용을 알 수 없다** |


| `photoshop.camera_raw.apply` | EDIT | Camera Raw 필터. **Tool 은 이 하나뿐이다** |

지점마다 타원으로 선택해 내용 인식 채우기를 건다. `spots` 로 여러 개를 한 번에 받는다.

**배경을 거절하는 것이 이 API 의 핵심 성질이다.** 이것은 원본 촬영 픽셀을 지우는
것이 목적인 유일한 Command 다 — 필터는 효과를 입히지만 먼지 제거는 있던 것을 없앤다.
`layer.duplicate` 로 복제한 뒤 그 레이어를 지정한다. 막으면서 그 방법을 함께 말한다.

배경을 막아 두었으므로 여기서 사라지는 것은 **이미 사본인 레이어**의 픽셀이고,
필터와 같은 급의 `EDIT` 이다.

### 4.2 레이어

| API | Permission | 비고 |
|---|---|---|
| `photoshop.layer.create` | EDIT | 픽셀 레이어 |
| `photoshop.layer.duplicate` | EDIT | |
| `photoshop.layer.rename` | EDIT | |
| `photoshop.layer.select` | EDIT | 활성 레이어 지정 |
| `photoshop.layer.set_visibility` | EDIT | |
| `photoshop.layer.set_opacity` | EDIT | 0–100 |
| `photoshop.layer.set_blend_mode` | EDIT | normal · multiply · screen · overlay · softLight 등 |
| `photoshop.layer.from_background` | EDIT | 배경 → 일반 레이어. id 가 바뀐다 |
| `photoshop.layer.stamp_visible` | EDIT | 보이는 레이어를 합친 복제본 |
| `photoshop.smart_object.convert` | EDIT | 스마트 필터를 걸 수 있게 만든다. **id 가 바뀐다** |
| `photoshop.layer.delete` | DESTRUCTIVE | **id 를 명시한다.** 패턴을 받지 않는다 |

`layerId` 를 생략하면 활성 레이어를 대상으로 한다. 그것이 무엇인지는
`photoshop.layer.get_active` 로 미리 확인한다.

### 4.3 그룹

| API | Permission | 비고 |
|---|---|---|
| `photoshop.group.create` | EDIT | `layerIds` 를 주면 그 레이어들을 넣는다. **기본 위치는 최상위** |
| `photoshop.group.move_layer` | EDIT | `groupId: null` 이면 그룹에서 꺼낸다 |
| `photoshop.layer.reorder` | EDIT | 순서 변경. **같은 부모 안에서만** |

`reorder` 와 `group.move_layer` 는 역할이 다르다. `reorder` 의 `top` · `bottom` ·
`up` · `down` 은 **형제들 사이의 순서만** 바꾸고 그룹 경계를 넘지 않는다. 그룹을
넘나드는 이동은 `group.move_layer` 가 한다.

Photoshop UI 는 그룹 끝에서 한 번 더 누르면 밖으로 나간다. 그 동작을 흉내내지
않았다 — 호출자가 "지금 그룹의 몇 번째인지" 를 알아야 결과를 예측할 수 있게 되고,
§17.20 에서 겪은 것과 같은 종류의 조용한 놀라움이 된다.

`above` · `below` 는 기준 레이어 옆으로 가므로 **부모가 바뀔 수 있다.** 그 사실은
결과의 `parentId` 에 드러난다.

맨 위 레이어에 `up` 을 주는 것은 오류가 아니다. `moved: false` 로 **무슨 일이
있었는지 말한다** — 오류로 두면 호출자가 매번 현재 위치를 확인해야 하고, 조용히
성공을 돌려주면 움직였다고 믿는다.

`index` · `siblings` 는 요청이 아니라 옮긴 뒤 실제로 읽은 값이다. 0 이 맨 위다.

### 4.4 조정 레이어

| API | Permission | 비고 |
|---|---|---|
| `photoshop.adjustment.curves` | EDIT | `{input, output}` 제어점 |
| `photoshop.adjustment.levels` | EDIT | 입력/출력 검은점·흰점, 감마 |
| `photoshop.adjustment.brightness_contrast` | EDIT | −150~150 / −50~100 |
| `photoshop.adjustment.hue_saturation` | EDIT | hue −180~180 |
| `photoshop.adjustment.vibrance` | EDIT | vibrance · saturation −100~100 |
| `photoshop.adjustment.color_balance` | EDIT | 구간별 `[C↔R, M↔G, Y↔B]` |

**전부 조정 레이어로 만든다.** 픽셀을 직접 고치지 않는다. 그래서 EDIT 이다.

### 4.5 마스크 · 선택

| API | Permission | 비고 |
|---|---|---|
| `photoshop.mask.create` | EDIT | `from`: revealAll · hideAll · **fromSelection** |
| `photoshop.mask.enable` | EDIT | |
| `photoshop.mask.dab` | EDIT | 마스크에 얼룩을 **더한다**. 조정 레이어에도 쓴다 |
| `photoshop.mask.disable` | EDIT | 마스크를 지우지 않고 해제만 한다 |
| `photoshop.mask.gradient` | EDIT | 마스크에 그라디언트. **linear · radial**. 마스크가 있어야 한다 |
| `photoshop.mask.apply` | DESTRUCTIVE | 마스크를 픽셀에 굽고 없앤다. **가려 둔 것이 사라진다** |
| `photoshop.selection.set` | EDIT | `shape`: rectangle · ellipse · **canvas** · layerTransparency |
| `photoshop.selection.sky` | EDIT | Photoshop 의 `선택 > 하늘` |
| `photoshop.selection.subject` | EDIT | Photoshop 의 `선택 > 피사체`. **형태**로 잡는다 |
| `photoshop.selection.clear` | EDIT | |
| `photoshop.selection.invert` | EDIT | 선택이 없으면 실패한다 |
| `photoshop.selection.modify` | EDIT | feather · expand · contract · smooth |
| `photoshop.selection.color_range` | EDIT | 광도 **구간** 선택. 임계 기반이라 거의 이진이다 |
| `photoshop.selection.luminosity` | EDIT | 합성 휘도를 선택으로. **이것이 광도 마스크다.** `invert` 로 Darks |
| `photoshop.selection.save_channel` | EDIT | 선택을 알파 채널로 저장 |
| `photoshop.selection.load_channel` | EDIT | 채널에서 불러오기. `invert` 로 반전 |

`mask.gradient` 는 **기존 마스크 내용을 덮어쓴다.** 선택 영역에서 받은 마스크 위에
그리면 그 제한이 사라진다.

`type` 은 `linear`(기본) 과 `radial` 이다. **`radial` 에서는 `from` 이 중심이고
`from`→`to` 거리가 반지름**이며 `to` 의 방향은 무시된다. 기본은 중심이 검은색이라
광원 쪽을 강하게 주려면 `reverse` 가 필요하다.

빛 공해처럼 광원에서 **2차원으로** 감쇠하는 것에는 `radial` 이 맞다. 선형 마스크를
가로·세로로 겹쳐도 모서리는 구조적으로 남는다 — 실기에서 중간 행은 ±1레벨로 맞았는데
모서리가 ±8 남았고, 그룹 마스크를 곱해 우회하느라 조정 레이어가 넷 더 들었다.

Photoshop 의 방사형은 중심에서 반지름까지 **선형 보간**이다. 실제 대기 산란 모델은
아니지만 선형 그라디언트보다는 가깝다.

`angle` · `reflected` · `diamond` 는 넣지 않았다. 쓸 자리를 아직 만나지 못했고,
모르는 값은 조용히 `linear` 로 떨어뜨리지 않고 **거절한다.**

### 4.6 필터

**기본은 픽셀에 직접 적용한다.** Photoshop 자신의 동작과 같다 — 필터를 걸면 픽셀에
적용되고, 스마트 필터는 `필터 > 고급 필터용으로 변환` 을 명시적으로 고를 때만이다.

기본으로 변환하면 호출자가 요청하지 않은 일을 한다. 레이어가 스마트 오브젝트로
바뀌고 **id 와 type 이 달라져 호출자가 추적을 놓친다** — 실기 한 번에 id 가 세 번
바뀌었다. 비파괴는 `layer.duplicate` 로 얻는 것이 의도가 드러나고 더 싸다.

`asSmartFilter: true` 는 **재편집 가능한 필터가 필요할 때** 고른다.
조정 레이어와 그룹에는 어느 쪽이든 적용할 수 없다.

| API | Permission | 비고 |
|---|---|---|
| `photoshop.filter.gaussian_blur` | EDIT | radius 0.1–1000. 기본은 픽셀 직접 적용 |
| `photoshop.filter.high_pass` | EDIT | 가장자리만 남긴다. softLight 혼합과 함께 쓴다 |
| `photoshop.filter.minimum_maximum` | EDIT | 밝은 영역 축소·확장. 별 축소에 쓴다 |

### 4.7 History

| API | Permission | 비고 |
|---|---|---|
| `photoshop.history.undo` | EDIT | |

History **조회**는 Tool 이 아니라 `photoshop://history` Resource 다. (§6)

### 4.8 파일

| API | Permission | 비고 |
|---|---|---|
| `photoshop.workspace.status` | READ | 작업 폴더 승인 여부 |
| `photoshop.workspace.usage` | READ | 파일과 총 용량을 큰 것부터 |
| `photoshop.document.save_as` | EXTERNAL | psd · psb. 레이어 유지. **덮어쓰지 않는다** |
| `photoshop.document.export` | EXTERNAL | png · jpg · tiff. 평탄화. tiff 는 16비트 유지 |
| `photoshop.selection.export_mask` | EXTERNAL | 선택 영역을 16비트 TIFF 마스크로. 흰색=선택 안 |
| `photoshop.layer.place` | EXTERNAL | 승인 폴더의 파일을 스마트 오브젝트로. `rasterize` 로 픽셀 |
| `photoshop.document.save` | DESTRUCTIVE | 원본 덮어쓰기 |
| `photoshop.workspace.delete` | DESTRUCTIVE | **이름을 명시한** 파일만. 패턴을 받지 않는다 |

작업 폴더는 **사용자가 플러그인 패널 버튼으로 승인한다.** UXP 의 `getFolder()` 가 사용자
제스처를 요구해서 서버가 대신할 수 없다. 제약이자 안전장치다 — LLM 은 폴더를 고를 수
없고 파일 이름만 준다. 경로 구분자와 `..` 는 스키마가 거부한다.

### 4.9 외부 처리기 · 긴 작업 · 워크플로

| API | Permission | 비고 |
|---|---|---|
| `photoshop.capability.list` | READ | 설정된 외부 처리기와 사용 가능 여부 |
| `photoshop.job.status` | READ | 즉시 반환한다. 완료를 기다리지 않는다 |
| `photoshop.job.list` | READ | 최신순 |
| `photoshop.job.cancel` | EDIT | 외부 프로세스를 실제로 종료한다 |
| `photoshop.workflow.list` | READ | 선언된 Tool 순서 |
| `photoshop.workflow.run` | EXTERNAL | **즉시 jobId 를 반환한다** |

Capability **실행** Tool 은 만들지 않는다. 외부 처리기 실행은 `내보내기 → 처리 →
가져오기` 흐름의 가운데 토막이고, 그 흐름을 아는 것은 Extension 이다. LLM 이 가운데만
직접 부르면 앞뒤가 빠진다.

MCP 기본 요청 타임아웃은 60초다. 외부 처리기는 그보다 오래 걸린다 — 실측에서
StarNet2 가 67초였다. 그래서 오래 걸리는 Tool 은 **짧게 끝나도** jobId 를 돌려준다.
반환 타입이 상황에 따라 달라지면 호출자가 매번 판단해야 한다.

### 4.10 진단 · 이벤트

| API | Permission | 비고 |
|---|---|---|
| `photoshop.diagnostics` | READ | 막힌 이유와 **고치는 방법**을 함께 준다 |
| `photoshop.event.recent` | READ | `command.*` 는 신뢰할 수 있다. `photoshop.*` 는 §6 참조 |
| `photoshop.window.capture` | EXTERNAL | Photoshop **창**을 찍는다. Windows 전용 |

무언가 안 되면 `photoshop.diagnostics` 를 먼저 부른다.

`window.capture` 는 `diagnostics` 가 답하지 못하는 하나를 답한다 — **대화상자가 떠서
Photoshop 이 명령을 못 받는 상태.** 그때는 Bridge 가 응답하지 않으므로 Photoshop 에게
물어볼 방법 자체가 없다. 창을 밖에서 찍는 것이 유일한 길이다.

보정 결과 확인용이 아니다. 그건 §4.1 의 캡처 셋이다.

---

## 5. 후보 API

아직 구현하지 않았다. **여기 있다고 만들기로 한 것은 아니다** — 필요가 확인되면
ROADMAP 에 Phase 를 잡고 옮긴다.

Permission 은 구현 시점의 예정값이며, §2 의 경계 규칙이 최종 판단이다.

### 5.1 Document

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.document.duplicate` | P2 | EDIT | |
| `photoshop.document.mode_convert` | P2 | EDIT | RGB · CMYK · Lab |
| `photoshop.document.bit_depth_convert` | P2 | EDIT | 8 · 16 · 32 |

### 5.2 Layer

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.layer.set_fill_opacity` | P1 | EDIT | |
| `photoshop.layer.lock` | P2 | EDIT | |
| `photoshop.layer.unlock` | P2 | EDIT | |
| `photoshop.layer.place_linked` | P3 | EXTERNAL | 연결된 스마트 오브젝트 |
| `photoshop.layer.delete` | P2 | DESTRUCTIVE | |
| `photoshop.layer.merge` | P2 | DESTRUCTIVE | |
| `photoshop.group.ungroup` | P2 | DESTRUCTIVE | 그룹이 사라진다 |

### 5.3 Mask

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.mask.invert` | P1 | EDIT | |
| `photoshop.mask.select` | P1 | EDIT | 마스크를 편집 대상으로 |
| `photoshop.mask.link` | P2 | EDIT | |
| `photoshop.mask.unlink` | P2 | EDIT | |
| `photoshop.mask.delete` | P2 | DESTRUCTIVE | |

### 5.4 Selection

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.selection.from_layer` | P2 | EDIT | 레이어 투명도에서 |

### 5.5 Adjustment

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.adjustment.exposure` | P2 | EDIT | |
| `photoshop.adjustment.black_white` | P2 | EDIT | |
| `photoshop.adjustment.photo_filter` | P2 | EDIT | |
| `photoshop.adjustment.channel_mixer` | P2 | EDIT | |

모두 조정 레이어로 만든다. 픽셀 직접 수정은 하지 않는다.

### 5.6 Filter

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.filter.sharpen` | P2 | EDIT | |
| `photoshop.filter.smart_sharpen` | P2 | EDIT | |
| `photoshop.filter.motion_blur` | P2 | EDIT | |
| `photoshop.filter.surface_blur` | P2 | EDIT | |
| `photoshop.filter.noise_reduce` | P2 | EDIT | |
| `photoshop.filter.noise_add` | P3 | EDIT | |
| `photoshop.filter.dust_scratches` | P3 | EDIT | |

### 5.7 Transform · Geometry

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.image.resize` | P1 | EDIT | |
| `photoshop.canvas.resize` | P2 | EDIT | |
| `photoshop.crop` | P2 | EDIT | |
| `photoshop.transform.scale` | P2 | EDIT | |
| `photoshop.transform.rotate` | P2 | EDIT | |
| `photoshop.transform.flip_horizontal` | P2 | EDIT | |
| `photoshop.transform.flip_vertical` | P2 | EDIT | |
| `photoshop.transform.free_transform` | P2 | EDIT | |
| `photoshop.transform.perspective` | P3 | EDIT | |
| `photoshop.transform.skew` | P3 | EDIT | |

### 5.8 Smart Object

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.smart_object.get_info` | P2 | READ | |
| `photoshop.smart_object.replace_contents` | P2 | EXTERNAL | 파일을 읽는다 |
| `photoshop.smart_object.open_contents` | P2 | EDIT | |
| `photoshop.smart_object.relink` | P3 | EXTERNAL | |
| `photoshop.smart_object.update` | P3 | EDIT | |
| `photoshop.smart_object.new_via_copy` | P3 | EDIT | |
| `photoshop.smart_object.rasterize` | P2 | DESTRUCTIVE | 아래 참조 |

`smart_object.rasterize` 가 `DESTRUCTIVE` 인 이유는 **되돌릴 수 없기 때문**이다 —
스마트 오브젝트 안의 원본이 사라진다. 그래서 **만들지 않는 쪽이 지우는 것보다 낫다.**
외부 처리기가 구워 돌려준 결과처럼 다시 편집할 원본이 없는 경우는
`layer.place` 의 `rasterize` 로 애초에 픽셀 레이어로 가져온다 — 중간에 스마트
오브젝트가 생기지 않으므로 잃을 것도 없고 `EXTERNAL` 로 충분하다.

### 5.9 Channel

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.channel.list` | P2 | READ | |
| `photoshop.channel.get` | P2 | READ | |
| `photoshop.channel.create` | P2 | EDIT | |
| `photoshop.channel.select` | P2 | EDIT | |
| `photoshop.channel.load_as_selection` | P2 | EDIT | |
| `photoshop.channel.duplicate` | P3 | EDIT | |
| `photoshop.channel.delete` | P3 | DESTRUCTIVE | |

### 5.10 History

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.history.redo` | P1 | EDIT | |
| `photoshop.history.create_snapshot` | P3 | EDIT | |
| `photoshop.history.restore_snapshot` | P3 | EDIT | |

### 5.11 Host · 환경

| API | 우선순위 | Permission | 비고 |
|---|---|---|---|
| `photoshop.preferences.get` | P3 | READ | |
| `photoshop.units.get` | P3 | READ | |
| `photoshop.color.get_foreground_background` | P3 | READ | |

### 5.12 Text · Shape · Path · Guide · Metadata

전부 P3 다. 실제 요구가 확인된 뒤에 연다. 지금은 이름만 잡아 둔다.

```text
photoshop.text.get · set_tracking · set_leading · set_paragraph · warp
   (create · set · font.list 은 §4.2.1 에서 열었다 — 워터마크·서명 범위)

photoshop.shape.rectangle · ellipse · line · set_fill · set_stroke
                            set_stroke_width · convert_to_path

photoshop.path.list · get · create · select · to_selection · delete(DESTRUCTIVE)

photoshop.guide.list · create · delete(DESTRUCTIVE)
photoshop.ruler.get_units · set_units

photoshop.metadata.get · set
photoshop.file.reveal
```

---

## 6. Tool 이 아닌 것 — Resource

Tool 은 **행동**이고 Resource 는 **맥락**이다. 다음은 Tool 로 만들지 않았다.
클라이언트가 미리 읽어 대화에 붙일 수 있고, LLM 이 매번 Tool 을 부르지 않아도 된다.

```text
photoshop://document/current
photoshop://layers
photoshop://selection
photoshop://history
photoshop://capabilities
photoshop://extensions
```

읽을 때마다 실제 상태를 조회하며 캐시하지 않는다. 문서를 바꾸는 Command 가 끝나면
`notifications/resources/updated` 로 구독자에게 알린다.

그래서 후보 목록에 `selection.get` · `history.get` 이 없다. **이미 있고, Resource 다.**

Photoshop 쪽 변경 알림(`photoshop.*` 이벤트)은 이 환경에서 동작하지 않는다. API 는
있고 등록도 성공하는데 알림이 오지 않는다. 원인을 찾지 못했고 추측으로 코드를
더 넣지 않았다. `command.*` 만 신뢰할 수 있다.

---

## 7. Core 에 넣지 않는 것

도메인 기능은 Extension 이다. Core 는 Photoshop 을 알고, Extension 은 작업 도메인을 안다.

```text
은하수 보정 · 별 분리 · 그래디언트 제거 · 하늘/전경 분리
인물 피부 보정 · 주파수 분리 · 제품 배경 정리 · 풍경 하늘 강조
```

Extension namespace 예: `rcastro.*` · `starnet.*` · `portrait.*` · `landscape.*`

다음은 Core API 가 아니라 고수준 워크플로 또는 Extension 으로 본다.

```text
Remove Background · Generative Fill · Neural Filters
Camera Raw · Auto Retouch · Auto Color Grade
```

Core 에서는 가능한 한 저수준 기능만 제공한다.

### `Select Sky` 는 여기 있었는데 잘못이었다

**Photoshop 메뉴에 있는 네이티브 명령**이다. 내부적으로 Adobe 의 모델을 쓰지만
호출하는 쪽에서는 Gaussian Blur 와 다를 바 없는 batchPlay 명령 하나이고, 외부
프로그램도 플러그인도 필요 없다. Core 의 기준은 "Photoshop 일반 기능인가" 이며
이 둘은 그 기준을 만족한다. `Remove Background` 나 `Generative Fill` 과 같은
칸에 둔 것이 분류 착오였다.

이 착오의 대가가 컸다. 천체사진 워크플로를 LLM 으로 시험하다 하늘/전경을 나누는
단계에서 막혔고, 사각형으로 근사할 수밖에 없었다. 실제 지평선은 직선이 아니므로
그 결과는 쓸모가 없다. 뒤따르는 네 단계가 전부 의미를 잃었다.

`선택 > 피사체` 도 같은 이유로 Core 에 속한다. **§17.28 에서 구현했다.**

한동안 여기에 "`autoCutout` descriptor 가 거부된다" 고 적혀 있었다.

```text
조정 레이어 활성:  "피사체 선택" 명령은 현재 사용할 수 없습니다.
픽셀 레이어 활성:  "피사체 선택" 명령의 매개 변수는 현재 유효하지 않습니다.
             (sampleAllLayers: false 를 줘도, 빼도 같다)
```

**이름은 처음부터 맞았다.** 알림을 `["all"]` 로 받아 메뉴 실행을 캡처하니
`autoCutout { sampleAllLayers: false }` 그대로였다. 틀린 것은 **부르는 자리**였다 —
`executeAsModal` 안에서는 거부된다. 이 Command 만 `runModal` 을 쓰지 않는다.

"파라미터가 유효하지 않다" 는 메시지가 파라미터를 가리킨 것이 아니었다.
문서에서 이름을 가져다 쓰고 오류 문구를 그대로 믿은 것이 막힌 이유였다.

### 실제로 그렇게 됐는가

됐다. `extensions/starnet`(별 분리) · `extensions/rcastro`(선명화·노이즈·별 분리) ·
`extensions/graxpert`(그래디언트 제거)가 Core Tool 과 Capability 만 조합해 구현한다.
Core 에 천체사진 코드가 한 줄도 없다.

처음에는 `extensions/milkyscape` 하나가 셋을 다 했는데, 도구별로 쪼갰다 —
그 도구를 쓰는 사람에게만 Tool 이 보여야 한다 (ROADMAP §18.3).

반대로 `create_sky_mask` 는 **범위에서 뺐다.** 기존 패널이 하늘 마스크를 만들지 않고
사용자가 만든 것을 소비한다는 것을 확인했기 때문이다. 짐작으로 알고리즘을 만들지 않는다.

---

## 8. 이름 규칙과 정리 기록

기본 형식은 `photoshop.<domain>.<action>` 이다. 권장 verb:

```text
get · list · create · delete · set_* · select · duplicate · move · enable · disable · apply
```

이 문서를 정리하면서 아래 충돌을 해결했다. 남겨 두면 같은 기능에 이름이 둘이 되고,
나중에 어느 쪽이 맞는지 알 수 없게 된다.

| 예전 이름 | 결론 | 이유 |
|---|---|---|
| `file.place_embedded` | → `layer.place` | 구현된 이름을 쓴다. 결과가 레이어이므로 도메인도 layer 가 맞다 |
| `file.place_linked` | → `layer.place_linked` | 위와 같은 도메인으로 맞춘다 |
| `active_layer.get` | 삭제 | `layer.get_active` 와 같은 기능. `active_layer` 는 도메인이 아니다 |
| `active_document.get` | 삭제 | `document.get` 이 이미 활성 문서를 반환한다 |
| `capabilities.get` | → `host.get` | `capability.list`(외부 처리기)와 뜻이 다른데 이름이 거의 같았다 |
| `version.get` | → `host.get` 에 흡수 | 버전과 지원 기능을 따로 물을 이유가 없다 |
| `mask.from_selection` | 삭제 | `mask.create` 의 `from: fromSelection` 이 한다 |
| `selection.select_all` | 삭제 | `selection.set` 의 `shape: canvas` 가 한다 |
| `selection.get` | → Resource | `photoshop://selection` |
| `history.get` | → Resource | `photoshop://history` |
| `state.get` | → `photoshop.diagnostics` | 상태에 더해 **막힌 이유와 고치는 방법**까지 준다 |

### 늦게 채운 공백 — `layer.get_active`

P0 로 분류해 놓고 **유일하게 구현되지 않은 채 남아 있었다.** 편집 Tool 이 `layerId`
를 생략하면 활성 레이어를 쓰는데, 그것이 무엇인지 물어볼 방법이 없었다. `layer.list`
로 전체를 받아 훑는 것이 유일한 우회였고 레이어가 33개인 문서에서도 그랬다.
없어도 돌기는 해서 늦어졌다.

구현하면서 드러난 것은 **활성 레이어가 하나가 아니라는 사실**이다.
`document.activeLayers` 는 배열이고 편집 Command 들은 그중 첫 번째만 쓴다.
그래서 `layer`(편집 Tool 이 실제로 쓰는 것)와 `layers`(사용자가 골라 둔 전부)를
함께 준다. 첫 번째만 돌려주면 세 개를 골라 둔 사용자에게 `layer.rename` 이 나머지
둘을 건드리지 않는다는 사실이 가려진다.

`layer` 는 **서버가** `layers[0]` 에서 뽑는다. Plugin 이 둘을 따로 보내면 어긋날 수
있고, 그러면 "편집 Tool 이 무엇을 건드리는지" 알려주는 Tool 자체가 거짓말을 한다.

**실기가 순서 버그를 잡았다.** 처음에는 평탄화 목록을 선택 집합으로 걸렀는데, 그러면
결과가 레이어 순서(위→아래)로 정렬된다. 레이어 두 개를 선택해 확인하니 이 Tool 은
id 14 를 첫 번째로 보고했는데 `layerId` 를 생략한 `layer.rename` 은 id 13 을 건드렸다.
**Photoshop 의 `activeLayers` 순서는 레이어 순서가 아니다.** 지금은 `activeLayers`
순서를 그대로 두고 `parentId` 만 평탄화 목록에서 가져온다.

Mock 만 보고 만들었으면 조용히 어긋난 채로 남았을 버그다. 단위 테스트는
`photoshop-uxp/src/dom/active-order.ts` 에서 순서 규칙만 떼어 고정했다.

---

## 9. Destructive 정책

다음은 반드시 `DESTRUCTIVE` 로 분류한다.

```text
document.save · document.close · document.flatten
layer.delete · layer.merge · group.ungroup
mask.apply · mask.delete
smart_object.rasterize
channel.delete · path.delete · guide.delete
workspace.delete
```

기본 허용에 들어 있지 않다. 쓰려면 `PHOTOSHOP_MCP_ALLOW` 에 명시해야 한다.

**대화형 승인은 하지 않는다.** 서버가 stdio 를 전송에 쓰므로 프롬프트를 띄울 수 없고,
elicitation 은 클라이언트가 무시하면 보장이 사라진다. 대화형 승인은 MCP 클라이언트의
역할이다.

위 목록 중 구현된 것은 `document.save` · `document.close` · `document.flatten` · `layer.delete` ·
`mask.apply` · `workspace.delete` 다. 나머지는 분류 체계만 서 있고 구현이 없다.
분류가 있다고 있는 척하지 않는다.

---

## 10. 규모

| 구간 | 개수 |
|---|---|
| 구현됨 | **86** |
| 후보 (P1) | 약 20 |
| 후보 (P2) | 약 45 |
| 후보 (P3) | 약 45 |
| 합계 후보 풀 | 약 150 |

Core 1.0 목표는 70–100개 수준이고 나머지는 요구에 따라 추가한다.

---

## 11. 최종 원칙

Photoshop MCP Core 는 Photoshop 의 모든 기능을 복제하는 API 가 아니다. 목표는
LLM 이 Photoshop 을 **안전하고 예측 가능하며 구조화된 방식으로** 제어하는 것이다.

따라서 API 개수보다 다음이 중요하다.

```text
일관된 namespace
명확한 permission
예측 가능한 command
비파괴 우선
Extension 과의 명확한 경계
```

그리고 세 가지는 API 로 열지 않는다. (ARCHITECTURE §23)

```text
임의 JavaScript 실행
임의 batchPlay descriptor 실행
Command 를 거치지 않는 Photoshop 수정
```

`batchPlay` 는 DOM 에 API 가 없는 경우(조정·마스크·선택·필터)에만 쓰고, descriptor 는
반드시 플러그인이 **검증된 파라미터로 조립한다.** 호출자가 descriptor 를 넘기는 통로를
만들지 않는다.
