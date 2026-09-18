import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityRegistry, JobStore, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { ErrorCode, isTerminal, type JobRecord } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Job System. (ROADMAP §14, ARCHITECTURE §25)
 *
 * MCP 의 기본 요청 타임아웃은 60초다. 실기에서 StarNet2 가 67초 걸렸고 실제 MCP
 * 클라이언트로 부르니 정확히 60초에 `-32001 Request timed out` 이 났다.
 *
 * 가장 중요한 성질은 **start 가 즉시 돌아온다**는 것과 **취소가 실제로 프로세스를
 * 죽인다**는 것이다. 취소가 상태만 바꾸고 프로세스가 계속 돌면 거짓말이다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "job-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const store = (): JobStore => new JobStore({ logger: createSilentLogger() });

/** 상태가 끝날 때까지 기다린다. */
async function settle(jobs: JobStore, id: string, timeoutMs = 5000): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = jobs.get(id);
    if (record === null) {
      throw new Error("Job 이 사라졌습니다");
    }
    if (isTerminal(record.state)) {
      return record;
    }
    if (Date.now() > deadline) {
      throw new Error(`끝나지 않았습니다: ${record.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("start 는 즉시 돌아온다", () => {
  it("오래 걸리는 작업이어도 바로 ID 를 준다", () => {
    // 이것이 안 되면 Job System 의 존재 이유가 없다.
    const jobs = store();
    const started = Date.now();

    const id = jobs.start("느린작업", async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return "끝";
    });

    expect(Date.now() - started).toBeLessThan(50);
    expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(jobs.get(id)?.state).toBe("queued");
  });

  it("결과를 result 에 담는다", async () => {
    const jobs = store();
    const id = jobs.start("작업", async () => Promise.resolve({ 값: 42 }));

    const record = await settle(jobs, id);
    expect(record.state).toBe("completed");
    expect(record.result).toEqual({ 값: 42 });
    expect(record.progress).toEqual({ percent: 100, message: "완료" });
  });

  it("오류를 error 에 담고 호출자에게 던지지 않는다", async () => {
    // 이미 ID 를 돌려준 뒤이므로 전파할 곳이 없다.
    const jobs = store();
    const id = jobs.start("실패작업", async () => {
      throw new Error("무언가 잘못됨");
    });

    const record = await settle(jobs, id);
    expect(record.state).toBe("failed");
    expect(record.error?.message).toBe("무언가 잘못됨");
    expect(record.result).toBeNull();
  });

  it("진행 상황을 보고할 수 있다", async () => {
    const jobs = store();
    let seen: unknown = null;
    const id = jobs.start("작업", async (job) => {
      job.report(30, "중간");
      seen = jobs.get(id)?.progress;
      return Promise.resolve(null);
    });

    await settle(jobs, id);
    expect(seen).toEqual({ percent: 30, message: "중간" });
  });
});

describe("취소", () => {
  it("실행 중인 작업을 cancelled 로 바꾼다", async () => {
    const jobs = store();
    const id = jobs.start("긴작업", async (job) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      job.report(100, "끝");
      return "끝났다";
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const cancelled = jobs.cancel(id);
    expect(cancelled.state).toBe("cancelled");

    // 본문이 나중에 끝나도 completed 로 덮지 않는다.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(jobs.get(id)?.state).toBe("cancelled");
    expect(jobs.get(id)?.result).toBeNull();
  });

  it("이미 끝난 작업은 바꾸지 않는다", async () => {
    const jobs = store();
    const id = jobs.start("작업", async () => Promise.resolve("끝"));
    await settle(jobs, id);

    expect(jobs.cancel(id).state).toBe("completed");
  });

  it("없는 Job 은 COMMAND_NOT_SUPPORTED", () => {
    const jobs = store();
    expect(() => jobs.cancel("00000000-0000-0000-0000-000000000000")).toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
  });

  it("본문이 신호를 보고 멈출 수 있다", async () => {
    const jobs = store();
    let stopped = false;
    const id = jobs.start("협조적작업", async (job) => {
      for (let i = 0; i < 200; i += 1) {
        if (job.signal.aborted) {
          stopped = true;
          return "중단";
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return "완주";
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    jobs.cancel(id);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stopped).toBe(true);
  });
});

describe("취소가 실제로 프로세스를 죽인다", () => {
  /**
   * 신호만 받고 프로세스가 계속 돌면 취소는 거짓말이다.
   * 상태는 cancelled 인데 CPU 는 계속 먹고 파일도 계속 쓴다.
   */
  it("외부 프로세스를 SIGKILL 한다", async () => {
    const script = join(workspace, "느린처리기.cjs");
    const marker = join(workspace, "끝까지돌았음.txt");
    await writeFile(
      script,
      [
        "const fs = require('node:fs');",
        "const out = process.argv[3];",
        // 죽이지 않으면 2초 뒤 마커를 남긴다.
        "setTimeout(() => { fs.writeFileSync(out, 'done'); fs.writeFileSync(process.argv[4], 'x'); }, 2000);",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");

    const registry = new CapabilityRegistry({
      logger: createSilentLogger(),
      resolveWorkspace: async () => Promise.resolve(workspace),
    });
    registry.register({
      id: "slow",
      capability: "starRemoval",
      executable: process.execPath,
      args: [script, "{{input}}", "{{output}}", marker],
      timeoutMs: 30000,
    });

    const jobs = store();
    const id = jobs.start("느린Capability", async (job) =>
      registry.execute(
        "starRemoval",
        { input: "in.tif", output: "out.tif" },
        { signal: job.signal },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 200));
    jobs.cancel(id);

    // 죽지 않았다면 2초 뒤 마커가 생긴다.
    await new Promise((resolve) => setTimeout(resolve, 2400));
    expect(existsSync(marker), "프로세스가 죽지 않고 끝까지 돌았습니다").toBe(false);
    expect(jobs.get(id)?.state).toBe("cancelled");
  }, 15000);
});

describe("cancelAll", () => {
  it("진행 중인 것만 취소하고 개수를 돌려준다", async () => {
    // 서버를 정지할 때 쓴다. 이것이 없으면 외부 처리기 프로세스가 서버보다 오래 산다.
    const jobs = store();
    const done = jobs.start("끝난것", async () => Promise.resolve(1));
    await settle(jobs, done);

    const running1 = jobs.start("도는것1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return 1;
    });
    const running2 = jobs.start("도는것2", async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return 2;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(jobs.cancelAll()).toBe(2);
    expect(jobs.get(running1)?.state).toBe("cancelled");
    expect(jobs.get(running2)?.state).toBe("cancelled");
    // 이미 끝난 것은 건드리지 않는다.
    expect(jobs.get(done)?.state).toBe("completed");
  });

  it("취소할 것이 없으면 0", () => {
    expect(store().cancelAll()).toBe(0);
  });
});

describe("소유자 격리", () => {
  it("다른 소유자의 Job 은 보이지 않는다", async () => {
    const jobs = store();
    const mine = jobs.start("내작업", async () => Promise.resolve(1), { owner: "milky" });
    const theirs = jobs.start("남작업", async () => Promise.resolve(2), { owner: "other" });
    await settle(jobs, mine);
    await settle(jobs, theirs);

    expect(jobs.get(mine, "milky")).not.toBeNull();
    expect(jobs.get(theirs, "milky")).toBeNull();
    expect(jobs.list({ owner: "milky" })).toHaveLength(1);
  });

  it("다른 소유자의 Job 을 취소할 수 없다", async () => {
    const jobs = store();
    const theirs = jobs.start("남작업", async () => Promise.resolve(1), { owner: "other" });
    expect(() => jobs.cancel(theirs, "milky")).toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
    await settle(jobs, theirs);
  });
});

describe("보관", () => {
  it("끝난 Job 이 쌓이면 오래된 것부터 버린다", async () => {
    // 긴 세션에서 무한정 쌓이면 메모리가 샌다.
    const jobs = new JobStore({ logger: createSilentLogger(), maxCompleted: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = jobs.start(`작업${i}`, async () => Promise.resolve(i));
      ids.push(id);
      await settle(jobs, id);
    }

    expect(jobs.size).toBeLessThanOrEqual(4);
    // 가장 최근 것은 남아 있어야 한다.
    expect(jobs.get(ids[5] as string)).not.toBeNull();
  });

  it("최신순으로 목록을 준다", async () => {
    const jobs = store();
    const first = jobs.start("첫번째", async () => Promise.resolve(1));
    await settle(jobs, first);
    const second = jobs.start("두번째", async () => Promise.resolve(2));
    await settle(jobs, second);

    expect(jobs.list().map((record) => record.kind)).toEqual(["두번째", "첫번째"]);
    expect(jobs.list({ limit: 1 })).toHaveLength(1);
  });
});
