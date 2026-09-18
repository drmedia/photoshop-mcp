import type { ToolDefinition, WorkflowDefinition } from "@photoshop-mcp/photoshop-bridge";
import { WorkflowIdSchema } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * Workflow Tool. (ROADMAP §11)
 *
 * 실행은 **언제나 Job 이다.** 단계 중 하나라도 길면 전체가 60초를 넘는다.
 */

export const WorkflowListInputSchema = z.object({}).strict();
export const WorkflowRunInputSchema = z.object({ workflow: WorkflowIdSchema }).strict();

export type WorkflowListInput = z.infer<typeof WorkflowListInputSchema>;
export type WorkflowRunInput = z.infer<typeof WorkflowRunInputSchema>;

/** 워크플로 실행에 필요한 최소 표면. `WorkflowRegistry` 가 이 모양을 만족한다. */
export interface WorkflowRunner {
  list(): WorkflowDefinition[];
  start(id: string): string;
}

/** `photoshop.workflow.list` — 등록된 워크플로 목록. */
export function createWorkflowListTool(
  workflows: WorkflowRunner,
): ToolDefinition<WorkflowListInput, unknown> {
  return {
    name: "photoshop.workflow.list",
    description:
      "등록된 워크플로 목록을 반환한다. 각 워크플로가 어떤 Tool 을 어떤 순서로 " +
      "부르는지 함께 보여준다.",
    permission: "read",
    inputSchema: WorkflowListInputSchema,
    handler: () =>
      Promise.resolve({
        workflows: workflows.list().map((definition) => ({
          id: definition.id,
          name: definition.name,
          description: definition.description,
          steps: definition.steps.map((step, index) => ({
            index,
            tool: step.tool,
            label: step.label ?? step.tool,
          })),
        })),
      }),
  };
}

/** `photoshop.workflow.run` — 워크플로 실행. 즉시 jobId 를 돌려준다. */
export function createWorkflowRunTool(
  workflows: WorkflowRunner,
): ToolDefinition<WorkflowRunInput, unknown> {
  return {
    name: "photoshop.workflow.run",
    description:
      "워크플로를 실행한다. **즉시 jobId 를 반환한다.** " +
      "photoshop.job.status 로 진행 상황을 확인하고, completed 가 되면 result 에 " +
      "단계별 결과가 담긴다. 한 단계가 실패하면 뒤 단계는 실행하지 않으며, " +
      "앞 단계가 만든 레이어와 파일은 그대로 남는다.",
    // 안에서 무엇을 부를지 정의에 달려 있다. 가장 위험한 단계를 기준으로 삼는다.
    // 실제 차단은 각 Tool 과 Command 가 자기 권한으로 한다.
    permission: "external",
    inputSchema: WorkflowRunInputSchema,
    handler: (input) =>
      Promise.resolve({
        jobId: workflows.start(input.workflow),
        note: "photoshop.job.status 로 진행 상황을 확인하세요.",
      }),
  };
}
