import type { PhotoshopBridge, PhotoshopCommand } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PermissionPolicy, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type {
  CommandContext,
  CommandHandler,
  CommandOptions,
} from "../registry/command-registry.js";
import { CommandRegistry } from "../registry/command-registry.js";
import { validateParams } from "../validation/validate-params.js";

export interface CommandEngineOptions {
  /** 사용할 레지스트리. 생략하면 빈 레지스트리를 새로 만든다. */
  registry?: CommandRegistry;
  /** Photoshop 접근 통로. */
  bridge: PhotoshopBridge;
  /** correlation ID 생성기. 생략하면 `req-1` 형태의 순번을 사용한다. */
  requestIdFactory?: () => string;
  /**
   * Permission 정책. 생략하면 기본 정책(`read` · `edit` 만 허용)을 쓴다.
   *
   * 여기가 Permission 의 **강제 지점**이다. Extension 은 Tool 을 거치지 않고
   * 이 엔진을 직접 호출하므로(ARCHITECTURE §3.2), Tool 에서만 막으면 우회로가 생긴다.
   */
  policy?: PermissionPolicy;
}

export interface ExecuteOptions {
  /** 상위 계층에서 이미 발급한 correlation ID. */
  requestId?: string;
  /**
   * 이 호출에만 적용할 더 좁은 정책. Extension 호출을 manifest 선언으로 가둘 때 쓴다.
   *
   * 엔진 정책을 **넓힐 수는 없다.** 두 정책을 모두 통과해야 실행된다.
   */
  policy?: PermissionPolicy;
  /** 진단용. Extension 을 통한 호출이면 그 namespace. */
  namespace?: string;
}

/**
 * Command 실행 계층. (ARCHITECTURE §6)
 *
 * MCP 에 의존하지 않는다. Extension 도 MCP Tool 을 거치지 않고 이 엔진을 직접 사용한다.
 *
 * 흐름: 검증 → 레지스트리 조회 → 핸들러 실행 → 오류 정규화
 */
export class CommandEngine {
  readonly #registry: CommandRegistry;
  readonly #bridge: PhotoshopBridge;
  readonly #requestIdFactory: () => string;
  readonly #policy: PermissionPolicy;
  #sequence = 0;

  constructor(options: CommandEngineOptions) {
    this.#registry = options.registry ?? new CommandRegistry();
    this.#bridge = options.bridge;
    this.#requestIdFactory = options.requestIdFactory ?? (() => `req-${++this.#sequence}`);
    this.#policy = options.policy ?? new PermissionPolicy();
  }

  /** 이 엔진에 걸린 Permission 정책. */
  get policy(): PermissionPolicy {
    return this.#policy;
  }

  get registry(): CommandRegistry {
    return this.#registry;
  }

  get bridge(): PhotoshopBridge {
    return this.#bridge;
  }

  /** {@link CommandRegistry.register} 위임. */
  register<TParams, TResult>(
    type: string,
    handler: CommandHandler<TParams, TResult>,
    options: CommandOptions<TParams>,
  ): void {
    this.#registry.register(type, handler, options);
  }

  /**
   * Command 를 실행한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `INVALID_PARAMETER` — Command 형식이 올바르지 않음
   *   - `COMMAND_NOT_SUPPORTED` — 등록되지 않은 Command
   *   - `PERMISSION_DENIED` — 요구 Permission Level 이 허용되지 않음
   *   - 그 외 핸들러/Bridge 가 던진 오류는 `PhotoshopMcpError` 로 정규화되어 전파된다
   */
  async execute<TResult>(
    command: PhotoshopCommand,
    options: ExecuteOptions = {},
  ): Promise<TResult> {
    this.#validate(command);

    const entry = this.#registry.get(command.type);
    if (entry === undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `등록되지 않은 Command 입니다: ${command.type}`,
        { details: { type: command.type, registered: this.#registry.list() } },
      );
    }

    // Permission 을 먼저 본다. 거부될 호출이면 파라미터 검증도 낭비다.
    // 호출별 정책이 있으면 둘 다 통과해야 한다. 좁히기만 가능하다.
    const subject = {
      kind: "command" as const,
      name: command.type,
      ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    };
    this.#policy.assert(entry.permission, subject);
    options.policy?.assert(entry.permission, subject);

    // 스키마가 등록된 Command 는 실행 전에 파라미터를 검증한다.
    // 검증 실패는 INVALID_PARAMETER 로, 실행 실패와 구분된다.
    const validated =
      entry.schema === undefined
        ? command
        : { ...command, params: validateParams(command.type, entry.schema, command.params) };

    const context: CommandContext = {
      bridge: this.#bridge,
      requestId: options.requestId ?? this.#requestIdFactory(),
    };

    try {
      return (await entry.handler(validated as PhotoshopCommand<never>, context)) as TResult;
    } catch (error) {
      throw PhotoshopMcpError.from(error, ErrorCode.COMMAND_FAILED);
    }
  }

  /** Command 의 최소 형식을 검증한다. 파라미터 단위 검증은 각 핸들러의 책임이다. */
  #validate(command: PhotoshopCommand): void {
    if (typeof command !== "object" || command === null) {
      throw new PhotoshopMcpError(ErrorCode.INVALID_PARAMETER, "Command 는 객체여야 합니다.", {
        details: { received: typeof command },
      });
    }
    if (typeof command.type !== "string" || command.type.trim().length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        "Command.type 은 비어 있지 않은 문자열이어야 합니다.",
        { details: { received: command.type } },
      );
    }
  }
}
