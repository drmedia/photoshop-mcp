import type { ZodType } from "zod";
import { ZodError } from "zod";
import type { PermissionLevel } from "./permission.js";
import { PermissionPolicy } from "./permission.js";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import { describeZodIssues } from "./protocol/zod-message.js";

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
  /**
   * 요구 Permission Level. (ARCHITECTURE §22)
   *
   * 선택 필드가 아니다. 기본값을 두면 새 Tool 이 조용히 관대한 값을 갖는다.
   *
   * 이 값은 `tools/list` 노출용 메타데이터이자 빠른 실패용이다.
   * **실제 차단은 Command Engine 이 한다** — Extension 이 Tool 을 거치지 않고
   * Command 를 직접 호출할 수 있기 때문이다. (ARCHITECTURE §3.2)
   */
  permission: PermissionLevel;
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
  readonly #policy: PermissionPolicy;

  /**
   * 목록이 바뀌었을 때 부른다. (ROADMAP §18.3)
   *
   * Extension 은 기동 뒤에도 붙고 떨어진다 — 사용자가 패널에서 등록하면
   * 그때 Tool 이 늘어난다. **MCP 클라이언트는 `tools/list` 를 캐시하므로**
   * 알리지 않으면 새 Tool 이 영원히 보이지 않는다.
   *
   * `ResourceRegistry.setNotifier` 와 같은 구조다. 레지스트리는 MCP 를 모르고
   * 서버가 이 콜백을 채운다.
   */
  #onChange: (() => void) | null = null;

  /**
   * @param policy Permission 정책. 생략하면 기본 정책(`read` · `edit`).
   *
   * 여기서의 검사는 **빠른 실패**다. 실제 차단은 Command Engine 이 한다.
   * Tool 이 선언한 레벨이 실제 Command 보다 낮아도 Engine 이 잡는다.
   */
  constructor(policy: PermissionPolicy = new PermissionPolicy()) {
    this.#policy = policy;
  }

  /** 이 레지스트리에 걸린 Permission 정책. */
  get policy(): PermissionPolicy {
    return this.#policy;
  }

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
    this.#changed();
  }

  /** 목록 변경을 알릴 곳을 건다. 서버가 기동할 때 채운다. */
  setChangeListener(onChange: () => void): void {
    this.#onChange = onChange;
  }

  /** 알림이 실패해도 등록·해제는 성공이다. 삼킨다. */
  #changed(): void {
    try {
      this.#onChange?.();
    } catch {
      // 클라이언트가 이미 끊겼을 수 있다.
    }
  }

  /**
   * 등록을 해제한다.
   *
   * Extension 을 unload 할 때 그 Extension 이 등록한 Tool 을 되돌리는 데 쓴다.
   *
   * @returns 등록되어 있지 않았으면 `false`.
   */
  unregister(name: string): boolean {
    const removed = this.#tools.delete(name);
    if (removed) {
      this.#changed();
    }
    return removed;
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
   *   - `PERMISSION_DENIED` — Tool 이 선언한 Permission Level 이 허용되지 않음
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

    // 거부될 호출이면 입력 검증도 낭비다. Permission 을 먼저 본다.
    this.#policy.assert(tool.permission, { kind: "tool", name });

    let parsed: never;
    try {
      parsed = tool.inputSchema.parse(input ?? {}) as never;
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PhotoshopMcpError(
          ErrorCode.INVALID_PARAMETER,
          `Tool 입력이 올바르지 않습니다: ${name} — ${describeZodIssues(error)}`,
          // 고쳐서 다시 부를 수 있는 오류다. 입력만 바로잡으면 된다.
          { details: { name, issues: error.issues }, recoverable: true, cause: error },
        );
      }
      throw PhotoshopMcpError.from(error, ErrorCode.INVALID_PARAMETER);
    }

    return (await tool.handler(parsed, context)) as TResult;
  }
}
