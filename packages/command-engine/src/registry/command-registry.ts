import type {
  PermissionLevel,
  PhotoshopBridge,
  PhotoshopCommand,
} from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import type { ZodType } from "zod";

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

/** Command 등록 옵션. */
export interface CommandOptions<TParams = unknown> {
  /**
   * 요구 Permission Level. (ARCHITECTURE §22)
   *
   * 선택 필드가 아니다. Command 는 Photoshop 을 바꾸는 유일한 통로이므로
   * (ARCHITECTURE §23.3) 여기에 기본값을 두면 안전 규칙이 무너진다.
   */
  permission: PermissionLevel;
  /**
   * 파라미터 스키마. 생략하면 검증하지 않는다.
   *
   * Extension 이 Tool 을 거치지 않고 Engine 을 직접 호출하므로,
   * 파라미터를 받는 Command 는 스키마를 함께 등록한다. (ARCHITECTURE §3.2)
   */
  schema?: ZodType<TParams>;
}

/** 등록된 Command 한 건. */
export interface CommandEntry<TParams = unknown, TResult = unknown> {
  handler: CommandHandler<TParams, TResult>;
  permission: PermissionLevel;
  schema?: ZodType<TParams>;
}

/**
 * Command 핸들러 레지스트리. (ARCHITECTURE §7)
 *
 * Command 를 추가할 때 Dispatcher 를 수정하지 않아도 되도록 등록 기반으로 관리한다.
 */
export class CommandRegistry {
  readonly #entries = new Map<string, CommandEntry<never, unknown>>();

  /**
   * Command 핸들러를 등록한다.
   *
   * @param options `permission` 은 필수다. `schema` 를 주면
   *   {@link CommandEngine} 이 실행 전에 파라미터를 검증한다.
   * @throws {PhotoshopMcpError} 같은 타입이 이미 등록된 경우 `DUPLICATE_COMMAND`.
   */
  register<TParams, TResult>(
    type: string,
    handler: CommandHandler<TParams, TResult>,
    options: CommandOptions<TParams>,
  ): void {
    const normalized = type.trim();
    if (normalized.length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        "Command 타입은 비어 있을 수 없습니다.",
      );
    }
    if (this.#entries.has(normalized)) {
      throw new PhotoshopMcpError(
        ErrorCode.DUPLICATE_COMMAND,
        `이미 등록된 Command 입니다: ${normalized}`,
        { details: { type: normalized } },
      );
    }
    this.#entries.set(normalized, {
      handler: handler as CommandHandler<never, unknown>,
      permission: options.permission,
      ...(options.schema === undefined
        ? {}
        : { schema: options.schema as unknown as ZodType<never> }),
    });
  }

  /** 등록된 Command. 핸들러와 스키마를 함께 돌려준다. */
  get(type: string): CommandEntry<never, unknown> | undefined {
    return this.#entries.get(type);
  }

  has(type: string): boolean {
    return this.#entries.has(type);
  }

  /** 등록된 Command 타입 목록. */
  list(): string[] {
    return [...this.#entries.keys()];
  }

  /** Command 의 요구 Permission Level. 등록되지 않았으면 `undefined`. */
  permissionOf(type: string): PermissionLevel | undefined {
    return this.#entries.get(type)?.permission;
  }

  get size(): number {
    return this.#entries.size;
  }
}
