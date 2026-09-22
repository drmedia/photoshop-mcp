import { z } from "zod";

/**
 * Workflow 계약. (ROADMAP §11, ARCHITECTURE §1)
 *
 * ## 무엇이 이미 되는가
 *
 * Extension 이 이미 워크플로다. `starnet.remove_stars` 는 문서 조회 → 내보내기 →
 * 외부 처리 → 가져오기 ×2 → 혼합까지 5단계를 한 Job 으로 묶고 진행률도 보고한다.
 *
 * ## 그래서 이 계층이 더하는 것
 *
 * **코드를 쓰지 않고 선언으로 정의하는 것.** Extension 을 만들려면 TypeScript 를
 * 쓰고 빌드해야 한다. 자주 하는 순서를 JSON 으로 적어두고 부를 수 있어야 한다.
 *
 * ## 안전 원칙
 *
 * batchPlay descriptor · Capability argv 와 같다. (ARCHITECTURE §23.2)
 * 단계 사이의 값 전달은 **앞 단계 결과에서 경로로 꺼내는 것만** 허용한다.
 * 임의 식을 평가하지 않는다 — 그 순간 워크플로가 실행 엔진이 되어버린다.
 */

/** 워크플로 이름. Tool 이름과 헷갈리지 않도록 점을 쓰지 않는다. */
export const WorkflowIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, {
    message: "워크플로 id 는 소문자로 시작하고 소문자·숫자·하이픈만 쓸 수 있습니다.",
  });

/**
 * 단계 하나.
 *
 * `input` 의 문자열 값에 `{{steps.0.result.layer.id}}` 형태를 쓰면 앞 단계의
 * 결과에서 값을 꺼낸다. 그 외의 표현은 지원하지 않는다.
 */
export const WorkflowStepSchema = z
  .object({
    /** 부를 Tool 이름. */
    tool: z.string().min(1).max(200),
    /** 사람이 읽을 설명. 진행 상황에 쓴다. */
    label: z.string().min(1).max(200).optional(),
    /** Tool 입력. 자리표시자를 쓸 수 있다. */
    input: z.record(z.unknown()).optional(),
    /**
     * 이 Tool 이 jobId 를 돌려주면 그 Job 이 끝날 때까지 기다린다.
     *
     * 명시적으로 적게 한다. 결과에 `jobId` 가 있다고 알아서 기다리면, 우연히 그
     * 이름의 필드를 가진 결과까지 기다리게 된다.
     */
    awaitJob: z.boolean().optional(),
  })
  .strict();

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** 워크플로 정의. */
export const WorkflowDefinitionSchema = z
  .object({
    id: WorkflowIdSchema,
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    steps: z.array(WorkflowStepSchema).min(1).max(32),
  })
  .strict();

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

/** 설정 파일 전체. */
export const WorkflowConfigSchema = z
  .object({
    workflows: z.array(WorkflowDefinitionSchema).max(64),
  })
  .strict();

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

/** 단계 하나의 실행 결과. */
export interface WorkflowStepResult {
  index: number;
  tool: string;
  label: string;
  /** `completed` 또는 `failed`. 앞 단계가 실패하면 뒤는 `skipped`. */
  state: "completed" | "failed" | "skipped";
  result: unknown;
  error: { code: string; message: string } | null;
  durationMs: number;
}

/** 워크플로 전체 결과. */
export interface WorkflowResult {
  workflow: string;
  /** 모든 단계가 성공했는지. */
  ok: boolean;
  steps: WorkflowStepResult[];
  /** 실패한 단계 번호. 성공했으면 `null`. */
  failedAt: number | null;
  durationMs: number;
}
