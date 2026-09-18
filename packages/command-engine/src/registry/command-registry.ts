import type { PhotoshopBridge, PhotoshopCommand } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";

/** Command 실행 시 핸들러에 전달되는 컨텍스트. */
export interface CommandContext {
  /** Photoshop 접근 통로. 핸들러는 이 Bridge 만 사용한다. */
  bridge: PhotoshopBridge;
  /** MCP 요청부터 Bridge 호출까지 추적하는 correlation ID. (ARCHITECTURE §31) */
  requestId: string;
}

export type CommandHandler<TParams = unknown, TResult = unknown> = (
  command: PhotoshopCommand<TParams>,
  context: CommandContext,
) => Promise<TResult>;

/**
 * Command 핸들러 레지스트리. (ARCHITECTURE §7)
 *
 * Command 를 추가할 때 Dispatcher 를 수정하지 않아도 되도록 등록 기반으로 관리한다.
 */
export class CommandRegistry {
  readonly #handlers = new Map<string, CommandHandler<never, unknown>>();

  /**
   * Command 핸들러를 등록한다.
   *
   * @throws {PhotoshopMcpError} 같은 타입이 이미 등록된 경우 `DUPLICATE_COMMAND`.
   */
  register<TParams, TResult>(type: string, handler: CommandHandler<TParams, TResult>): void {
    const normalized = type.trim();
    if (normalized.length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        "Command 타입은 비어 있을 수 없습니다.",
      );
    }
    if (this.#handlers.has(normalized)) {
      throw new PhotoshopMcpError(
        ErrorCode.DUPLICATE_COMMAND,
        `이미 등록된 Command 입니다: ${normalized}`,
        { details: { type: normalized } },
      );
    }
    this.#handlers.set(normalized, handler as CommandHandler<never, unknown>);
  }

  get(type: string): CommandHandler<never, unknown> | undefined {
    return this.#handlers.get(type);
  }

  has(type: string): boolean {
    return this.#handlers.has(type);
  }

  /** 등록된 Command 타입 목록. */
  list(): string[] {
    return [...this.#handlers.keys()];
  }

  get size(): number {
    return this.#handlers.size;
  }
}
