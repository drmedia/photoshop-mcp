import { readFile } from "node:fs/promises";
import type {
  JobContext,
  Logger,
  ToolRegistry,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowStepResult,
} from "@photoshop-mcp/photoshop-bridge";
import {
  ErrorCode,
  PhotoshopMcpError,
  WorkflowConfigSchema,
  assertWorkflowConsistent,
  isTerminal,
  resolveInput,
} from "@photoshop-mcp/photoshop-bridge";
import type { JobStore } from "../jobs/store.js";

/**
 * Workflow 레지스트리와 실행기. (ROADMAP §11)
 *
 * 자주 하는 Tool 순서를 JSON 으로 적어두고 부른다. Extension 을 만들려면
 * TypeScript 를 쓰고 빌드해야 하는데, 순서만 바꾸고 싶을 때는 과하다.
 *
 * ## 실패하면 멈춘다
 *
 * 한 단계가 실패하면 뒤 단계는 실행하지 않는다. 앞 단계가 만든 레이어와 파일은
 * **그대로 둔다.** 되돌리지 않는 이유는 아래에 적었다.
 */

export interface WorkflowRegistryOptions {
  tools: ToolRegistry;
  jobs: JobStore;
  logger: Logger;
}

export class WorkflowRegistry {
  readonly #definitions = new Map<string, WorkflowDefinition>();
  readonly #tools: ToolRegistry;
  readonly #jobs: JobStore;
  readonly #logger: Logger;

  constructor(options: WorkflowRegistryOptions) {
    this.#tools = options.tools;
    this.#jobs = options.jobs;
    this.#logger = options.logger;
  }

  get size(): number {
    return this.#definitions.size;
  }

  list(): WorkflowDefinition[] {
    return [...this.#definitions.values()];
  }

  get(id: string): WorkflowDefinition | null {
    return this.#definitions.get(id) ?? null;
  }

  /**
   * 워크플로를 등록한다.
   *
   * @throws {PhotoshopMcpError}
   *   - `DUPLICATE_COMMAND` — 같은 id 가 이미 있음
   *   - `INVALID_PARAMETER` — 참조가 잘못됨
   */
  register(definition: WorkflowDefinition): void {
    if (this.#definitions.has(definition.id)) {
      throw new PhotoshopMcpError(
        ErrorCode.DUPLICATE_COMMAND,
        `이미 등록된 워크플로입니다: ${definition.id}`,
        { details: { workflow: definition.id } },
      );
    }
    // 잘못된 참조는 실행 시점이 아니라 등록 시점에 잡는다.
    assertWorkflowConsistent(definition);
    this.#definitions.set(definition.id, definition);
  }

  /**
   * 설정 파일을 읽어 등록한다.
   *
   * 파일이 없으면 조용히 넘어간다. 하나가 잘못되어도 나머지는 등록한다.
   */
  async loadConfig(path: string): Promise<number> {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      this.#logger.debug(`워크플로 설정이 없습니다: ${path}`);
      return 0;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      this.#logger.error(
        `워크플로 설정이 올바른 JSON 이 아닙니다: ${path}`,
        error instanceof Error ? error.message : String(error),
      );
      return 0;
    }

    const result = WorkflowConfigSchema.safeParse(parsed);
    if (!result.success) {
      this.#logger.error(
        `워크플로 설정이 스키마를 만족하지 않습니다: ${path}`,
        result.error.issues,
      );
      return 0;
    }

    let registered = 0;
    for (const definition of result.data.workflows) {
      try {
        this.register(definition);
        registered += 1;
      } catch (error) {
        this.#logger.error(
          `워크플로 등록 실패: ${definition.id}`,
          PhotoshopMcpError.from(error).toJSON(),
        );
      }
    }
    if (registered > 0) {
      this.#logger.info(`워크플로 ${registered}개 등록: ${path}`);
    }
    return registered;
  }

  /**
   * 워크플로를 Job 으로 시작하고 ID 를 즉시 돌려준다.
   *
   * 단계 중 하나라도 길면 전체가 60초를 넘는다. 워크플로는 언제나 Job 이다.
   *
   * @throws {PhotoshopMcpError} `COMMAND_NOT_SUPPORTED` — 없는 워크플로
   */
  start(id: string): string {
    const definition = this.#definitions.get(id);
    if (definition === undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_NOT_SUPPORTED,
        `등록되지 않은 워크플로입니다: ${id}. 사용 가능: ${
          this.list()
            .map((w) => w.id)
            .join(", ") || "(없음)"
        }`,
        { details: { workflow: id, available: this.list().map((w) => w.id) } },
      );
    }

    return this.#jobs.start(`workflow:${id}`, async (job) => this.#run(definition, job));
  }

  // ---------------------------------------------------------------------------

  async #run(definition: WorkflowDefinition, job: JobContext): Promise<WorkflowResult> {
    const started = Date.now();
    const steps: WorkflowStepResult[] = [];
    const results: unknown[] = [];
    let failedAt: number | null = null;

    for (const [index, step] of definition.steps.entries()) {
      const label = step.label ?? step.tool;

      if (failedAt !== null) {
        steps.push({
          index,
          tool: step.tool,
          label,
          state: "skipped",
          result: null,
          error: null,
          durationMs: 0,
        });
        continue;
      }

      // 취소는 단계 사이에서 확인한다. 단계 안의 Job 은 자기 신호로 멈춘다.
      if (job.signal.aborted) {
        steps.push({
          index,
          tool: step.tool,
          label,
          state: "skipped",
          result: null,
          error: null,
          durationMs: 0,
        });
        continue;
      }

      const percent = Math.round((index / definition.steps.length) * 100);
      job.report(percent, `${index + 1}/${definition.steps.length} ${label}`);

      const stepStarted = Date.now();
      try {
        const input = resolveInput(step.input ?? {}, results, {
          workflow: definition.id,
          step: index,
        });

        let result = await this.#tools.invoke<unknown>(step.tool, input, {
          requestId: `wf-${definition.id}-${index}`,
        });

        if (step.awaitJob === true) {
          result = await this.#awaitJob(result, definition.id, index, job);
        }

        results.push(result);
        steps.push({
          index,
          tool: step.tool,
          label,
          state: "completed",
          result,
          error: null,
          durationMs: Date.now() - stepStarted,
        });
      } catch (error) {
        const normalized = PhotoshopMcpError.from(error, ErrorCode.COMMAND_FAILED);
        failedAt = index;
        results.push(null);
        steps.push({
          index,
          tool: step.tool,
          label,
          state: "failed",
          result: null,
          error: { code: normalized.code, message: normalized.message },
          durationMs: Date.now() - stepStarted,
        });
        this.#logger.error(
          `워크플로 '${definition.id}' ${index}번 단계 실패: ${step.tool}`,
          normalized.toJSON(),
        );
      }
    }

    return {
      workflow: definition.id,
      ok: failedAt === null,
      steps,
      failedAt,
      durationMs: Date.now() - started,
    };
  }

  /** 단계가 돌려준 Job 이 끝날 때까지 기다린다. */
  async #awaitJob(
    result: unknown,
    workflow: string,
    index: number,
    job: JobContext,
  ): Promise<unknown> {
    const jobId = (result as { jobId?: unknown }).jobId;
    if (typeof jobId !== "string") {
      // awaitJob 을 적었는데 Job 이 아니면 설정 실수다. 조용히 넘기면
      // 다음 단계가 아직 없는 결과를 참조한다.
      throw new PhotoshopMcpError(
        ErrorCode.INVALID_PARAMETER,
        `${index}번 단계에 awaitJob 을 적었지만 Tool 이 jobId 를 돌려주지 않았습니다.`,
        { details: { workflow, step: index, received: result } },
      );
    }

    for (;;) {
      const record = this.#jobs.get(jobId);
      if (record === null) {
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_FAILED,
          `${index}번 단계의 Job 이 사라졌습니다: ${jobId}`,
          { details: { workflow, step: index, jobId } },
        );
      }

      if (record.state === "completed") {
        return record.result;
      }
      if (record.state === "failed") {
        const error = record.error;
        throw new PhotoshopMcpError(
          (error?.code as ErrorCode) ?? ErrorCode.COMMAND_FAILED,
          error?.message ?? `${index}번 단계가 실패했습니다.`,
          { details: { workflow, step: index, jobId } },
        );
      }
      if (record.state === "cancelled") {
        throw new PhotoshopMcpError(ErrorCode.COMMAND_FAILED, `${index}번 단계가 취소되었습니다.`, {
          recoverable: true,
          details: { workflow, step: index, jobId },
        });
      }

      // 워크플로가 취소되면 안쪽 Job 도 취소한다. 그러지 않으면 외부 프로세스가
      // 워크플로보다 오래 산다.
      if (job.signal.aborted && !isTerminal(record.state)) {
        this.#jobs.cancel(jobId);
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
