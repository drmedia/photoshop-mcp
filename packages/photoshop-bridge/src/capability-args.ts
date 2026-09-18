import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import type { ParameterSpec, ProviderConfig } from "./capability.js";

/**
 * 인자 조립. (ARCHITECTURE §23.2 와 같은 원칙)
 *
 * batchPlay descriptor 를 플러그인이 검증된 파라미터로 조립하듯, argv 도 Provider
 * 정의가 조립한다. 호출자가 문자열을 그대로 argv 에 넣는 통로를 만들지 않는다.
 *
 * 조립 결과는 배열이며 shell 을 거치지 않는다. 따라서 값 안의 공백·따옴표·`&&` 는
 * 한 인자의 내용일 뿐 명령 구분자가 되지 않는다.
 */

/**
 * 자리표시자.
 *
 * 이름을 ASCII 로 좁히지 않는다. `{{오타}}` 같은 것이 검사를 빠져나가 **그대로 인자가
 * 되어버리기** 때문이다. 어떤 `{{...}}` 든 자리표시자로 보고, 선언되지 않았으면
 * 설정 오류로 거부한다.
 */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/gu;

/** 템플릿이 쓰는 자리표시자 이름. */
export function placeholdersIn(args: readonly string[]): string[] {
  const names = new Set<string>();
  for (const arg of args) {
    for (const match of arg.matchAll(PLACEHOLDER)) {
      if (match[1] !== undefined) {
        names.add(match[1]);
      }
    }
  }
  return [...names];
}

/**
 * 설정이 일관적인지 검사한다. 설정을 읽을 때 한 번 한다.
 *
 * 선언하지 않은 자리표시자를 쓰면 **설정 오류**다. 실행 시점에 빈 문자열로 바꾸면
 * 프로그램이 엉뚱한 인자로 돌아간다.
 *
 * @throws {PhotoshopMcpError} `INVALID_PARAMETER`
 */
export function assertConfigConsistent(config: ProviderConfig): void {
  const declared = new Set<string>([
    "input",
    "output",
    ...Object.keys(config.outputs ?? {}).map((name) => `output.${name}`),
    ...Object.keys(config.params ?? {}),
  ]);
  const unknown = placeholdersIn(config.args).filter((name) => !declared.has(name));

  if (unknown.length > 0) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `Provider '${config.id}' 의 args 가 선언되지 않은 자리표시자를 씁니다: ` +
        `${unknown.join(", ")}. params 에 선언하거나 input · output 을 쓰세요.`,
      { details: { provider: config.id, unknown, declared: [...declared] } },
    );
  }

  // 선언한 추가 출력을 템플릿이 쓰지 않으면 그 파일은 만들어지지 않는다.
  // 선언만 해두고 인자에 넣지 않은 것은 설정 실수다.
  const used = new Set(placeholdersIn(config.args));
  const unused = Object.keys(config.outputs ?? {}).filter((name) => !used.has(`output.${name}`));
  if (unused.length > 0) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `Provider '${config.id}' 가 추가 출력을 선언했지만 args 에서 쓰지 않습니다: ` +
        `${unused.join(", ")}. 템플릿에 {{output.<이름>}} 을 넣으세요.`,
      { details: { provider: config.id, unused } },
    );
  }

  // 기본값도 선언을 만족해야 한다. 아니면 파라미터를 생략했을 때만 터진다.
  for (const [name, spec] of Object.entries(config.params ?? {})) {
    if (spec.default !== undefined) {
      coerce(config.id, name, spec, spec.default);
    }
  }
}

/**
 * 값 하나를 선언에 맞춰 검증하고 문자열로 만든다.
 *
 * @throws {PhotoshopMcpError} `INVALID_PARAMETER`
 */
function coerce(
  providerId: string,
  name: string,
  spec: ParameterSpec,
  value: string | number | boolean,
): string {
  const fail = (message: string): never => {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `Provider '${providerId}' 의 파라미터 '${name}': ${message}`,
      { details: { provider: providerId, parameter: name, received: value } },
    );
  };

  if (spec.type === "enum") {
    if (typeof value !== "string") {
      return fail(`문자열이어야 합니다. 허용: ${spec.values.join(", ")}`);
    }
    // 허용 목록 밖의 값은 argv 에 닿지 못한다. 자유 문자열을 넣지 않는 이유다.
    if (!spec.values.includes(value)) {
      return fail(`허용되지 않은 값입니다. 허용: ${spec.values.join(", ")}`);
    }
    return value;
  }

  if (spec.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fail("유한한 숫자여야 합니다.");
    }
    if (spec.integer === true && !Number.isInteger(value)) {
      return fail("정수여야 합니다.");
    }
    if (spec.min !== undefined && value < spec.min) {
      return fail(`${spec.min} 이상이어야 합니다.`);
    }
    if (spec.max !== undefined && value > spec.max) {
      return fail(`${spec.max} 이하여야 합니다.`);
    }
    return String(value);
  }

  if (typeof value !== "boolean") {
    return fail("true 또는 false 여야 합니다.");
  }
  return value ? "true" : "false";
}

export interface BuildArgsInput {
  config: ProviderConfig;
  /** 해석이 끝난 입력 파일의 절대 경로. */
  inputPath: string;
  /**
   * 해석이 끝난 출력 경로. 주 출력은 `output` 키에 담는다.
   *
   * 추가 출력은 선언한 이름 그대로 담는다. 템플릿의 `{{output.stars}}` 는
   * `outputPaths.stars` 를 쓴다.
   */
  outputPaths: Record<string, string>;
  params?: Record<string, string | number | boolean>;
}

/**
 * 실행할 argv 를 만든다.
 *
 * @throws {PhotoshopMcpError} `INVALID_PARAMETER`
 *   - 선언되지 않은 파라미터를 넘긴 경우
 *   - 값이 선언을 만족하지 않는 경우
 *   - 기본값 없는 파라미터를 생략한 경우
 */
export function buildArgs(input: BuildArgsInput): string[] {
  const { config, params = {} } = input;
  const specs = config.params ?? {};

  // 선언되지 않은 이름을 조용히 무시하지 않는다. 호출자가 오타를 알아야 한다.
  const undeclared = Object.keys(params).filter((name) => !(name in specs));
  if (undeclared.length > 0) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `Provider '${config.id}' 가 받지 않는 파라미터입니다: ${undeclared.join(", ")}. ` +
        `받는 것: ${Object.keys(specs).join(", ") || "(없음)"}`,
      { details: { provider: config.id, undeclared, accepted: Object.keys(specs) } },
    );
  }

  const values: Record<string, string> = { input: input.inputPath };
  for (const [name, path] of Object.entries(input.outputPaths)) {
    values[name === "output" ? "output" : `output.${name}`] = path;
  }

  // 선언한 추가 출력이 모두 준비되었는지 확인한다.
  // 빠진 채로 실행하면 빈 문자열이 인자로 들어가 처리기가 엉뚱하게 동작한다.
  const missing = Object.keys(config.outputs ?? {}).filter(
    (name) => input.outputPaths[name] === undefined,
  );
  if (missing.length > 0) {
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      `Provider '${config.id}' 는 추가 출력 파일 이름이 필요합니다: ${missing.join(", ")}`,
      { details: { provider: config.id, missing, declared: Object.keys(config.outputs ?? {}) } },
    );
  }

  for (const [name, spec] of Object.entries(specs)) {
    const given = params[name];
    const effective = given ?? spec.default;
    if (effective === undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        `Provider '${config.id}' 의 파라미터 '${name}' 이 필요합니다. 기본값이 없습니다.`,
        { details: { provider: config.id, parameter: name } },
      );
    }
    values[name] = coerce(config.id, name, spec, effective);
  }

  return config.args.map((arg) =>
    arg.replace(PLACEHOLDER, (_whole, name: string) => values[name] ?? ""),
  );
}
