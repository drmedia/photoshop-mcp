/**
 * Command Dispatcher. (ARCHITECTURE §12)
 *
 * Command 이름을 실제 Photoshop 처리 코드에 연결한다.
 * Command 를 추가할 때 이 파일을 수정할 필요가 없도록 등록 기반으로 관리한다.
 *
 * 안전 규칙: Command 이름으로 코드를 동적 구성하지 않는다.
 * 등록된 Command 만 실행한다. (PROTOCOL.md §8)
 */

/** Plugin 이 상위로 보고하는 오류. PROTOCOL.md §5 의 오류 객체로 직렬화된다. */
export class DispatchError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly recoverable: boolean;

  constructor(
    code: string,
    message: string,
    options: { details?: unknown; recoverable?: boolean } = {},
  ) {
    super(message);
    this.name = "DispatchError";
    this.code = code;
    this.details = options.details;
    this.recoverable = options.recoverable ?? false;
  }

  toErrorPayload(): { code: string; message: string; details?: unknown; recoverable: boolean } {
    const payload: { code: string; message: string; details?: unknown; recoverable: boolean } = {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
    if (this.details !== undefined) {
      payload.details = this.details;
    }
    return payload;
  }
}

export type CommandPayload = Record<string, unknown>;

export type DispatchHandler = (payload: CommandPayload) => Promise<unknown>;

export class CommandDispatcher {
  private readonly handlers = new Map<string, DispatchHandler>();

  /**
   * Command 핸들러를 등록한다.
   *
   * @throws {DispatchError} 같은 Command 가 이미 등록된 경우.
   */
  register(command: string, handler: DispatchHandler): void {
    if (this.handlers.has(command)) {
      throw new DispatchError("COMMAND_ALREADY_REGISTERED", `이미 등록된 Command: ${command}`);
    }
    this.handlers.set(command, handler);
  }

  /** 등록된 핸들러를 감싼다. 감시 · 기록처럼 결과를 바꾸지 않는 용도다. */
  wrap(command: string, wrapper: (inner: DispatchHandler) => DispatchHandler): void {
    const inner = this.handlers.get(command);
    if (inner === undefined) {
      throw new DispatchError("COMMAND_NOT_SUPPORTED", `감쌀 Command 가 없습니다: ${command}`);
    }
    this.handlers.set(command, wrapper(inner));
  }

  has(command: string): boolean {
    return this.handlers.has(command);
  }

  /** 등록된 Command 목록. 핸드셰이크의 `commands` 필드로 보고한다. */
  list(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Command 를 실행한다.
   *
   * @throws {DispatchError}
   *   - `COMMAND_NOT_SUPPORTED` — 등록되지 않은 Command
   *   - 핸들러가 던진 오류는 `COMMAND_FAILED` 로 정규화된다
   */
  async dispatch(command: string, payload: CommandPayload): Promise<unknown> {
    const handler = this.handlers.get(command);
    if (handler === undefined) {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        `Plugin 이 지원하지 않는 Command: ${command}`,
        { details: { command, registered: this.list() } },
      );
    }

    try {
      return await handler(payload);
    } catch (error) {
      if (error instanceof DispatchError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new DispatchError("COMMAND_FAILED", message, { details: { command } });
    }
  }
}
