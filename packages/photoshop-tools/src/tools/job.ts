import type { JobRecord, JobState, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { JobStateSchema } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Job 조회 Tool. (ROADMAP §14)
 *
 * MCP 요청은 60초 안에 끝나야 한다 (`DEFAULT_REQUEST_TIMEOUT_MSEC`).
 * 실기에서 StarNet2 가 67초 걸려 실제 클라이언트로 부르면 `-32001 Request timed out`
 * 이 났다. 긴 작업은 Job ID 를 즉시 돌려주고 여기서 상태를 본다.
 *
 * 이 Tool 들은 **항상 즉시 반환한다.** 완료를 기다리지 않는다 — 기다리면
 * 타임아웃 문제가 그대로 돌아온다.
 */

const JobIdSchema = z.string().uuid();

export const JobStatusInputSchema = z.object({ jobId: JobIdSchema }).strict();
export const JobCancelInputSchema = z.object({ jobId: JobIdSchema }).strict();
export const JobListInputSchema = z
  .object({
    /** 이 상태인 것만. 생략하면 전부. */
    state: JobStateSchema.optional(),
    /** 최대 개수. 생략하면 20. */
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type JobStatusInput = z.infer<typeof JobStatusInputSchema>;
export type JobCancelInput = z.infer<typeof JobCancelInputSchema>;
export type JobListInput = z.infer<typeof JobListInputSchema>;

/** Job 조회에 필요한 최소 표면. `JobStore` 가 이 모양을 만족한다. */
export interface JobReader {
  get(id: string): JobRecord | null;
  list(options: { state?: JobState; limit?: number }): JobRecord[];
  cancel(id: string): JobRecord;
}

/** 경과 시간을 함께 담아 돌려준다. 얼마나 기다렸는지 알 수 있어야 한다. */
function describe(record: JobRecord): Record<string, unknown> {
  const end = record.finishedAt ?? Date.now();
  const start = record.startedAt ?? record.createdAt;
  return {
    ...record,
    elapsedSeconds: Math.round((end - start) / 1000),
  };
}

/** `photoshop.job.status` — Job 상태 조회. */
export function createJobStatusTool(jobs: JobReader): ToolDefinition<JobStatusInput, unknown> {
  return {
    name: "photoshop.job.status",
    description:
      "긴 작업의 상태를 조회한다. 즉시 반환하며 완료를 기다리지 않는다. " +
      "state 가 running 이면 잠시 뒤 다시 조회한다. " +
      "completed 면 result 에, failed 면 error 에 내용이 담긴다.",
    permission: "read",
    inputSchema: JobStatusInputSchema,
    handler: (input) => {
      const record = jobs.get(input.jobId);
      return Promise.resolve(
        record === null
          ? {
              found: false,
              jobId: input.jobId,
              // 서버를 다시 띄우면 Job 이 사라진다. 흔한 원인이라 먼저 말해준다.
              note: "없는 Job 입니다. 서버를 다시 시작했다면 이전 Job 은 사라집니다.",
            }
          : { found: true, ...describe(record) },
      );
    },
  };
}

/** `photoshop.job.list` — 최근 Job 목록. */
export function createJobListTool(jobs: JobReader): ToolDefinition<JobListInput, unknown> {
  return {
    name: "photoshop.job.list",
    description: "최근 긴 작업 목록을 최신순으로 반환한다. state 로 거를 수 있다.",
    permission: "read",
    inputSchema: JobListInputSchema,
    handler: (input) =>
      Promise.resolve({
        jobs: jobs
          .list({
            ...(input.state === undefined ? {} : { state: input.state }),
            limit: input.limit ?? 20,
          })
          .map(describe),
      }),
  };
}

/** `photoshop.job.cancel` — Job 취소. */
export function createJobCancelTool(jobs: JobReader): ToolDefinition<JobCancelInput, unknown> {
  return {
    name: "photoshop.job.cancel",
    description:
      "진행 중인 긴 작업을 취소한다. 외부 처리기 프로세스를 실제로 종료한다. " +
      "이미 끝난 작업은 그대로 둔다. " +
      "이미 만들어진 중간 파일은 지우지 않는다.",
    // 실행 중인 외부 프로세스를 죽인다. 되돌릴 수 없으므로 edit 이상이다.
    // 다만 문서를 바꾸지는 않으므로 destructive 까지 가지 않는다.
    permission: "edit",
    inputSchema: JobCancelInputSchema,
    handler: (input) => Promise.resolve(describe(jobs.cancel(input.jobId))),
  };
}
