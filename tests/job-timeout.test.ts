import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * 긴 Tool 은 **실제 MCP 클라이언트에서** 즉시 돌아와야 한다. (ROADMAP §14)
 *
 * MCP 기본 요청 타임아웃은 60초다. 실기에서 StarNet2 가 67초 걸려 실제 클라이언트로
 * 부르니 `-32001 Request timed out` 이 났다. 그때 서버 내부 API(`tools.invoke`)로만
 * 확인했기 때문에 놓쳤다 — 내부 호출에는 타임아웃이 없다.
 *
 * 그 뒤로 이 성질을 사람이 손으로만 확인해 왔다. 여기서 고정한다.
 *
 * 테스트는 60초를 기다리지 않는다. 클라이언트 쪽 타임아웃을 짧게 주면 같은 구조를
 * 훨씬 빨리 재현할 수 있다 — 중요한 것은 초의 크기가 아니라 **핸들러가 작업을
 * 기다리느냐**다.
 */

/** 작업보다 짧은 클라이언트 타임아웃. 기다리는 Tool 은 반드시 걸린다. */
const CLIENT_TIMEOUT_MS = 300;
/** 그 타임아웃보다 확실히 오래 걸리는 가짜 외부 처리. */
const WORK_MS = 3000;

interface Harness {
  client: Client;
  close: () => Promise<void>;
}

let active: Harness | null = null;

afterEach(async () => {
  await active?.close();
  active = null;
});

const Empty = z.object({}).strict();

/**
 * 두 가지 Tool 을 등록한 서버를 띄운다.
 *
 * - `test.job` — Job 으로 넘기고 즉시 jobId 를 돌려준다 (올바른 방식)
 * - `test.blocking` — 작업이 끝날 때까지 기다린다 (실기에서 타임아웃을 낸 방식)
 *
 * 두 번째가 없으면 이 테스트가 무엇을 막는지 증명할 수 없다. 첫 번째만 두면
 * 타임아웃이 아예 일어나지 않는 환경에서도 통과해 버린다.
 */
async function connect(): Promise<Harness> {
  const core = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "external"]),
  });

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  core.tools.register({
    name: "test.job",
    description: "긴 작업을 Job 으로 넘기고 즉시 jobId 를 돌려준다.",
    permission: "external",
    inputSchema: Empty,
    handler: () => {
      const jobId = core.jobs.start("test.job", async (job) => {
        job.report(10, "처리 중");
        await sleep(WORK_MS);
        return { done: true };
      });
      return Promise.resolve({ jobId });
    },
  });

  core.tools.register({
    name: "test.blocking",
    description: "작업이 끝날 때까지 기다린다. 이 방식이 실기에서 타임아웃을 냈다.",
    permission: "external",
    inputSchema: Empty,
    handler: async () => {
      await sleep(WORK_MS);
      return { done: true };
    },
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "timeout-test", version: "0.0.0" });
  await Promise.all([core.server.start(serverTransport), client.connect(clientTransport)]);

  active = {
    client,
    close: async () => {
      // 취소하지 않으면 남은 Job 이 테스트가 끝난 뒤에도 돌아간다.
      core.jobs.cancelAll();
      await client.close();
      await core.server.stop();
    },
  };
  return active;
}

function payload(result: unknown): Record<string, unknown> {
  const content = (result as { content?: { type: string; text: string }[] }).content;
  const first = content?.[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("텍스트 content 가 없습니다.");
  }
  return JSON.parse(first.text) as Record<string, unknown>;
}

describe("긴 Tool 과 MCP 요청 타임아웃", () => {
  it("Job 으로 넘긴 Tool 은 작업이 끝나기 전에 jobId 를 돌려준다", async () => {
    const { client } = await connect();

    const started = Date.now();
    const result = await client.callTool({ name: "test.job", arguments: {} }, undefined, {
      timeout: CLIENT_TIMEOUT_MS,
    });
    const elapsed = Date.now() - started;

    expect(payload(result)["jobId"]).toEqual(expect.any(String));
    // 작업은 아직 돌고 있다. 기다렸다면 이 단정이 깨진다.
    expect(elapsed).toBeLessThan(WORK_MS);
  });

  it("기다리는 Tool 은 타임아웃으로 죽는다 — 이 테스트가 막는 것이 그것이다", async () => {
    // 이 단정이 실패하면 위 테스트가 아무것도 증명하지 못한다는 뜻이다.
    const { client } = await connect();

    await expect(
      client.callTool({ name: "test.blocking", arguments: {} }, undefined, {
        timeout: CLIENT_TIMEOUT_MS,
      }),
    ).rejects.toThrow(/timed out|timeout/iu);
  });

  it("job.status 와 job.cancel 도 MCP 를 거쳐 즉시 돌아온다", async () => {
    const { client } = await connect();
    const { jobId } = payload(
      await client.callTool({ name: "test.job", arguments: {} }, undefined, {
        timeout: CLIENT_TIMEOUT_MS,
      }),
    ) as { jobId: string };

    // 조회가 완료를 기다리면 타임아웃 문제가 그대로 돌아온다.
    const status = payload(
      await client.callTool({ name: "photoshop.job.status", arguments: { jobId } }, undefined, {
        timeout: CLIENT_TIMEOUT_MS,
      }),
    );
    expect(status["state"]).toBe("running");

    const cancelled = payload(
      await client.callTool({ name: "photoshop.job.cancel", arguments: { jobId } }, undefined, {
        timeout: CLIENT_TIMEOUT_MS,
      }),
    );
    expect(cancelled["state"]).toBe("cancelled");
  });

  it("긴 작업을 하는 Core Tool 은 전부 Job 으로 넘긴다", async () => {
    // 새로 추가한 Tool 이 이 규칙을 빠뜨리는 것을 막는다.
    // 외부 처리기를 부르는 Tool 은 60초를 넘길 수 있고, 그러면 MCP 가 끊는다.
    const { client } = await connect();
    const { tools } = await client.listTools();

    const long = tools.filter((tool) => tool.name === "photoshop.workflow.run");
    expect(long).toHaveLength(1);
    expect(long[0]?.description).toMatch(/jobId/u);
  });
});
