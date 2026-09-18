import type { PhotoshopBridge, PhotoshopCommand } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { ZodType } from "zod";
import type { CommandContext, CommandHandler } from "../registry/command-registry.js";
import { CommandRegistry } from "../registry/command-registry.js";
import { validateParams } from "../validation/validate-params.js";

export interface CommandEngineOptions {
  /** 사용할 레지스트리. 생략하면 빈 레지스트리를 새로 만든다. */
  registry?: CommandRegistry;
  /** Photoshop 접근 통로. */
  bridge: PhotoshopBridge;
  /** correlation ID 생성기. 생략하면 `req-1` 형태의 순번을 사용한다. */
  requestIdFactory?: () => string;
}

export interface ExecuteOptions {
  /** 상위 계층에서 이미 발급한 correlation ID. */
  requestId?: string;
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
  #sequence = 0;

  constructor(options: CommandEngineOptions) {
    this.#registry = options.registry ?? new CommandRegistry();
    this.#bridge = options.bridge;
    this.#requestIdFactory = options.requestIdFactory ?? (() => `req-${++this.#sequence}`);
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
    schema?: ZodType<TParams>,
  ): void {
    this.#registry.register(type, handler, schema);
  }

  /**
   * Command 를 실행한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `INVALID_PARAMETER` — Command 형식이 올바르지 않음
   *   - `COMMAND_NOT_SUPPORTED` — 등록되지 않은 Command
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
