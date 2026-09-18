# MilkyScape Tools

지상 풍경이 포함된 은하수 사진 편집 도메인 Extension입니다. (ROADMAP §10)

Core는 Photoshop을 알고, 이 Extension은 이 작업 도메인을 압니다. (ARCHITECTURE §1)

## Tool

| Tool | 권한 | 하는 일 |
|---|---|---|
| `milky.get_state` | read | 문서·작업 폴더·처리기·기존 결과를 요약하고 **막힌 이유**를 알려줍니다 |
| `milky.remove_stars` | external | 16비트 TIFF 내보내기 → StarNet2 → 별 제거본·별 두 레이어 |
| `milky.restore_stars` | edit | 별 레이어를 스크린 혼합으로 되살립니다 |
| `milky.remove_gradient` | external | 16비트 TIFF 내보내기 → GraXpert → 새 레이어 |
| `milky.enhance` | external | BlurXTerminator로 선명화 |

`remove_stars` 와 `remove_gradient` 는 **즉시 `jobId` 를 돌려줍니다.** 수 분 걸리는
작업이라 MCP 요청 안에서 끝낼 수 없습니다. `photoshop.job.status` 로 확인하세요.

## 기존 MilkyScape 패널에서 가져온 원칙

- **매번 새 결과 레이어를 만듭니다.** 기존 결과와 사용자 수정을 덮어쓰거나 자동으로
  지우지 않습니다.
- 결과 이름에 도구·기능·실행 번호를 넣습니다 — `StarNet2_별제거_01`.
- **자동 연쇄 처리하지 않습니다.** 한 기능의 결과를 다음 기능이 알아서 입력으로
  삼지 않습니다.
- 권장 순서는 있지만 실행의 선행 조건이 아닙니다.

## 준비

1. Photoshop의 'Photoshop MCP' 패널에서 **저장 폴더를 승인**합니다.
2. `capabilities.json` 에 GraXpert·StarNet2·BlurXTerminator 경로를 설정합니다.
   (`capabilities.example.json` 참고)
3. 서버를 `PHOTOSHOP_MCP_ALLOW=read,edit,external` 로 실행합니다.

`milky.get_state` 가 무엇이 빠졌는지 알려줍니다.

## GraXpert 의 FITS 출력

GraXpert 3.0.2 CLI는 출력 형식 옵션이 없어 항상 FITS를 쓰고, `-output out.tif` 를 줘도
`out.tif.fits` 를 만듭니다. Photoshop은 FITS를 읽지 못합니다.

이 Extension은 그 사정을 알지 못합니다. 보정은 Provider 설정의 `outputSuffix` ·
`convert` 가 맡고, 여기서는 요청한 TIFF가 나온다고 보고 씁니다. 처리기의 버릇을
도메인 코드가 알면 처리기를 바꿀 때 도메인 코드가 따라 바뀝니다.

변환은 **계조를 늘리지 않습니다.** 배경을 뺀 이미지는 원래 어둡고, 그것을 min/max로
늘리면 다른 그림이 됩니다.

## 아직 없는 것

- **`create_sky_mask` · `create_foreground_mask`** — 기존 MilkyScape는 하늘 마스크를
  만들지 않습니다. 사용자가 두 사진을 정렬해 만든 합성 마스크를 입력으로 받습니다.
  Photoshop 자체 '하늘 선택'은 Photoshop 기능이지 이 도메인의 지식이 아니므로
  Core에 속합니다.
- 노이즈 감소 · Stretch · 은하수 보정 · 경계 보정 · 풍경 마무리 — 기존 패널의 나머지
  기능들입니다.

## 임시 파일

내보낸 TIFF와 처리 결과는 승인된 폴더에 남습니다. 24메가픽셀 16비트면 한 번에
300MB가 넘으니 주기적으로 정리하세요. **자동으로 지우지 않습니다** — 사용자 폴더의
파일을 말없이 지우지 않는다는 원칙이며, 다시 가져오거나 다른 도구에 넘길 수도 있습니다.
