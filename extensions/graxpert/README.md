# GraXpert Extension

GraXpert 의 **그래디언트 제거**와 **노이즈 감소**를 MCP 에서 실행한다.
namespace 는 `gx` 다.

```text
gx.run_gradient   external   빛 공해·배경 기울기를 뺀다
gx.run_denoise    external   노이즈를 줄인다
```

**CLI 를 부른다.** `GraXpert.exe` 를 `capabilities.json` 의 Provider 로 실행한다.
Photoshop CEP 패널은 쓰지 않는다.

## 왜 패널을 뗐나

예전에는 패널의 **External Automation API**(`%TEMP%/GraXpert_Photoshop/` 의
명령 파일)로 구동했다. 전제가 둘이었고 **둘 다 사람만 할 수 있었다.**

```text
① 패널을 열어 둔다
② 패널 설정에서 Allow External Automation 을 켠다
```

LLM 이 `gx.run_gradient` 를 부르면 전제가 안 갖춰졌을 때 정확한 이유를 받지만,
**그 다음에 할 수 있는 일이 없었다.** 사람을 부를 뿐이다.

①을 자동화할 수 있는지 재 봤다. `startNotifications(["all"])` 로 듣는 동안
손으로 패널을 열었더니 잡힌 `photoshop.*` 이벤트가 이것뿐이었다.

```text
modalJavaScriptScopeEnter   40
modalJavaScriptScopeExit    80
```

**전부 우리 Command 가 만든 것**이다(그 사이 Command 40개가 돌았다). 패널이
남긴 흔적은 0 이다. descriptor 가 없으니 **액션으로 녹화할 수도, 재생할 수도
없다** — §17.37 이 "패널 조작은 녹화할 것이 없다" 고 한 것과 같은 이유다.

메뉴 command ID 로 여는 길(`menuBarInfo` + `performMenuCommand`)이 남아 있지만,
그건 **"LLM 이 Photoshop 메뉴를 부를 수 있다"** 는 새 권한 등급을 여는 일이고
(ARCHITECTURE §23), 얻는 것은 Photoshop 세션당 클릭 한 번이다. 그리고 ②는
패널 내부 설정이라 그래도 못 켠다.

CLI 는 같은 실행 파일이고 왕복이 이미 실기에서 검증되어 있었다 —
`export(tiff) → GraXpert 7초(GPU) → FITS→TIFF → place`.

## 하늘 격리 — 선택이 있으면 탄다

**활성 선택 영역이 있으면 그것을 하늘로 삼는다.** 없으면 활성 레이어 전체다.
둘 다 정상이라 막지 않고 어느 쪽인지를 결과에 담는다.

```text
photoshop.selection.sky   호출자가 하늘을 고른다 (또는 손으로 다듬는다)
gx.run_gradient
   ├ selection.export_mask   하늘 마스크를 16비트 TIFF 로
   ├ prepare: extendSkyPlane  지상부를 하늘의 연장 평면으로 덮는다
   ├ GraXpert (AI)
   ├ layer.place
   └ mask.create fromSelection  결과를 하늘에만 씌운다
```

실기에서 **전체 이미지로 돌리면 결과가 원본과 눈으로 구분되지 않았다.** 지상이
프레임에 있으면 산·나무가 배경 모델을 끌어당긴다.

**덮는 것은 단색이 아니라 평면이다.** 하늘의 기울기를 지상까지 연장하므로 AI 가
경계를 구조로 읽지 않는다. 채널마다 1차 평면을 적합하고 MAD 로 이상치를 세 번
걸러낸다 — 별과 옅은 구름이 평면을 끌어당긴다.

**무엇을 하늘로 볼지는 Tool 이 정하지 않는다.** 어떤 사진은 격리가 필요 없고,
어떤 사진은 선택을 손으로 다듬어야 한다. 격리가 필요한지는
`photoshop.document.statistics` 로 재서 판단한다.

`gx.run_denoise` 는 선택을 보지 않는다 — 노이즈 감소는 전체에 거는 것이 맞다.

## 강도를 지정할 수 없다 — 노이즈 감소

`GraXpert.exe -h` 에 `-cmd denoising` 용 플래그가 **하나도 없다.**
`-smoothing` · `-correction` 은 배경 추출 전용이다.

값을 주려면 `-preferences_file` 로 GraXpert 의 설정 파일을 통째로 넘겨야 하는데,
Extension 은 **승인된 작업 폴더 밖에 파일을 쓸 수 없다**(ROADMAP §8.5).

없는 파라미터를 스키마에 두고 조용히 무시하느니 뺐다. 강도를 조절하려면
`rcastro.nxt` 나 `photoshop.camera_raw.apply` 쪽이 낫다 — 후자는 실기에서
σ 6.72 → 3.42(49%)였다.

## 파라미터 — `gx.run_gradient`

| 입력 | CLI | 범위 | 기본 |
|---|---|---|---|
| `correction` | `-correction` | Subtraction · Division | Subtraction |
| `smoothing` | `-smoothing` | 0 ~ 1 | 0.5 |
| `gpu` | `-gpu` | 참·거짓 | 참 |

값을 주지 않으면 Provider 의 기본값이 쓰인다. **Extension 에 기본값을 겹쳐 두지
않는다** — 두 곳이 갈라진다.

## 설정

`capabilities.json` 에 Provider 가 **둘** 있어야 한다. `capabilities.example.json`
에 들어 있으니 복사해 경로를 확인하십시오.

```text
graxpert           gradientRemoval   -cmd background-extraction
graxpert-denoise   noiseReduction    -cmd denoising
```

둘 다 같은 실행 파일을 가리킨다.

```text
%LOCALAPPDATA%/Programs/GraXpert/GraXpert.exe
```

`noiseReduction` 은 `rcastro.nxt` 도 제공하므로 **각 Tool 이 `provider` 를 못
박는다** — 우선순위로 고르게 두면 설정에 따라 다른 것이 돌면서 호출자는 모른다.

`PHOTOSHOP_MCP_ALLOW` 에 `external` 이 있어야 하고(기본은 `read,edit`),
작업 폴더가 승인되어 있어야 한다.

## 동작

```text
document.get → layer.list → document.export(tiff, 16bit)
  → Capability (provider: graxpert · graxpert-denoise)
  → layer.select(맨 위) → layer.place { rasterize: true }
```

**즉시 `jobId` 를 반환한다.** 실기에서 4032×6048 그래디언트 제거가 7초(GPU),
노이즈 감소가 75초였다. MCP 기본 요청 타임아웃은 60초다.

**16비트로 내보낸다.** 그래디언트 제거는 어두운 배경의 미세한 차이를 다루는
작업이라 8비트로 떨어지면 계조가 무너진다.

**GraXpert 3.0.2 는 `-output out.tif` 를 줘도 `out.tif.fits` 를 만든다.** 그
버릇은 `outputSuffix` · `convert` 로 설정에 선언되어 있고 Registry 가 실제
파일을 찾아 16비트 TIFF 로 바꾼다. 이 Extension 은 요청한 파일이 나온다고만
알면 된다.

**픽셀 레이어로 가져온다.** 구워 돌려받은 결과라 스마트 오브젝트가 얻는 것이
없다.

## 중간 파일

한 번 돌 때마다 큰 TIFF 가 생긴다. 결과의 `files` 에 전부 담기며
`photoshop.workspace.usage` 로 확인하고 `photoshop.workspace.delete` 로 이름을
명시해 지운다.

```text
선택 없음   입력 · 출력                       2개
하늘 경로   입력 · 출력 · 마스크 · 준비 파일    4개
```

4032×6048 16비트면 **하나에 140MB** 다. 알려 주지 않으면 조용히 쌓인다.
