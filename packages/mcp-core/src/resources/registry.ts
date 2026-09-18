import type { Logger } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";

/**
 * Resource 레지스트리. (ROADMAP §16, ARCHITECTURE §20)
 *
 * ## Tool 과 무엇이 다른가
 *
 * Tool 은 **행동**이고 Resource 는 **맥락**이다. 클라이언트는 Resource 를 미리
 * 읽어 대화에 붙일 수 있다. 같은 데이터라도 LLM 이 매번 Tool 을 부르지 않아도 된다.
 *
 * ## Phase 11 에서 못 한 것을 여기서 되찾는다
 *
 * MCP 에 **임의 이벤트**를 미는 통로는 없지만 `notifications/resources/updated` 는
 * 있다. 문서를 바꾸는 Command 가 끝나면 관련 리소스가 바뀌었다고 알린다.
 * 구독한 클라이언트는 폴링 없이 안다.
 */

export interface ResourceDefinition {
  /** `photoshop://layers` 같은 URI. */
  uri: string;
  name: string;
  description?: string;
  /** 기본 `application/json`. */
  mimeType?: string;
  /** 읽을 때마다 호출한다. 캐시하지 않는다 — Photoshop 상태는 계속 바뀐다. */
  read: () => Promise<unknown>;
}

export interface ResourceRegistryOptions {
  logger: Logger;
  /**
   * 구독 중인 리소스가 바뀌었을 때 부른다.
   *
   * MCP 서버 구현을 여기서 알지 않기 위해 함수로 받는다.
   */
  notify?: (uri: string) => void;
}

export class ResourceRegistry {
  readonly #resources = new Map<string, ResourceDefinition>();
  readonly #subscribed = new Set<string>();
  readonly #logger: Logger;
  #notify: ((uri: string) => void) | null;

  constructor(options: ResourceRegistryOptions) {
    this.#logger = options.logger;
    this.#notify = options.notify ?? null;
  }

  get size(): number {
    return this.#resources.size;
  }

  /** 알림 통로를 나중에 연결한다. 서버는 Core 조립 뒤에 만들어진다. */
  setNotifier(notify: (uri: string) => void): void {
    this.#notify = notify;
  }

  /**
   * @throws {PhotoshopMcpError} `DUPLICATE_COMMAND` — 같은 URI 가 이미 있음
   */
  register(definition: ResourceDefinition): void {
    if (this.#resources.has(definition.uri)) {
      throw new PhotoshopMcpError(
        ErrorCode.DUPLICATE_COMMAND,
        `이미 등록된 Resource 입니다: ${definition.uri}`,
        { details: { uri: definition.uri } },
      );
    }
    this.#resources.set(definition.uri, definition);
  }

  /** 등록을 해제한다. Extension unload 에 쓴다. */
  unregister(uri: string): boolean {
    this.#subscribed.delete(uri);
    return this.#resources.delete(uri);
  }

  list(): ResourceDefinition[] {
    return [...this.#resources.values()];
  }

  /**
   * 리소스를 읽는다.
   *
   * @throws {PhotoshopMcpError}
   *   - `COMMAND_NOT_SUPPORTED` — 없는 URI
   *   - 읽기 중 발생한 오류는 그대로 전파된다 (Photoshop 미연결 등)
   */
  async read(uri: string): Promise<{ definition: ResourceDefinition; contents: unknown }> {
    const definition = this.#resources.get(uri);
    if (definition === undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `등록되지 않은 Resource 입니다: ${uri}. 사용 가능: ${this.list()
          .map((entry) => entry.uri)
          .join(", ")}`,
        { details: { uri, available: this.list().map((entry) => entry.uri) } },
      );
    }
    return { definition, contents: await definition.read() };
  }

  subscribe(uri: string): void {
    if (!this.#resources.has(uri)) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `등록되지 않은 Resource 입니다: ${uri}`,
        { details: { uri } },
      );
    }
    this.#subscribed.add(uri);
  }

  unsubscribe(uri: string): void {
    this.#subscribed.delete(uri);
  }

  /** 구독 중인 URI. 진단용. */
  get subscriptions(): string[] {
    return [...this.#subscribed];
  }

  /**
   * 리소스가 바뀌었다고 알린다.
   *
   * **구독한 것만 보낸다.** 구독하지 않은 리소스까지 알리면 클라이언트가 관심 없는
   * 알림을 받는다. 알림 전송이 실패해도 삼킨다 — 알림 때문에 Command 가 실패하면 안 된다.
   */
  touch(...uris: string[]): void {
    for (const uri of uris) {
      if (!this.#subscribed.has(uri)) {
        continue;
      }
      try {
        this.#notify?.(uri);
      } catch (error) {
        this.#logger.debug(
          `Resource 알림 실패: ${uri}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }
}

/**
 * Command 가 바꾸는 리소스.
 *
 * 모르는 Command 는 문서와 레이어를 바꿨다고 본다. 알림을 덜 보내는 것보다
 * 더 보내는 쪽이 안전하다 — 덜 보내면 클라이언트가 낡은 값을 계속 쓴다.
 */
export function affectedResources(commandType: string): string[] {
  // 읽기를 **가장 먼저** 걸러낸다. 접두사 검사를 먼저 하면 `SELECTION_GET` 이
  // `SELECTION_` 에 걸려 읽기인데도 변경으로 분류된다. 실제로 그렇게 틀렸다.
  if (READ_ONLY.has(commandType)) {
    return [];
  }
  if (commandType === "DOCUMENT_EXPORT") {
    // 내보내기는 문서를 바꾸지 않는다. asCopy 로 저장하므로 열린 문서가 그대로다.
    return [];
  }
  if (commandType.startsWith("SELECTION_")) {
    return ["photoshop://selection"];
  }
  if (commandType.startsWith("WORKSPACE_") || commandType.startsWith("DOCUMENT_SAVE")) {
    return ["photoshop://document/current"];
  }
  return ["photoshop://layers", "photoshop://history", "photoshop://document/current"];
}

/** 아무것도 바꾸지 않는 Command. */
const READ_ONLY = new Set([
  "PING",
  "DOCUMENT_GET",
  "LAYER_LIST",
  "HISTORY_LIST",
  "SELECTION_GET",
  "WORKSPACE_STATUS",
  "WORKSPACE_USAGE",
]);
