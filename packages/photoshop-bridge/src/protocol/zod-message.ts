import type { ZodError } from "zod";

/**
 * Zod 검증 오류를 한 줄 메시지로 만든다.
 *
 * ## 왜 필요한가
 *
 * 검증 실패는 **호출자가 고칠 수 있는 유일한 종류의 오류**다. 무엇이 왜 잘못됐는지
 * 말해주면 바로 고쳐 다시 부른다. 그런데 예전에는 전부 같은 문장이었다.
 *
 * ```text
 * INVALID_PARAMETER | Tool 입력이 올바르지 않습니다: photoshop.selection.set
 * ```
 *
 * bounds 를 빠뜨렸는지, 곡선 제어점 순서가 틀렸는지, 반지름이 범위를 넘었는지
 * 구분할 수 없다. 정확한 설명은 `details.issues` 에 있었지만 **호출자는 `message`
 * 를 먼저 읽는다.** LLM 으로 테스트하다 세 가지 다른 실수가 똑같은 문장을 내는
 * 것을 보고 고쳤다.
 *
 * ## 형식
 *
 * `필드: 설명` 을 ` · ` 로 잇는다. 최상위 오류(경로 없음)는 설명만 쓴다.
 * 너무 많으면 앞의 몇 개만 쓴다 — 전부 붙이면 메시지가 화면을 채운다.
 */
export function describeZodIssues(error: ZodError, limit = 3): string {
  const issues = error.issues.slice(0, limit).map((issue) => {
    const path = issue.path.join(".");
    return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
  });
  const rest = error.issues.length - issues.length;
  return issues.join(" · ") + (rest > 0 ? ` 외 ${rest}건` : "");
}
