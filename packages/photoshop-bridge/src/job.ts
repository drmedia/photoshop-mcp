import { z } from "zod";

/**
 * Job 계약. (ARCHITECTURE §25, ROADMAP §14)
 *
 * ## 왜 필요한가
 *
 * MCP 의 기본 요청 타임아웃은 **60초**다 (`DEFAULT_REQUEST_TIMEOUT_MSEC`).
 * 실기에서 StarNet2 가 4032×6048 이미지를 67초에 처리했고, 실제 MCP 클라이언트로
 * 부르면 정확히 60초에 `-32001 Request timed out` 이 났다.
 *
 * 외부 처리기는 본질적으로 오래 걸린다. 60초 안에 끝나기를 바라는 것은 설계가 아니다.
 * 긴 작업은 **즉시 Job ID 를 돌려주고** 상태를 따로 조회한다.
 *
 * ## 반환 타입을 상황에 따라 바꾸지 않는다
 *
 * "짧으면 결과, 길면 Job" 으로 두면 호출자가 매번 어느 쪽인지 판단해야 한다.
 * 긴 작업은 짧게 끝나도 **항상** Job 을 돌려준다. 예측 가능한 쪽이 낫다.
 *
 * ## 서버가 죽으면 Job 도 사라진다
 *
 * Job 은 메모리에만 있다. 서버를 다시 띄우면 진행 중이던 작업의 결과를 찾을 수 없다.
 * 외부 프로세스는 이미 파일을 만들었을 수 있으므로 작업 폴더를 확인하면 된다.
 */

/** Job 상태. (ROADMAP §14) */
export const JobStateSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export type JobState = z.infer<typeof JobStateSchema>;

/** 끝난 상태. 더 이상 바뀌지 않는다. */
export const TERMINAL_STATES: readonly JobState[] = ["completed", "failed", "cancelled"];

export function isTerminal(state: JobState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** 진행 상황 보고. */
export interface JobProgress {
  /** 0–100. 알 수 없으면 `null`. */
  percent: number | null;
  /** 지금 무엇을 하는지. 사람이 읽는 한 줄. */
  message: string;
}

/** Job 한 건. */
export interface JobRecord {
  id: string;
  /** 무엇을 하는 Job 인지. Tool 이름이나 Capability 이름. */
  kind: string;
  state: JobState;
  progress: JobProgress;
  /** 만든 시각 (epoch ms). */
  createdAt: number;
  /** 실행을 시작한 시각. 아직이면 `null`. */
  startedAt: number | null;
  /** 끝난 시각. 아직이면 `null`. */
  finishedAt: number | null;
  /** 성공했을 때의 결과. 그 외에는 `null`. */
  result: unknown;
  /** 실패했을 때의 오류. 그 외에는 `null`. */
  error: { code: string; message: string; details?: unknown } | null;
}

/** 진행 상황을 보고하는 함수. Job 본문이 받는다. */
export type ReportProgress = (percent: number | null, message: string) => void;

/** Job 본문이 받는 것. */
export interface JobContext {
  report: ReportProgress;
  /**
   * 취소 신호.
   *
   * 긴 작업은 이것을 확인하거나 자식 프로세스에 넘겨야 한다.
   * 확인하지 않으면 취소 요청이 상태만 바꾸고 실제로는 계속 돈다.
   */
  signal: AbortSignal;
}

/**
 * Extension 에 주어지는 Job 표면.
 *
 * 다른 Extension 의 Job 은 보이지 않는다. 자신이 시작한 것만 조회할 수 있다.
 */
export interface ExtensionJobRegistry {
  /**
   * 작업을 백그라운드로 시작하고 Job ID 를 즉시 돌려준다.
   *
   * `run` 안에서 오류를 던지면 Job 이 `failed` 가 된다. 호출자에게 전파되지 않는다 —
   * 이미 ID 를 돌려준 뒤이기 때문이다.
   */
  start<T>(kind: string, run: (context: JobContext) => Promise<T>): string;
  /** 자신이 시작한 Job. 없으면 `null`. */
  get(id: string): JobRecord | null;
}
