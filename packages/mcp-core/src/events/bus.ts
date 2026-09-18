import type { EventQuery, EventRecord, Logger, Unsubscribe } from "@photoshop-mcp/photoshop-bridge";
import { PHOTOSHOP_UNKNOWN } from "@photoshop-mcp/photoshop-bridge";

/**
 * Event Bus 와 로그. (ARCHITECTURE §21, ROADMAP §15)
 *
 * 구독자에게 즉시 전달하고, 최근 기록을 링 버퍼에 남긴다.
 *
 * 로그가 필요한 이유는 MCP 때문이다. MCP 에는 임의 이벤트를 클라이언트로 밀어주는
 * 통로가 없어서 LLM 은 조회해야 한다. 구독만 있으면 LLM 은 아무것도 볼 수 없다.
 */

export interface EventBusOptions {
  logger: Logger;
  /**
   * 보관할 최대 개수. 넘으면 오래된 것부터 버린다.
   *
   * Photoshop 은 사용자가 조금만 움직여도 알림을 쏟아낸다. 무한정 쌓으면 샌다.
   */
  capacity?: number;
}

interface Subscription {
  /** 정확한 이름, 접두사, 또는 `*`. */
  pattern: string;
  listener: (event: EventRecord) => void;
  /** 누가 구독했는지. Extension 이 unload 될 때 정리한다. */
  owner: string | null;
}

const DEFAULT_CAPACITY = 500;

/** 패턴이 이름에 맞는지. `*` 는 전부, 그 외에는 정확히 같거나 접두사. */
function matches(pattern: string, name: string): boolean {
  if (pattern === "*") {
    return true;
  }
  if (pattern === name) {
    return true;
  }
  // `photoshop.` 처럼 점으로 끝나면 접두사로 본다.
  // `photoshop` 만 준 경우도 `photoshop.` 아래를 잡아준다.
  const prefix = pattern.endsWith(".") ? pattern : `${pattern}.`;
  return name.startsWith(prefix);
}

export class EventBus {
  readonly #records: EventRecord[] = [];
  readonly #subscriptions = new Set<Subscription>();
  readonly #logger: Logger;
  readonly #capacity: number;
  #nextSeq = 1;

  constructor(options: EventBusOptions) {
    this.#logger = options.logger;
    this.#capacity = options.capacity ?? DEFAULT_CAPACITY;
  }

  get size(): number {
    return this.#records.length;
  }

  /** 마지막 일련번호. 폴링 시작점으로 쓴다. */
  get lastSeq(): number {
    return this.#nextSeq - 1;
  }

  /**
   * 이벤트를 발행한다.
   *
   * 구독자가 던진 오류는 삼킨다. 한 구독자의 버그가 다른 구독자와 이벤트 흐름 전체를
   * 막으면 안 된다.
   */
  emit(name: string, data: Record<string, unknown> = {}, raw?: unknown): EventRecord {
    const record: EventRecord = {
      seq: this.#nextSeq++,
      name,
      at: Date.now(),
      data,
      ...(raw === undefined ? {} : { raw }),
    };

    this.#records.push(record);
    if (this.#records.length > this.#capacity) {
      this.#records.splice(0, this.#records.length - this.#capacity);
    }

    for (const subscription of this.#subscriptions) {
      if (!matches(subscription.pattern, name)) {
        continue;
      }
      try {
        subscription.listener(record);
      } catch (error) {
        this.#logger.error(
          `이벤트 구독자가 실패했습니다: ${name}`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return record;
  }

  /**
   * Plugin 이 보낸 알림을 기록한다.
   *
   * 이름을 해석하지 못하면 `photoshop.unknown` 으로 두고 **원본을 보존한다.**
   * 그럴듯한 이름으로 덮으면 틀린 것을 알 수 없다.
   */
  emitFromPlugin(name: string, payload: unknown): EventRecord {
    const known = /^photoshop\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9_]*$/u.test(name);
    const data =
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};

    return known
      ? this.emit(name, data, payload)
      : this.emit(PHOTOSHOP_UNKNOWN, { reported: name, ...data }, payload);
  }

  /**
   * 구독한다.
   *
   * @param pattern 정확한 이름, `photoshop.` 같은 접두사, 또는 `*`.
   */
  on(
    pattern: string,
    listener: (event: EventRecord) => void,
    options: { owner?: string } = {},
  ): Unsubscribe {
    const subscription: Subscription = {
      pattern,
      listener,
      owner: options.owner ?? null,
    };
    this.#subscriptions.add(subscription);
    return () => {
      this.#subscriptions.delete(subscription);
    };
  }

  /** 그 소유자의 구독을 모두 해제한다. Extension unload 에 쓴다. */
  offOwner(owner: string): number {
    let removed = 0;
    for (const subscription of [...this.#subscriptions]) {
      if (subscription.owner === owner) {
        this.#subscriptions.delete(subscription);
        removed += 1;
      }
    }
    return removed;
  }

  /** 최근 기록. 오래된 것부터. */
  recent(query: EventQuery = {}): EventRecord[] {
    const filtered = this.#records
      .filter((record) => query.after === undefined || record.seq > query.after)
      .filter((record) => query.prefix === undefined || matches(query.prefix, record.name));

    // 개수를 자를 때는 **최신 쪽**을 남긴다. 오래된 것을 남기면 폴링이 앞으로 못 간다.
    return query.limit === undefined ? filtered : filtered.slice(-query.limit);
  }

  /** 구독자 수. 진단용. */
  get subscriberCount(): number {
    return this.#subscriptions.size;
  }
}
