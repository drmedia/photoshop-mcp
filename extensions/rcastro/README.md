# RC-Astro CLI Extension

RC-Astro CLI 를 MCP 에서 돌립니다. namespace 는 `rcastro` 입니다.

```text
rcastro.bxt   external   BlurXTerminator  — 선명화
rcastro.nxt   external   NoiseXTerminator — 노이즈 감소
rcastro.sxt   external   StarXTerminator  — 별 분리
```

**이름이 CLI 서브커맨드와 같습니다** (`rc-astro bxt` · `rc-astro nxt`). 레이어
이름(`BXT 01`)과 Job kind 도 같아 한 낱말로 이어집니다. 동작 낱말(`sharpen` ·
`denoise`)을 쓰지 않은 대신 **설명이 그것으로 시작합니다** — 이름만으로는 무엇을
하는지 알 수 없기 때문입니다.

노이즈 감소 경로가 셋이라(`graxpert.run_denoise` · `camera_raw.apply` · 이것) 제품
이름이 모호함을 없앱니다.

**제품별로 폴더를 나누지 않았습니다.** `rc-astro.exe` 하나가 `bxt` · `sxt` · `nxt` 를
다 가집니다. 한 제품 · 한 설치이므로 사용자가 패널에서 한 번만 등록하면 됩니다.
제품별 라이선스가 갈릴 수는 있지만 그건 **실행 시점 조건**이지 패키징 경계가
아닙니다 — 없으면 해당 Tool 이 이유를 말하며 거절합니다.

`photoshop.action.run` 으로 StarXTerminator 를 돌리는 길도 있지만, 액션은 녹화된
값이 고정이고 `destructive` 입니다. CLI 는 값을 지정할 수 있습니다.

## 왜 Extension 인가

RC-Astro 는 Photoshop 기능이 아니라 별도 제품입니다. Core 에 넣으면 그것을
설치하지 않은 사람에게도 Tool 목록에 보입니다.

## 왜 액션이 아닌가

RC-Astro 는 Photoshop 플러그인으로도 있고, 그쪽은 `필터 > RC-Astro` 메뉴를
거치므로 `photoshop.action.run` 으로 돌릴 수 있습니다. 갈리는 이유가 둘입니다.

- 액션은 **무엇을 하는지 알 수 없어 `destructive`** 입니다. 기본 허용 밖입니다
- 액션은 **녹화된 값이 고정**입니다. 파라미터를 바꿀 수 없습니다

CLI 는 값을 지정할 수 있고 `external` 로 충분합니다.

## 왜 프로세스를 직접 띄우지 않는가

Extension 은 임의의 프로그램을 실행할 수 없습니다 (ARCHITECTURE §23).
실행 파일은 `capabilities.json` 에서만 오고 argv 는 선언된 파라미터로만
조립되며 `shell: false` 로 돕니다. 그래서 `deconvolution` Capability 를
요청합니다.

## 설정

`capabilities.json` 에 `bxt` Provider 가 있어야 합니다.
`capabilities.example.json` 에 들어 있으니 복사해 경로를 확인하십시오.

```text
C:/Program Files/RC-Astro/CLI/rc-astro.exe
```

`npx photoshop-mcp init` 이 찾아서 만들어 주기도 합니다.

`PHOTOSHOP_MCP_ALLOW` 에 `external` 이 있어야 하고 (기본은 `read,edit`),
작업 폴더가 승인되어 있어야 합니다 — PhotoshopMCP 패널의 `폴더 승인` 입니다.

무엇이 막혀 있으면 `rcastro.bxt` 이 이유를 말하며 거절합니다.

## 파라미터 — `rcastro.bxt`

이름과 범위는 `rc-astro bxt` 의 실제 옵션에서 왔습니다 (CLI 2.6.9 build 727).
짐작한 것이 없습니다.

| 입력 | CLI | 범위 | 기본 |
|---|---|---|---|
| `sharpenStars` | `--sharpen-stars` | 0 ~ 0.7 | 0.5 |
| `sharpenNonstellar` | `--sharpen-nonstellar` | 0 ~ 1 | 0.5 |
| `starHalos` | `--adjust-star-halos` | −0.5 ~ 0.5 | 0 |
| `lunarPlanetary` | `--lunar-planetary` | 참·거짓 | 거짓 |
| `correctOnly` | `--correct-only` | 참·거짓 | 거짓 |

값을 주지 않으면 Provider 의 기본값이 쓰입니다. Extension 에 기본값을 겹쳐
두지 않습니다 — 두 곳이 갈라집니다.

### 인자 형식

**불리언 플래그는 `=` 형식이어야 합니다.** 실기에서 확인했습니다.

```text
--lunar-planetary true     "true" 를 입력 파일로 읽는다
                           Warning: no files matched 'true'
--lunar-planetary=false    받는다
```

값 옵션(`--sharpen-stars` · `--sharpen-nonstellar` · `--adjust-star-halos`)은
공백 형식도 받습니다. 그래도 `capabilities.json` 에서는 **전부 `=` 로 통일**해
두었습니다 — 설정 파일을 보는 사람이 어느 것이 플래그인지 구분할 이유가 없습니다.

`--output` 만 공백 형식입니다. 이쪽이 실기에서 검증된 형태입니다.

**`correctOnly` 가 참이면 선명화 값들은 효과가 없습니다.** PSF 수차만 잡습니다.

**달·행성은 `lunarPlanetary` 를 켭니다.** 별에서 PSF 를 추정하는 기본 동작이
별 없는 대상에서는 맞지 않습니다.

### 생략한 것

- `--nonstellar-diameter` — `--auto-nonstellar-psf` 가 거짓일 때만 쓸 수 있는
  짝입니다. 둘을 함께 노출하면 "하나가 0 이어야 한다" 는 제약을 호출자가
  기억해야 합니다
- `--device` · `--depth` · `--overlap` · `--ml-version` — 처리기 설정에
  속합니다. 필요하면 `capabilities.json` 의 `args` 에 고정값으로 넣습니다

## 파라미터 — `rcastro.nxt`

| 입력 | CLI | 범위 | 기본 |
|---|---|---|---|
| `denoise` | 아래 둘을 함께 | 0 ~ 1 | 0.9 |
| `denoiseIntensity` | `--denoise-intensity` | 0 ~ 1 | 0.9 |
| `denoiseColor` | `--denoise-color` | 0 ~ 1 | 0.9 |
| `iterations` | `--iterations` | 1 ~ 5 | 2 |

**CLI 가 겹치는 강도 옵션을 거절합니다.** 실기에서 확인했습니다.

```text
Error: Conflicting denoise options: Denoise (denoise) and
       Denoise Intensity (denoise-intensity) both control
       the intensity, high-frequency noise band.
```

그래서 Provider 는 **겹치지 않는 intensity + color 쌍만** 선언합니다 —
`buildArgs` 가 선언한 파라미터를 항상 전부 보내므로, 상위 `--denoise` 를 함께
두면 모든 호출이 실패합니다.

`denoise` 는 그 둘을 한 번에 주는 **편의 입력**이고 Extension 이 풀어 넘깁니다.
따로 준 값이 우선합니다 — `{ denoise: 0.4, denoiseColor: 0.95 }` 면
휘도 0.4 · 색 0.95 입니다. 천체사진은 색 노이즈를 휘도보다 세게 잡는 일이 흔합니다.

### 생략한 것

주파수 대역별 넷(`--denoise-intensity-high-freq` 등)과 `--frequency-scale` 은
그 넷을 쓸 때만 뜻이 있습니다. 함께 노출하면 "어느 것이 어느 것과 겹치는가" 를
호출자가 외워야 합니다.

## 파라미터 — `rcastro.sxt`

| 입력 | CLI | 기본 |
|---|---|---|
| `unscreen` | `--unscreen` | 거짓 |

**`--output-stars` 를 노출하지 않습니다.** 언제나 켭니다 — 별 이미지가 없으면
되돌릴 수 없고, `--unscreen` 이 그것을 요구합니다.

```text
Error: Conflicting options: Unscreen Stars (unscreen) must ...
```

`buildArgs` 가 선언한 파라미터를 항상 전부 보내므로 둘 다 노출하면 조합에 따라
CLI 가 거절합니다. 그래서 `--output-stars=true` 는 `args` 에 고정값으로 넣었습니다.

### 결과가 두 장입니다

```text
SXT 01       별 없는 것
SXT 01 별    별만. **Screen** 이 걸려 있다
```

Screen 을 걸어 두는 이유가 있습니다 — 걸지 않으면 별 이미지가 검은 배경째 위를
덮어 문서가 온통 검게 보이고, 무엇이 잘못됐는지 알 수 없습니다.
`unscreen: true` 와 함께 쓰면 둘을 켰을 때 원본이 복원됩니다.

**별 이미지의 이름은 처리기가 정합니다.** SXT 는 `--output` **옆에**
`<stem>-stars.<ext>` 로 씁니다 — 경로를 받지 않습니다. 그래서 Provider 의
`outputs` 로 선언할 수 없고(`assertConfigConsistent` 가 `{{output.stars}}` 를
args 에 넣으라고 요구하는데 넣을 인자가 없습니다) **이 Extension 이 이름을
압니다.** 제품 전용 어댑터라 허용되는 결합입니다 — 도메인 코드가 알면 처리기를
바꿀 때 도메인이 따라 바뀝니다. Registry 가 확인해 주지 않으므로 없으면
`layer.place` 가 `FILE_NOT_FOUND` 로 막습니다.

## 동작

세 Tool 이 같은 흐름입니다.

```text
document.get → layer.list → document.export(tiff, 16bit)
  → Capability (provider: bxt · nxt · sxt)
  → layer.select(맨 위) → layer.place { rasterize: true }
  → (sxt 만) 별 레이어 place + layer.set_blend_mode screen
```

**즉시 `jobId` 를 반환합니다.** 실기에서 4032×6048 기준 BXT 10초 · NXT 7초였지만
처리 시간은 이미지 크기에 따라 변하고, MCP 기본 요청 타임아웃은 60초입니다.
`photoshop.job.status` 로 확인합니다.

**16비트로 내보냅니다.** RC-Astro 의 `--depth` 기본값이 "입력과 같음" 이라 8비트로
넣으면 8비트로 나옵니다.

**픽셀 레이어로 가져옵니다.** 구워 돌려받은 결과라 스마트 오브젝트가 얻는 것이
없습니다 — 더블클릭해도 처리기가 다시 돌지 않고 구워진 TIFF 가 열릴 뿐입니다.
`layer.place` 의 `rasterize` 로 **애초에 만들지 않습니다.**

**맨 위 레이어를 먼저 선택합니다.** `layer.place` 는 문서 맨 위가 아니라
활성 레이어 바로 위에 놓고, 활성 레이어가 그룹 안이면 같은 그룹으로 들어갑니다.

기존 레이어를 바꾸지 않습니다. 결과는 `BXT 01` · `NXT 01` · `SXT 01` 처럼 제품별로
번호가 붙습니다 — 한 카운터를 쓰면 어느 것이 무엇인지 알 수 없습니다.

## 중간 파일

한 번 돌 때마다 큰 TIFF 가 둘 생깁니다 (입력·출력). `sxt` 는 셋입니다.
결과의 `files` 에 담기며
`photoshop.workspace.usage` 로 확인하고 `photoshop.workspace.delete` 로
이름을 명시해 지웁니다.

## 어디서 왔는가

`milky.enhance` 에서 옮겨 왔습니다 (`extensions/milkyscape`, 제거됨). 그쪽은
은하수 워크플로의 한 단계였고 `nonstellar` 하나만 노출했으며 결과가 스마트
오브젝트였습니다. 여기서는 BXT 자체를 다룹니다 — 다섯 파라미터, Provider 를
`bxt` 로 못 박고, 결과가 픽셀 레이어입니다.
