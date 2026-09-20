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

describe("**실행 Tool 을 내놓지 않았다**", () => {
  it("action.play 가 없다", () => {
    // 이름만 보고는 무엇을 하는지 알 수 없다 — 실기 목록에 '내보내기 > PSD로 저장'
    // 이 있었고 승인된 작업 폴더 밖으로 파일을 쓴다.
    const mcp = setup();
    expect(mcp.tools.get("photoshop.action.play")).toBeUndefined();
    expect(mcp.tools.get("photoshop.action.run")).toBeUndefined();
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
