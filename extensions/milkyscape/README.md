# MilkyScape Tools

지상 풍경이 포함된 은하수 사진 편집 도메인 Extension입니다. (ROADMAP §10)

Core는 Photoshop을 알고, 이 Extension은 이 작업 도메인을 압니다. (ARCHITECTURE §1)

## Tool

| Tool | 권한 | 하는 일 |
|---|---|---|
| `milky.get_state` | read | 문서·작업 폴더·처리기·기존 결과를 요약하고 **막힌 이유**를 알려줍니다 |
| `milky.remove_stars` | external | 16비트 TIFF 내보내기 → StarNet2 → 별 제거본·별 두 레이어 |
| `milky.restore_stars` | edit | 별 레이어를 스크린 혼합으로 되살립니다 |
| `milky.enhance` | external | BlurXTerminator로 선명화 |

## 기존 MilkyScape 패널에서 가져온 원칙

- **매번 새 결과 레이어를 만듭니다.** 기존 결과와 사용자 수정을 덮어쓰거나 자동으로
  지우지 않습니다.
- 결과 이름에 도구·기능·실행 번호를 넣습니다 — `StarNet2_별제거_01`.
- **자동 연쇄 처리하지 않습니다.** 한 기능의 결과를 다음 기능이 알아서 입력으로
  삼지 않습니다.
- 권장 순서는 있지만 실행의 선행 조건이 아닙니다.

## 준비

1. Photoshop의 'Photoshop MCP' 패널에서 **저장 폴더를 승인**합니다.
2. `capabilities.json` 에 StarNet2·BlurXTerminator 경로를 설정합니다.
   (`capabilities.example.json` 참고)
3. 서버를 `PHOTOSHOP_MCP_ALLOW=read,edit,external` 로 실행합니다.

`milky.get_state` 가 무엇이 빠졌는지 알려줍니다.

## 아직 없는 것

- **`remove_gradient`** — GraXpert CLI가 Photoshop이 못 읽는 FITS만 출력합니다
  (3.0.2 기준, 출력 형식 옵션 없음). FITS → TIFF 변환이 따로 필요합니다.
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
