import { z } from "zod";

/**
 * Event 계약. (ARCHITECTURE §21, ROADMAP §15)
 *
 * ```text
 * Photoshop → UXP 알림 → Bridge → Event Log → Extension / LLM
 * ```
 *
 * ## LLM 은 구독하지 않고 조회한다
 *
 * MCP 에는 임의 이벤트를 클라이언트로 밀어주는 통로가 없다. `notifications/progress`
 * 처럼 정해진 알림만 있고, LLM 이 구독할 수 있는 일반 이벤트 채널은 스펙에 없다.
 *
 * 그래서 이벤트는 두 갈래로 쓴다.
 *
 * - **Extension** — `context.events.on(...)` 으로 구독한다. 서버 안에서 즉시 받는다.
 * - **LLM** — `photoshop.event.recent` 로 최근 기록을 조회한다.
 *
 * ## 이름을 짐작하지 않는다
 *
 * UXP 알림은 batchPlay 액션 이름(`make` · `delete` · `set`)으로 오지 `layer.created`
 * 같은 친절한 이름으로 오지 않는다. 해석에 확신이 없으면 `photoshop.unknown` 으로
 * 두고 **원본을 그대로 보존한다.**
 *
 * 이 프로젝트는 `bitDepth` · `layer.kind` · `blendMode` 에서 같은 방식으로 세 번
 * 실제 버그를 잡았다. 그럴듯한 기본값으로 덮으면 틀린 것을 알 수 없다.
 */

/**
 * 이벤트 이름.
 *
 * `photoshop.*` 은 Photoshop 에서 온 것, `command.*` 은 서버가 만든 것이다.
 * 열거형으로 고정하지 않는다 — Photoshop 이 무엇을 보내는지 다 알지 못한다.
 */
export const EventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9_]*)+$/u, {
    message: "이벤트 이름은 `photoshop.layer.created` 처럼 점으로 구분한 형태여야 합니다.",
  });

/** 서버가 만드는 Command 수명 이벤트. Photoshop 연결이 없어도 발생한다. */
export const COMMAND_STARTED = "command.started";
export const COMMAND_COMPLETED = "command.completed";
export const COMMAND_FAILED = "command.failed";

/**
 * 해석하지 못한 Photoshop 알림.
 *
 * 무엇인지 모르겠다고 버리지 않는다. 기록해 두면 나중에 매핑을 넓힐 때 실제로
 * 무엇이 오는지 볼 수 있다.
 */
export const PHOTOSHOP_UNKNOWN = "photoshop.unknown";

/** 기록된 이벤트 한 건. */
export interface EventRecord {
  /** 단조 증가하는 일련번호. 조회할 때 "이후 것만" 을 고르는 데 쓴다. */
  seq: number;
  name: string;
  /** epoch ms. */
  at: number;
  /** 해석된 내용. 해석하지 못했으면 비어 있다. */
  data: Record<string, unknown>;
  /**
   * Plugin 이 보낸 원본.
   *
   * 해석이 틀렸을 때 확인할 수 있어야 한다. 서버가 만든 이벤트에는 없다.
   */
  raw?: unknown;
}

/** 이벤트 조회 조건. */
export interface EventQuery {
  /** 이 일련번호보다 큰 것만. 폴링할 때 마지막으로 본 번호를 넘긴다. */
  after?: number;
  /** 이 이름으로 시작하는 것만. `photoshop.` 처럼 앞부분만 줘도 된다. */
  prefix?: string;
  /** 최대 개수. */
  limit?: number;
}

/** 이벤트 구독 해제. */
export type Unsubscribe = () => void;

/**
 * Extension 에 주어지는 이벤트 표면.
 *
 * 발행은 노출하지 않는다. Extension 은 일어난 일을 **들을** 수 있을 뿐,
 * 일어나지 않은 일을 만들어낼 수 없다. (ARCHITECTURE §17)
 */
export interface ExtensionEventBus {
  /**
   * 이벤트를 구독한다.
   *
   * @param name 정확한 이름 또는 `photoshop.` 같은 접두사. `*` 는 전부.
   * @returns 구독 해제 함수. Extension 이 unload 될 때 자동으로 해제된다.
   */
  on(name: string, listener: (event: EventRecord) => void): Unsubscribe;
  /** 최근 기록. */
  recent(query?: EventQuery): EventRecord[];
}
