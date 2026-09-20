import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 액션 조회. (ROADMAP §17.34)
 *
 * Mock 에는 액션이 없다. 고정하는 것은 **조회만 한다**는 것과 스키마,
 * 그리고 없는 세트를 조용히 넘기지 않는다는 것이다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const list = async (mcp: Mcp, args: Record<string, unknown> = {}): Promise<unknown> =>
  mcp.tools.invoke("photoshop.action.list", args, { requestId: "r" });

describe("permission", () => {
  it("**read 다 — 실행하지 않는다**", () => {
    // 액션은 내용을 알 수 없다. 실행은 별도 설계가 필요하다.
    expect(setup().tools.get("photoshop.action.list")?.permission).toBe("read");
  });

  it("읽기 전용 서버에서도 된다", async () => {
    await expect(list(setup(["read"]))).resolves.toBeDefined();
  });
});

describe("**임의 액션을 부를 수 없다** (ROADMAP §17.35)", () => {
  it("이름을 그대로 받는 실행 Tool 이 없다", () => {
    // 세트·액션 이름을 직접 받는 Tool 을 내놓으면 허용 목록이 무의미해진다.
    // 실행은 actions.json 에 선언된 것만 부르는 photoshop.action.run 뿐이다.
    expect(setup().tools.get("photoshop.action.play")).toBeUndefined();
  });

  it("action.run 은 destructive 다", () => {
    // 액션이 무엇을 하는지 알 수 없다. 실기 목록에 '내보내기 > PSD로 저장' 이
    // 있었고 승인된 작업 폴더 밖으로 파일을 쓴다.
    expect(
      setup(["read", "edit", "external", "destructive"]).tools.get("photoshop.action.run")
        ?.permission,
    ).toBe("destructive");
  });

  it("기본 권한에서는 막힌다", async () => {
    const mcp = setup();
    await expect(
      mcp.tools.invoke("photoshop.action.run", { name: "x" }, { requestId: "r" }),
    ).rejects.toThrow(/권한|permission/iu);
  });

  it("**선언이 없으면 아무것도 부를 수 없다**", async () => {
    const mcp = setup(["read", "edit", "external", "destructive"]);
    await expect(
      mcp.tools.invoke("photoshop.action.run", { name: "x" }, { requestId: "r" }),
    ).rejects.toThrow(/선언된 액션이 없습니다/u);
  });

  it("어떻게 선언하는지 말한다", async () => {
    const mcp = setup(["read", "edit", "external", "destructive"]);
    await expect(
      mcp.tools.invoke("photoshop.action.run", { name: "x" }, { requestId: "r" }),
    ).rejects.toThrow(/actions\.json/u);
  });

  it("선언 조회는 read 다", () => {
    // 무엇을 부를 수 있는지 보는 것은 실행이 아니다.
    expect(setup().tools.get("photoshop.action.declared")?.permission).toBe("read");
  });

  it("선언이 없으면 빈 목록이다", async () => {
    const result = (await setup().tools.invoke(
      "photoshop.action.declared",
      {},
      { requestId: "r" },
    )) as { actions: unknown[]; total: number };
    expect(result.actions).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("조회", () => {
  it("**Mock 은 액션을 지어내지 않는다**", async () => {
    // 지어내면 Mock 으로 돌린 워크플로가 없는 액션을 선언하고 성공으로 보인다.
    const result = (await list(setup())) as { sets: unknown[]; totalSets: number };
    expect(result.sets).toEqual([]);
    expect(result.totalSets).toBe(0);
  });

  it("**없는 세트를 조용히 넘기지 않는다**", async () => {
    // 빈 목록을 주면 이름을 틀린 것인지 액션이 없는 것인지 구분할 수 없다.
    await expect(list(setup(), { set: "없는세트" })).rejects.toThrow(/액션 세트가 없습니다/u);
  });

  it("어떻게 찾는지 말한다", async () => {
    await expect(list(setup(), { set: "없는세트" })).rejects.toThrow(/set 없이/u);
  });
});

describe("스키마", () => {
  it("빈 세트 이름을 거절한다", async () => {
    await expect(list(setup(), { set: "" })).rejects.toThrow();
  });

  it("**모르는 필드를 거절한다**", async () => {
    // 두 단계로 바꾸면서 query·limit 을 뺐다. 남아 있으면 조용히 무시된다.
    await expect(list(setup(), { query: "TK9" })).rejects.toThrow();
    await expect(list(setup(), { limit: 10 })).rejects.toThrow();
  });
});
