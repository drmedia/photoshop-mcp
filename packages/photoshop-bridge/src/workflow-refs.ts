import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import type { WorkflowDefinition } from "./workflow.js";

/**
 * 단계 사이의 값 전달. (ARCHITECTURE §23.2 와 같은 원칙)
 *
 * `{{steps.0.result.layer.id}}` 형태만 허용한다. 앞 단계 결과에서 **경로로 꺼내는
 * 것**뿐이다. 임의 식을 평가하지 않는다 — 그 순간 워크플로가 실행 엔진이 되고,
 * "LLM 이 임의 코드를 실행할 수 없다" 는 규칙이 무너진다.
 */

/** `{{ ... }}` 안의 내용을 통째로 잡는다. 모르는 형태도 잡아서 거부하기 위함이다. */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/gu;

/** 값 하나가 자리표시자 **하나로만** 이루어졌는지. */
const WHOLE = /^\{\{\s*([^{}]*?)\s*\}\}$/u;

const REFERENCE = /^steps\.(\d+)\.result(?:\.(.+))?$/u;

/** 참조 하나를 뜯는다. 형태가 다르면 `null`. */
function parse(expression: string): { step: number; path: string[] } | null {
  const match = REFERENCE.exec(expression);
  if (match?.[1] === undefined) {
    return null;
  }
  const path = match[2] === undefined ? [] : match[2].split(".");
  // 빈 조각은 `a..b` 같은 오타다. 조용히 넘기지 않는다.
  if (path.some((segment) => segment.length === 0)) {
    return null;
  }
  return { step: Number.parseInt(match[1], 10), path };
}

/** 정의에 쓰인 모든 참조. 검증에 쓴다. */
export function referencesIn(definition: WorkflowDefinition): string[] {
  const found: string[] = [];
  for (const step of definition.steps) {
    for (const value of Object.values(step.input ?? {})) {
      if (typeof value !== "string") {
        continue;
      }
      for (const match of value.matchAll(PLACEHOLDER)) {
        if (match[1] !== undefined) {
          found.push(match[1]);
        }
      }
    }
  }
  return found;
}

/**
 * 정의가 일관적인지 검사한다. 등록할 때 한 번 한다.
 *
 * 앞 단계만 참조할 수 있다. 자기 자신이나 뒤 단계를 가리키면 실행 시점에 반드시
 * 실패하므로 등록에서 막는다.
 *
 * @throws {PhotoshopMcpError} `INVALID_PARAMETER`
 */
export function assertWorkflowConsistent(definition: WorkflowDefinition): void {
  definition.steps.forEach((step, index) => {
    for (const value of Object.values(step.input ?? {})) {
      if (typeof value !== "string") {
        continue;
      }
      for (const match of value.matchAll(PLACEHOLDER)) {
        const expression = match[1] ?? "";
        const reference = parse(expression);

        if (reference === null) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `워크플로 '${definition.id}' 의 ${index}번 단계가 알 수 없는 참조를 씁니다: ` +
              `{{${expression}}}. steps.<번호>.result.<경로> 형태만 쓸 수 있습니다.`,
            { details: { workflow: definition.id, step: index, expression } },
          );
        }
        if (reference.step >= index) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `워크플로 '${definition.id}' 의 ${index}번 단계가 ${reference.step}번 단계를 ` +
              `참조합니다. 앞 단계만 참조할 수 있습니다.`,
            { details: { workflow: definition.id, step: index, references: reference.step } },
          );
        }
      }
    }
  });
}

/** 객체에서 경로로 값을 꺼낸다. 없으면 `undefined`. */
function pick(source: unknown, path: readonly string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * 입력의 자리표시자를 앞 단계 결과로 바꾼다.
 *
 * 값 전체가 자리표시자 하나면 **타입을 유지한 채** 바꾼다. `"{{steps.0.result.id}}"`
 * 는 숫자 `42` 가 되지 문자열 `"42"` 가 되지 않는다. 문자열로 바꾸면 Tool 의
 * 스키마 검증이 엉뚱하게 실패한다.
 *
 * 문장 안에 섞여 있으면 문자열로 이어 붙인다.
 *
 * @throws {PhotoshopMcpError} `INVALID_PARAMETER` — 참조가 가리키는 값이 없을 때
 */
export function resolveInput(
  input: Record<string, unknown>,
  results: readonly unknown[],
  context: { workflow: string; step: number },
): Record<string, unknown> {
  const resolveOne = (expression: string): unknown => {
    const reference = parse(expression);
    if (reference === null) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        `알 수 없는 참조입니다: {{${expression}}}`,
        { details: { ...context, expression } },
      );
    }

    const value = pick(results[reference.step], reference.path);
    if (value === undefined) {
      // 조용히 빈 값을 넣지 않는다. 앞 단계 결과 모양이 바뀌면 알아야 한다.
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        `${reference.step}번 단계 결과에 ${reference.path.join(".") || "(전체)"} 가 없습니다.`,
        { details: { ...context, expression, available: results[reference.step] } },
      );
    }
    return value;
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      resolved[key] = value;
      continue;
    }

    const whole = WHOLE.exec(value);
    if (whole?.[1] !== undefined) {
      // 타입을 유지한다.
      resolved[key] = resolveOne(whole[1]);
      continue;
    }

    resolved[key] = value.replace(PLACEHOLDER, (_all, expression: string) =>
      String(resolveOne(expression)),
    );
  }
  return resolved;
}
