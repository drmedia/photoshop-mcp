/**
 * 서버가 모델에게 건네는 사용 지침. (ROADMAP §92)
 *
 * 사용자가 "이 사진 보정해줘" 처럼 짧게 말해도 모델이 **읽기 → 분석 → 계획 → 적용 → 재분석**
 * 순서를 따르게 한다. 절차를 사용자가 매번 프롬프트에 적게 하지 않는다.
 *
 * 두 곳으로 나간다.
 * - `INSTRUCTIONS` — `initialize` 응답의 `instructions`. 클라이언트가 세션 맥락에 넣는다.
 *   **매 세션 토큰을 먹으므로 짧게** 두고, 이 프로젝트에서 실제로 틀렸던 것만 담는다.
 * - `RETOUCH_PROMPT` — `prompts/get` 의 `retouch`. 슬래시 명령으로 불리는 전체 절차.
 *
 * ## 판정이 없다
 *
 * 도구는 무엇이 좋은 보정인지 정하지 않는다(MEASUREMENT.md §2). 여기서도 임계나 목표값을
 * 주지 않는다. 숫자를 근거로 판단하는 것은 모델이고, 끝낼 시점도 모델이 정하되 근거를 말하게 한다.
 */

export const INSTRUCTIONS = [
  "Photoshop 사진 보정 지침.",
  "사진을 보정해 달라는 요청은 한 번에 처리하지 말고 다음 순서를 따른다.",
  "1) 읽기: layer.list · smart_object.get_info 로 이미 걸린 보정을 확인하고 metadata.get · document.capture 로 본다.",
  "2) 분석: 보정 전 픽셀이 있는 레이어(보통 배경)에 document.analyze 를 쓴다. 눈이 아니라 수치로 판단한다.",
  "3) 계획: 발견한 문제와 쓸 도구 · 값을 사용자에게 보여 주고 승인받은 뒤 적용한다. 문제없는 항목은 건드리지 않는다.",
  "4) 적용: 한 번에 한 가지만, 보정 전 레이어를 남기는 비파괴 방식으로 한다.",
  "5) 재분석: 적용할 때마다 document.compare(beforeLayerId = 보정 전 레이어)로 그림과 수치를 함께 확인한다.",
  "주의: 스마트 필터는 덮어쓰이지 않고 쌓인다 — 같은 camera_raw.apply 를 두 번 걸지 말고 고치려면 history.undo 뒤 전체를 다시 적용한다.",
  "국소 보정은 별도 레이어에서 하고 mask.create 의 from 을 빠뜨리지 않는다(기본은 전부 흰 마스크).",
  "값을 바꿔 보기 전에 history.create_snapshot 으로 이름을 걸고, 아니면 restore_snapshot 으로 돌아와 layerIdsMatch 를 확인한다. 조정 레이어 값은 adjustment.update 로 그 자리에서 고친다.",
  "참조 사진이 열려 있으면 document.compare_with 로 견준다(활성 문서는 안 옮겨진다). 편집은 활성 문서에 걸리므로 document.activate 로 옮긴 뒤 반드시 되돌아온다.",
  "시험용 레이어 · 복제 문서는 끝나면 layer.delete_created · document.close_created 로 정리한다(이 서버가 만든 것만 지워진다).",
  "도구는 판정을 주지 않는다. 끝낼 시점은 네가 정하되 근거가 된 수치를 말한다.",
  "저장 · 평탄화처럼 되돌릴 수 없는 작업과 사용자의 문서를 닫는 일은 사용자가 요청하기 전에는 하지 않는다.",
].join("\n");

export const RETOUCH_PROMPT_NAME = "retouch";

export const RETOUCH_PROMPT_DESCRIPTION =
  "현재 열린 사진을 읽기 → 분석 → 계획 → 적용 → 재분석 순서로 보정한다. 계획은 적용 전에 보여 준다.";

/** `goal` 은 선택이다. 없으면 모델이 분석으로 정한다. */
export function retouchPrompt(goal: string | undefined): string {
  const trimmed = goal?.trim() ?? "";
  const request =
    trimmed === ""
      ? "현재 열린 사진을 보정해줘. 무엇을 고칠지는 분석 결과로 정해줘."
      : `현재 열린 사진을 보정해줘. 목표: ${trimmed}`;
  return [
    request,
    "",
    "## 1. 읽기 (문서를 바꾸지 않는다)",
    "- photoshop.layer.list 로 레이어 구조와 이미 걸린 보정을 확인한다.",
    "- 스마트 오브젝트가 있으면 photoshop.smart_object.get_info 로 걸린 Camera Raw 값을 읽는다.",
    "- photoshop.metadata.get 으로 촬영 조건(ISO · 노출 · 초점 거리)을 본다.",
    "- photoshop.document.capture 로 사진을 눈으로 본다.",
    "",
    "## 2. 분석 (문서를 바꾸지 않는다)",
    "- 보정 전 픽셀이 있는 레이어에 photoshop.document.analyze 를 쓴다. 보정이 쌓인 합성이 아니라 원본을 재야 한다.",
    "- 클리핑 · 그라디언트 · 노이즈 · 색 쏠림을 수치로 본다. 도구는 판정을 주지 않는다.",
    "  무엇이 문제인지는 네가 판단한다. 예: 밤하늘의 은하수는 중립색이 정답이 아니다.",
    "",
    "## 3. 계획 (적용 전에 사용자에게 보여 준다)",
    "- 발견한 문제를 중요한 순서로, 각각 어떤 도구로 얼마나 고칠지 적는다.",
    "- 이미 문제없는 항목은 건드리지 않는다고 적는다.",
    "- 사용자가 승인하기 전에는 4단계로 넘어가지 않는다.",
    "",
    "## 4. 적용",
    "- 한 번에 한 가지만 바꾼다. 보정 전 레이어를 남기고 조정 레이어 · 마스크 · 스마트 오브젝트로 비파괴 적용한다.",
    "- 값을 바꿔 보기 전에 photoshop.history.create_snapshot 으로 이름을 걸어 둔다. 안 맞으면 photoshop.history.restore_snapshot 으로 돌아오고 layerIdsMatch 를 확인한다.",
    "- 이미 건 조정 레이어의 값은 되감지 말고 photoshop.adjustment.update 로 그 자리에서 고친다(settings 는 통째로 다시 정한다).",
    "- 스마트 필터는 쌓인다. 같은 Camera Raw 를 두 번 걸지 않는다. 값을 고치려면 photoshop.history.undo 뒤 전체를 다시 적용하고 smartFilterCount 로 확인한다.",
    "- 국소 보정은 별도 레이어에서 한다. mask.create 의 from 을 빠뜨리면 전부 흰 마스크가 되어 전역에 걸린다.",
    "- 합성 채널에 톤 곡선을 걸면 채도가 함께 오른다. 필요하면 luminosity 혼합을 쓴다.",
    "- 저장 · 평탄화나 사용자의 문서를 닫는 일처럼 되돌릴 수 없는 작업은 하지 않는다.",
    "",
    "## 5. 재분석",
    "- 참조 사진이 열려 있으면 photoshop.document.compare_with 로 견준다. 활성 문서는 안 옮겨지고 수치는 축소본에서 나오므로 클리핑은 믿지 않는다. 편집은 활성 문서에 걸리니 photoshop.document.activate 로 옮겼다면 previousId 로 되돌아온다.",
    "- 적용할 때마다 photoshop.document.compare 를 부른다. beforeLayerId 는 보정 전 레이어이고 afterLayerId 는 생략한다.",
    "- 그림의 왼쪽부터 결과의 panels 순서다. 그림과 수치(change · hotspots · 클리핑 증가량)를 함께 본다.",
    "- 의도하지 않은 곳이 바뀌었거나 클리핑이 늘었으면 되돌리고 값을 낮춰 다시 한다.",
    "- 끝낼 시점은 네가 판단하되 근거가 된 수치를 말한다.",
    "- 끝나면 시험용 레이어와 복제 문서를 photoshop.layer.delete_created · photoshop.document.close_created 로 정리한다. 이 서버가 만든 것만 지워지고 사용자의 것은 notCreated 로 남는다.",
    "",
    "## 마지막 보고",
    "- 처음 대비 바뀐 수치, 적용한 레이어와 값, 확신하지 못한 부분을 적는다.",
  ].join("\n");
}
