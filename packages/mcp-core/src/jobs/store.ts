import { randomUUID } from "node:crypto";
import type { JobContext, JobRecord, JobState, Logger } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, PhotoshopMcpError, isTerminal } from "@photoshop-mcp/photoshop-bridge";

/**
 * Job 저장소. (ARCHITECTURE §25, ROADMAP §14)
 *
 * MCP 요청은 60초 안에 끝나야 한다. 외부 처리기는 그보다 오래 걸린다.
 * 긴 작업은 여기에 등록하고 ID 만 돌려준 뒤 백그라운드로 돈다.
 *
 * 메모리에만 있다. 서버를 다시 띄우면 사라진다.
 */

export interface JobStoreOptions {
  logger: Logger;
  /**
   * 보관할 끝난 Job 의 최대 개수. 넘으면 오래된 것부터 버린다.
   *
   * 무한정 쌓이면 긴 세션에서 메모리가 샌다.
   */
  maxCompleted?: number;
}

interface JobEntry {
  record: JobRecord;
  controller: AbortController;
  /** 누가 시작했는지. Extension 은 자기 것만 볼 수 있다. */
  owner: string | null;
}

const DEFAULT_MAX_COMPLETED = 100;

export class JobStore {
  readonly #jobs = new Map<string, JobEntry>();
  readonly #logger: Logger;
  readonly #maxCompleted: number;

  constructor(options: JobStoreOptions) {
    this.#logger = options.logger;
    this.#maxCompleted = options.maxCompleted ?? DEFAULT_MAX_COMPLETED;
  }

  get size(): number {
    return this.#jobs.size;
  }

  /**
   * 작업을 시작하고 ID 를 즉시 돌려준다.
   *
   * `run` 이 던진 오류는 Job 의 `error` 가 된다. 호출자에게 전파되지 않는다 —
   * 이미 ID 를 돌려준 뒤이기 때문이다.
   */
  start<T>(
    kind: string,
    run: (context: JobContext) => Promise<T>,
    options: { owner?: string } = {},
  ): string {
    const id = randomUUID();
    const controller = new AbortController();
    const now = Date.now();

    const record: JobRecord = {
      id,
      kind,
      state: "queued",
      progress: { percent: null, message: "대기 중" },
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
    };

    this.#jobs.set(id, { record, controller, owner: options.owner ?? null });
    this.#prune();

    // 다음 틱에 시작한다. start() 가 먼저 ID 를 돌려주어야 호출자가
    // 그 ID 로 상태를 조회할 수 있다.
    queueMicrotask(() => {
      void this.#run(id, run);
    });

    return id;
  }

  /** Job. 없으면 `null`. `owner` 를 주면 그 소유자의 것만 본다. */
  get(id: string, owner?: string): JobRecord | null {
    const entry = this.#jobs.get(id);
    if (entry === undefined) {
      return null;
    }
    if (owner !== undefined && entry.owner !== owner) {
      return null;
    }
    // 복사본을 준다. 호출자가 상태를 바꿀 수 없어야 한다.
    return { ...entry.record, progress: { ...entry.record.progress } };
  }

  /** 최근 것부터. `owner` 를 주면 그 소유자의 것만. */
  list(options: { owner?: string; state?: JobState; limit?: number } = {}): JobRecord[] {
    const all = [...this.#jobs.values()]
      .filter((entry) => options.owner === undefined || entry.owner === options.owner)
      .filter((entry) => options.state === undefined || entry.record.state === options.state)
      .sort((a, b) => b.record.createdAt - a.record.createdAt)
      .map((entry) => ({ ...entry.record, progress: { ...entry.record.progress } }));

    return options.limit === undefined ? all : all.slice(0, options.limit);
  }

  /**
   * 취소를 요청한다.
   *
   * 신호를 보낼 뿐이다. 실제로 멈추는지는 작업이 신호를 확인하는지에 달려 있다.
   * 이미 끝난 Job 은 바꾸지 않는다.
   *
   * @throws {PhotoshopMcpError} `COMMAND_NOT_SUPPORTED` — 없는 Job
   */
  cancel(id: string, owner?: string): JobRecord {
    const entry = this.#jobs.get(id);
    if (entry === undefined || (owner !== undefined && entry.owner !== owner)) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `Job 을 찾을 수 없습니다: ${id}`,
        {
          details: { jobId: id },
        },
      );
    }

    if (isTerminal(entry.record.state)) {
      return this.get(id) as JobRecord;
    }

    entry.controller.abort();
    entry.record.state = "cancelled";
    entry.record.finishedAt = Date.now();
    entry.record.progress = { percent: null, message: "취소됨" };
    this.#logger.info(`Job 취소: ${entry.record.kind} (${id})`);

    return this.get(id) as JobRecord;
  }

  /**
   * 진행 중인 Job 을 모두 취소한다. 서버를 정지할 때 부른다.
   *
   * 이것이 없으면 외부 처리기 프로세스가 **서버보다 오래 산다.** StarNet2 가 몇 분씩
   * 도는데 서버는 이미 없어서 결과를 받을 곳도 없다.
   *
   * @returns 취소한 개수.
   */
  cancelAll(): number {
    let cancelled = 0;
    for (const entry of this.#jobs.values()) {
      if (!isTerminal(entry.record.state)) {
        this.cancel(entry.record.id);
        cancelled += 1;
      }
    }
    return cancelled;
  }

  // ---------------------------------------------------------------------------

  async #run<T>(id: string, run: (context: JobContext) => Promise<T>): Promise<void> {
    const entry = this.#jobs.get(id);
    if (entry === undefined) {
      return;
    }
    // 시작 전에 취소되었을 수 있다.
    if (isTerminal(entry.record.state)) {
      return;
    }

    entry.record.state = "running";
    entry.record.startedAt = Date.now();
    entry.record.progress = { percent: null, message: "시작" };

    const context: JobContext = {
      report: (percent, message) => {
        // 끝난 Job 의 진행률을 나중에 덮어쓰지 않는다.
        if (!isTerminal(entry.record.state)) {
          entry.record.progress = { percent, message };
        }
      },
      signal: entry.controller.signal,
    };

    try {
      const result = await run(context);
      if (isTerminal(entry.record.state)) {
        // 도중에 취소되었다. 결과를 completed 로 덮지 않는다.
        return;
      }
      entry.record.state = "completed";
      entry.record.result = result;
      entry.record.progress = { percent: 100, message: "완료" };
    } catch (error) {
      if (isTerminal(entry.record.state)) {
        return;
      }
      const normalized = PhotoshopMcpError.from(error, ErrorCode.COMMAND_FAILED);
      entry.record.state = "failed";
      entry.record.error = {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      };
      entry.record.progress = { percent: null, message: "실패" };
      this.#logger.error(`Job 실패: ${entry.record.kind} (${id})`, normalized.toJSON());
    } finally {
      entry.record.finishedAt ??= Date.now();
    }
  }

  /** 끝난 Job 이 너무 많으면 오래된 것부터 버린다. */
  #prune(): void {
    const finished = [...this.#jobs.values()]
      .filter((entry) => isTerminal(entry.record.state))
      .sort((a, b) => (a.record.finishedAt ?? 0) - (b.record.finishedAt ?? 0));

    const excess = finished.length - this.#maxCompleted;
    for (let i = 0; i < excess; i += 1) {
      const entry = finished[i];
      if (entry !== undefined) {
        this.#jobs.delete(entry.record.id);
      }
    }
  }
}
