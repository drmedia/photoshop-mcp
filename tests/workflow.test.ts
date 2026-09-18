import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  assertWorkflowConsistent,
  isTerminal,
  resolveInput,
  type JobRecord,
  type LayerInfo,
  type WorkflowDefinition,
  type WorkflowResult,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Workflow System. (ROADMAP §11)
 *
 * Extension 이 이미 워크플로다 — `milky.remove_stars` 는 5단계를 한 Job 으로 묶는다.
 * 이 계층이 더하는 것은 **코드를 쓰지 않고 선언으로 정의하는 것**이다.
 *
 * 가장 중요한 성질은 단계 사이의 값 전달이 **앞 단계 결과에서 경로로 꺼내는 것만**
 * 허용한다는 점이다. 임의 식을 평가하면 워크플로가 실행 엔진이 된다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "wf-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge({ workspacePath: workspace }),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "external"]),
  });
}

/** Job 이 끝날 때까지 기다린다. */
async function settle(
  mcp: ReturnType<typeof createPhotoshopMcp>,
  id: string,
  timeoutMs = 10000,
): Promise<JobRecord> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = mcp.jobs.get(id);
    if (record === null) {
      throw new Error("Job 이 사라졌습니다");
    }
    if (isTerminal(record.state)) {
      return record;
    }
    if (Date.now() > deadline) {
      throw new Error(`끝나지 않았습니다: ${record.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function run(
  mcp: ReturnType<typeof createPhotoshopMcp>,
  definition: WorkflowDefinition,
): Promise<WorkflowResult> {
  mcp.workflows.register(definition);
  const { jobId } = await mcp.tools.invoke<{ jobId: string }>(
    "photoshop.workflow.run",
    { workflow: definition.id },
    { requestId: "wf" },
  );
  const record = await settle(mcp, jobId);
  if (record.state !== "completed") {
    throw new Error(`Job 이 ${record.state}: ${record.error?.message ?? ""}`);
  }
  return record.result as WorkflowResult;
}

describe("참조 해석", () => {
  it("값 전체가 참조면 타입을 유지한다", () => {
    // 문자열로 바꾸면 Tool 의 스키마 검증이 엉뚱하게 실패한다.
    const resolved = resolveInput(
      { layerId: "{{steps.0.result.layer.id}}", name: "고정" },
      [{ layer: { id: 42 } }],
      { workflow: "w", step: 1 },
    );
    expect(resolved).toEqual({ layerId: 42, name: "고정" });
  });

  it("문장 안에 섞이면 문자열로 잇는다", () => {
    const resolved = resolveInput(
      { name: "복사본 of {{steps.0.result.name}}" },
      [{ name: "배경" }],
      { workflow: "w", step: 1 },
    );
    expect(resolved).toEqual({ name: "복사본 of 배경" });
  });

  it("가리키는 값이 없으면 조용히 넘기지 않는다", () => {
    // 빈 값을 넣으면 앞 단계 결과 모양이 바뀐 것을 모른 채 다음 단계가 돈다.
    expect(() =>
      resolveInput({ x: "{{steps.0.result.없음}}" }, [{ 있음: 1 }], { workflow: "w", step: 1 }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("문자열이 아닌 값은 그대로 둔다", () => {
    const resolved = resolveInput({ n: 5, flag: true, list: [1, 2] }, [], {
      workflow: "w",
      step: 0,
    });
    expect(resolved).toEqual({ n: 5, flag: true, list: [1, 2] });
  });
});

describe("정의 검증", () => {
  const base = { id: "w", name: "테스트" };

  it("알 수 없는 참조 형태를 거부한다", () => {
    // 임의 식을 평가하지 않는다. 그 순간 워크플로가 실행 엔진이 된다.
    for (const expression of [
      "{{1 + 1}}",
      "{{env.PATH}}",
      "{{steps.0}}",
      "{{steps.a.result.x}}",
      "{{steps.0.result..x}}",
    ]) {
      expect(
        () =>
          assertWorkflowConsistent({
            ...base,
            steps: [{ tool: "a" }, { tool: "b", input: { x: expression } }],
          }),
        expression,
      ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });

  it("자기 자신이나 뒤 단계를 참조할 수 없다", () => {
    // 실행 시점에 반드시 실패하므로 등록에서 막는다.
    for (const bad of [1, 2]) {
      expect(
        () =>
          assertWorkflowConsistent({
            ...base,
            steps: [{ tool: "a" }, { tool: "b", input: { x: `{{steps.${bad}.result.y}}` } }],
          }),
        `steps.${bad}`,
      ).toThrow(/앞 단계만/u);
    }
  });

  it("올바른 참조는 통과한다", () => {
    expect(() =>
      assertWorkflowConsistent({
        ...base,
        steps: [{ tool: "a" }, { tool: "b", input: { x: "{{steps.0.result.a.b.c}}" } }],
      }),
    ).not.toThrow();
  });

  it("register 가 잘못된 정의를 막는다", () => {
    const mcp = setup();
    expect(() =>
      mcp.workflows.register({
        id: "bad",
        name: "나쁨",
        steps: [{ tool: "a", input: { x: "{{steps.5.result.y}}" } }],
      }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    expect(mcp.workflows.size).toBe(0);
  });

  it("같은 id 를 두 번 등록할 수 없다", () => {
    const mcp = setup();
    const definition: WorkflowDefinition = { id: "w", name: "테스트", steps: [{ tool: "a" }] };
    mcp.workflows.register(definition);
    expect(() => mcp.workflows.register(definition)).toThrow(
      expect.objectContaining({ code: ErrorCode.DUPLICATE_COMMAND }),
    );
  });
});

describe("실행", () => {
  it("단계를 순서대로 실행한다", async () => {
    const mcp = setup();
    const result = await run(mcp, {
      id: "layers",
      name: "레이어 두 개",
      steps: [
        { tool: "photoshop.layer.create", label: "첫 레이어", input: { name: "하나" } },
        { tool: "photoshop.layer.create", label: "둘째 레이어", input: { name: "둘" } },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.state)).toEqual(["completed", "completed"]);
    expect(result.steps.map((step) => step.label)).toEqual(["첫 레이어", "둘째 레이어"]);
    expect((result.steps[0]?.result as LayerInfo).name).toBe("하나");
  });

  it("앞 단계 결과를 다음 단계에 넘긴다", async () => {
    const mcp = setup();
    const result = await run(mcp, {
      id: "chain",
      name: "만들고 이름 바꾸기",
      steps: [
        { tool: "photoshop.layer.create", input: { name: "원본" } },
        {
          tool: "photoshop.layer.rename",
          input: { layerId: "{{steps.0.result.id}}", name: "바뀐이름" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const created = result.steps[0]?.result as LayerInfo;
    const renamed = result.steps[1]?.result as LayerInfo;
    expect(renamed.id).toBe(created.id);
    expect(renamed.name).toBe("바뀐이름");
  });

  it("실행은 즉시 jobId 를 돌려준다", async () => {
    // 단계 중 하나라도 길면 전체가 60초를 넘는다.
    const mcp = setup();
    mcp.workflows.register({ id: "w", name: "테스트", steps: [{ tool: "photoshop.ping" }] });

    const started = Date.now();
    const result = await mcp.tools.invoke<{ jobId: string }>(
      "photoshop.workflow.run",
      { workflow: "w" },
      { requestId: "wf" },
    );
    expect(Date.now() - started).toBeLessThan(100);
    expect(result.jobId).toMatch(/^[0-9a-f-]{36}$/u);
    await settle(mcp, result.jobId);
  });

  it("없는 워크플로는 COMMAND_NOT_SUPPORTED", async () => {
    const mcp = setup();
    await expect(
      mcp.tools.invoke(
        "photoshop.workflow.run",
        { workflow: "not-registered" },
        { requestId: "wf" },
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }));
  });

  it("id 형식이 틀리면 스키마가 먼저 막는다", async () => {
    const mcp = setup();
    await expect(
      mcp.tools.invoke("photoshop.workflow.run", { workflow: "한글이름" }, { requestId: "wf" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("목록에 단계 구성이 보인다", async () => {
    const mcp = setup();
    mcp.workflows.register({
      id: "w",
      name: "테스트 흐름",
      description: "설명",
      steps: [{ tool: "photoshop.ping", label: "확인" }],
    });

    const listed = await mcp.tools.invoke<{ workflows: { id: string; steps: unknown[] }[] }>(
      "photoshop.workflow.list",
      {},
      { requestId: "wf" },
    );
    expect(listed.workflows[0]).toMatchObject({
      id: "w",
      name: "테스트 흐름",
      steps: [{ index: 0, tool: "photoshop.ping", label: "확인" }],
    });
  });
});

describe("실패 처리", () => {
  it("실패하면 멈추고 뒤 단계를 건너뛴다", async () => {
    const mcp = setup();
    const result = await run(mcp, {
      id: "fail",
      name: "중간에 실패",
      steps: [
        { tool: "photoshop.layer.create", input: { name: "하나" } },
        { tool: "photoshop.layer.rename", input: { layerId: 99999, name: "없는레이어" } },
        { tool: "photoshop.layer.create", input: { name: "실행되면안됨" } },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(1);
    expect(result.steps.map((step) => step.state)).toEqual(["completed", "failed", "skipped"]);
    expect(result.steps[1]?.error?.code).toBe(ErrorCode.LAYER_NOT_FOUND);
  });

  it("앞 단계가 만든 것은 되돌리지 않는다", async () => {
    // 되돌리면 사용자가 그 사이에 한 편집까지 날아갈 수 있다.
    // 무엇이 어디까지 됐는지 알려주고 판단은 사용자에게 맡긴다.
    const mcp = setup();
    const before = (
      await mcp.tools.invoke<{ layers: LayerInfo[] }>(
        "photoshop.layer.list",
        {},
        { requestId: "wf" },
      )
    ).layers.length;

    await run(mcp, {
      id: "partial",
      name: "절반만",
      steps: [
        { tool: "photoshop.layer.create", input: { name: "남아야함" } },
        { tool: "photoshop.layer.rename", input: { layerId: 99999, name: "x" } },
      ],
    });

    const after = (
      await mcp.tools.invoke<{ layers: LayerInfo[] }>(
        "photoshop.layer.list",
        {},
        { requestId: "wf" },
      )
    ).layers;
    expect(after.length).toBe(before + 1);
    expect(after.some((layer) => layer.name === "남아야함")).toBe(true);
  });

  it("Job 을 돌려주지 않는 Tool 에 awaitJob 을 적으면 실패한다", async () => {
    // 조용히 넘기면 다음 단계가 아직 없는 결과를 참조한다.
    const mcp = setup();
    const result = await run(mcp, {
      id: "badawait",
      name: "잘못된 대기",
      steps: [{ tool: "photoshop.ping", awaitJob: true }],
    });

    expect(result.ok).toBe(false);
    expect(result.steps[0]?.error?.code).toBe(ErrorCode.INVALID_PARAMETER);
  });
});

describe("설정 파일", () => {
  it("파일이 없으면 조용히 넘어간다", async () => {
    const mcp = setup();
    await expect(mcp.workflows.loadConfig(join(workspace, "없음.json"))).resolves.toBe(0);
  });

  it("하나가 잘못되어도 나머지는 등록한다", async () => {
    const path = join(workspace, "workflows.json");
    await writeFile(
      path,
      JSON.stringify({
        workflows: [
          { id: "good", name: "좋음", steps: [{ tool: "photoshop.ping" }] },
          {
            id: "bad",
            name: "나쁨",
            steps: [{ tool: "a", input: { x: "{{steps.9.result.y}}" } }],
          },
        ],
      }),
      "utf8",
    );

    const mcp = setup();
    await expect(mcp.workflows.loadConfig(path)).resolves.toBe(1);
    expect(mcp.workflows.get("good")).not.toBeNull();
    expect(mcp.workflows.get("bad")).toBeNull();
  });

  it("JSON 이 깨져도 서버가 죽지 않는다", async () => {
    const path = join(workspace, "workflows.json");
    await writeFile(path, "{ not json", "utf8");
    const mcp = setup();
    await expect(mcp.workflows.loadConfig(path)).resolves.toBe(0);
  });
});
