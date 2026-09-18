import type { ZodType } from "zod";
import { ZodError } from "zod";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";

/** Tool 핸들러에 전달되는 컨텍스트. */
export interface ToolContext {
  /** MCP 요청부터 Bridge 호출까지 추적하는 correlation ID. (ARCHITECTURE §31) */
  requestId: string;
}

export type ToolHandler<TInput = unknown, TResult = unknown> = (
  input: TInput,
  context: ToolContext,
) => Promise<TResult>;

/**
 * MCP 로 노출되는 Tool 정의. (ARCHITECTURE §5)
 *
 * MCP 서버 구현과 Tool 정의가 서로를 참조하지 않도록 contracts 계층에 둔다.
 */
export interface ToolDefinition<TInput = unknown, TResult = unknown> {
  /** 점으로 구분된 Tool 이름. 예: `photoshop.layer.list` */
  name: string;
  description: string;
  /** 입력 스키마. Tool 호출 전에 이 스키마로 인자를 검증한다. */
  inputSchema: ZodType<TInput>;
  handler: ToolHandler<TInput, TResult>;
}

/**
 * Tool 레지스트리. (ARCHITECTURE §5)
 *
 * Phase 1 은 등록 · 조회 · 목록 · 입력 검증만 담당한다.
 * namespace 검증과 Extension 통합은 Phase 5 범위다.
 */
export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition<never, unknown>>();

  /**
   * Tool 을 등록한다.
   *
   * @throws {PhotoshopMcpError} 같은 이름이 이미 등록된 경우 `DUPLICATE_TOOL`.
   */
  register<TInput, TResult>(tool: ToolDefinition<TInput, TResult>): void {
    const name = tool.name.trim();
    if (name.length === 0) {
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        "Tool 이름은 비어 있을 수 없습니다.",
      );
    }
    if (this.#tools.has(name)) {
      throw new PhotoshopMcpError(ErrorCode.DUPLICATE_TOOL, `이미 등록된 Tool 입니다: ${name}`, {
        details: { name },
      });
    }
    this.#tools.set(name, tool as unknown as ToolDefinition<never, unknown>);
  }

  get(name: string): ToolDefinition<never, unknown> | undefined {
    return this.#tools.get(name);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  /** 등록 순서를 유지한 Tool 목록. */
  list(): ToolDefinition<never, unknown>[] {
    return [...this.#tools.values()];
  }

  get size(): number {
    return this.#tools.size;
  }

  /**
   * Tool 을 찾아 입력을 검증한 뒤 실행한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `TOOL_NOT_FOUND` — 등록되지 않은 Tool
   *   - `INVALID_PARAMETER` — 입력이 스키마를 만족하지 않음
   */
  async invoke<TResult = unknown>(
    name: string,
    input: unknown,
    context: ToolContext,
  ): Promise<TResult> {
    const tool = this.#tools.get(name);
    if (tool === undefined) {
      throw new PhotoshopMcpError(ErrorCode.TOOL_NOT_FOUND, `등록되지 않은 Tool 입니다: ${name}`, {
        details: { name, registered: this.list().map((entry) => entry.name) },
      });
    }

    let parsed: never;
    try {
      parsed = tool.inputSchema.parse(input ?? {}) as never;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PhotoshopMcpError(
          ErrorCode.INVALID_PARAMETER,
          `Tool 입력이 올바르지 않습니다: ${name}`,
          { details: { name, issues: error.issues }, cause: error },
        );
      }
      throw PhotoshopMcpError.from(error, ErrorCode.INVALID_PARAMETER);
    }

    return (await tool.handler(parsed, context)) as TResult;
  }
}
