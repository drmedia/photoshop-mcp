# StarNet2 Extension

StarNet2 로 별을 분리합니다. namespace 는 `starnet` 입니다.

```text
starnet.remove_stars   external   별 없는 것 + 별만 있는 것, 두 레이어
```

`milky.remove_stars` 에서 옮겨 왔습니다 (`extensions/milkyscape`, 제거됨).
그쪽은 은하수 도메인에 묶여 있었는데 별 분리는 대상과 무관합니다.

## 왜 `rcastro` 와 합치지 않는가

**실행 파일이 다릅니다.** `starnet2.exe` 와 `rc-astro.exe` 는 따로 설치하고 따로
삽니다. 한쪽만 깐 사람에게 다른 쪽 Tool 이 보이면 안 됩니다.

`rcastro` 안에 `bxt` · `nxt` · `sxt` 를 함께 둔 것은 **한 실행 파일**이기
때문입니다. 가르는 기준은 제품 이름이 아니라 설치 단위입니다.

## `rcastro.sxt` 와의 관계

둘 다 별을 분리하고 둘 다 `starRemoval` Capability 입니다.

```text
starnet.remove_stars   StarNet2           starnet2.exe
rcastro.sxt            StarXTerminator    rc-astro.exe
```

결과가 다르고 어느 쪽을 쓸지는 사용자가 정합니다. 그래서 **각 Tool 이
`provider` 를 못 박습니다** — 우선순위로 고르게 두면 설정에 따라 다른 것이
돌아가는데 호출자는 알 수 없습니다.

## 설정

`capabilities.json` 에 `starnet2` Provider 가 있어야 합니다.

```text
C:/Program Files/StarNet2/bin/starnet2.exe
```

`npx photoshop-mcp init` 이 찾아서 만들어 줍니다.

`PHOTOSHOP_MCP_ALLOW` 에 `external` 이 있어야 하고 (기본은 `read,edit`),
작업 폴더가 승인되어 있어야 합니다.

## 파라미터

| 입력 | CLI | 범위 | 기본 |
|---|---|---|---|
| `stride` | `--stride` | 2 ~ 512, **짝수** | 256 |

기본값은 짐작이 아닙니다 — StarNet2 가 `--machine-info` 로 기계가 읽을 수 있게
내놓습니다.

```json
{ "name": "stride", "type": "integer", "default": 256,
  "minimum": 2, "maximum": 512, "constraints": { "even": true } }
```

**홀수는 여기서 먼저 막습니다.** CLI 도 "Stride should be even!" 으로 거절하지만
그때는 이미 140MB 내보내기가 끝난 뒤입니다.

### 인자 형식

**StarNet2 는 `=` 형식을 아예 받지 않습니다.** 실기에서 확인했습니다.

```text
--stride=128    PARSE ERROR: Couldn't find match for argument
--stride 128    된다
```

RC-Astro 와 정반대입니다.

```text
RC-Astro    불리언은 `=` 만 받는다. 값 옵션은 공백도 된다
StarNet2    `=` 를 아예 안 받는다. 불리언은 값 없는 플래그다
```

### 생략한 것

- `--upsample` · `--linear` — **값 없는 플래그**입니다. `buildArgs` 는 선언한
  파라미터를 항상 전부 보내므로 "끄는 방법" 이 없습니다
- `--shadows-clipping` · `--target-background` — `--linear` 을 요구하므로 함께
  빠집니다
- `--mask` — 세 번째 출력이라 지금 범위 밖입니다

## 동작

```text
document.get → layer.list → document.export(tiff, 16bit)
  → starRemoval Capability (provider: starnet2)
  → layer.select(맨 위)
  → layer.place ×2 { rasterize: true }
  → layer.set_blend_mode screen (별 레이어)
```

**즉시 `jobId` 를 반환합니다.** 실기에서 4032×6048 이 **67초**였습니다 — MCP
기본 요청 타임아웃 60초를 넘겨 실제 클라이언트에서 `-32001 Request timed out`
이 났던 그 경우입니다.

**출력 경로를 둘 다 넘깁니다.** StarNet2 는 별 이미지 이름을 `--unscreen` 으로
받으므로 Provider 의 `outputs` 로 선언할 수 있습니다. StarXTerminator 는 스스로
이름을 정해(`<stem>-stars.tif`) 그렇게 할 수 없습니다.

## 결과

```text
StarNet 01       별 없는 것
StarNet 01 별    별만. **Screen** 이 걸려 있다
```

Screen 을 거는 이유 — 걸지 않으면 별 이미지가 검은 배경째 위를 덮어 문서가
온통 검게 보이고, 무엇이 잘못됐는지 알 수 없습니다. 둘을 함께 켜면 원본입니다.

기존 레이어를 바꾸지 않습니다.

## 중간 파일

한 번 돌 때마다 큰 TIFF 가 셋 생깁니다 (입력 · 별 제거본 · 별). 결과의 `files`
에 담기며 **지우지 않습니다** — 사용자 폴더의 파일을 말없이 지우지 않는다는
원칙이고, 다시 가져오거나 다른 도구에 넘길 수도 있습니다.
`photoshop.workspace.usage` 로 확인하고 `photoshop.workspace.delete` 로 이름을
명시해 지웁니다.
