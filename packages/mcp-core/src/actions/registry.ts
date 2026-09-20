import { readFile } from "node:fs/promises";
import type { ActionConfig, ActionDeclaration, Logger } from "@photoshop-mcp/photoshop-bridge";
import { ActionConfigSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";

/**
 * 액션 허용 목록. (ROADMAP §17.35)
 *
 * `CapabilityRegistry`(§19)와 같은 자리다 — 사용자가 설정에 선언한 것만
 * 부를 수 있게 한다. 다른 점은 액션의 경우 **내용을 볼 수 없다**는 것이고,
 * 그래서 실행 permission 은 언제나 `destructive` 다.
 *
 * 선언이 없으면 이 레지스트리는 비어 있고 `action.run` 은 아무것도 못 한다.
 * **조회(`action.list`)는 선언과 무관하게 된다** — 사용자가 선언을 쓰려면
 * 먼저 이름을 봐야 하기 때문이다.
 */
export interface ActionRegistryOptions {
  logger: Logger;
}

export class ActionRegistry {
  readonly #declarations = new Map<string, ActionDeclaration>();
  readonly #logger: Logger;

  constructor(options: ActionRegistryOptions) {
    this.#logger = options.logger;
  }

  get size(): number {
    return this.#declarations.size;
  }

  list(): { name: string; declaration: ActionDeclaration }[] {
    return [...this.#declarations.entries()].map(([name, declaration]) => ({
      name,
      declaration,
    }));
  }

  /**
   * 선언을 찾는다.
   *
   * **없으면 거절하고 있는 이름을 함께 준다.** 조용히 실패하면 호출자가
   * 오타인지 선언을 안 한 것인지 알 수 없다.
   */
  require(name: string): ActionDeclaration {
    const found = this.#declarations.get(name);
    if (found !== undefined) {
      return found;
    }
    throw new PhotoshopMcpError(
      ErrorCode.INVALID_PARAMETER,
      this.#declarations.size === 0
        ? "선언된 액션이 없습니다. actions.json 에 선언해야 부를 수 있습니다 — " +
            "photoshop.action.list 로 세트·액션 이름을 먼저 확인하세요."
        : `'${name}' 은 선언되지 않았습니다. actions.json 에 있는 것만 부를 수 있습니다.`,
      { recoverable: true, details: { name, available: [...this.#declarations.keys()] } },
    );
  }

  register(name: string, declaration: ActionDeclaration): void {
    if (this.#declarations.has(name)) {
      throw new PhotoshopMcpError(
        ErrorCode.DUPLICATE_COMMAND,
        `액션 선언 '${name}' 이 이미 있습니다.`,
        { details: { name } },
      );
    }
    this.#declarations.set(name, declaration);
  }

  /**
   * `actions.json` 을 읽는다.
   *
   * **파일이 없으면 조용히 넘어간다.** 액션을 안 쓰는 것은 정상이다.
   * 있는데 내용이 잘못되면 던진다 — 오타로 선언이 빠진 것을 넘기지 않는다.
   *
   * @returns 등록한 수
   */
  async loadConfig(path: string): Promise<number> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      return 0;
    }

    let parsed: ActionConfig;
    try {
      parsed = ActionConfigSchema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      throw new PhotoshopMcpError(ErrorCode.INVALID_PARAMETER, `${path} 을 읽지 못했습니다.`, {
        details: { path },
        cause: error,
      });
    }

    let count = 0;
    for (const [name, declaration] of Object.entries(parsed)) {
      this.register(name, declaration);
      count += 1;
    }
    this.#logger.debug?.(`액션 선언 ${count}개를 적재했습니다: ${path}`);
    return count;
  }
}
