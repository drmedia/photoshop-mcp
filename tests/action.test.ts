import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  PhotoshopMcpError,
} from "@photoshop-mcp/photoshop-bridge";
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

/** 액션 실행은 destructive 라 기본 허용 밖이다. */
const ALL = ["read", "edit", "external", "destructive"];

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

describe("**고른 것만 부를 수 있다** (ROADMAP §17.36)", () => {
  const run = async (mcp: Mcp): Promise<unknown> =>
    mcp.tools.invoke(
      "photoshop.action.run",
      { set: "내보내기", action: "PSD로 저장" },
      { requestId: "r" },
    );

  it("action.run 은 destructive 다", () => {
    // 액션이 무엇을 하는지 알 수 없다. 실기 목록에 '내보내기 > PSD로 저장' 이
    // 있었고 승인된 작업 폴더 밖으로 파일을 쓴다.
    expect(setup(ALL).tools.get("photoshop.action.run")?.permission).toBe("destructive");
  });

  it("기본 권한에서는 막힌다", async () => {
    await expect(run(setup())).rejects.toThrow(/권한|permission/iu);
  });

  it("**고르지 않은 것은 못 부른다**", async () => {
    // Mock 에는 고른 것이 없다. 허용 목록은 사용자가 패널에서 정한다.
    await expect(run(setup(ALL))).rejects.toThrow(/허용된 액션이 없습니다/u);
  });

  it("**어디서 고르는지 말한다**", async () => {
    // "허용되지 않았습니다" 만으로는 사용자가 할 수 있는 일이 없다.
    await expect(run(setup(ALL))).rejects.toThrow(/패널.*액션 선택/u);
  });

  it("세트와 액션을 둘 다 요구한다", async () => {
    // 액션 이름은 유일하지 않다 — 같은 이름이 여러 세트에 있다(§17.34).
    const mcp = setup(ALL);
    await expect(
      mcp.tools.invoke("photoshop.action.run", { action: "PSD로 저장" }, { requestId: "r" }),
    ).rejects.toThrow();
    await expect(
      mcp.tools.invoke("photoshop.action.run", { set: "내보내기" }, { requestId: "r" }),
    ).rejects.toThrow();
  });

  it("**이름 대신 설정 키를 받지 않는다**", async () => {
    // actions.json 을 쓰던 설계의 흔적이다. 남아 있으면 조용히 무시된다.
    await expect(
      setup(ALL).tools.invoke("photoshop.action.run", { name: "x" }, { requestId: "r" }),
    ).rejects.toThrow();
  });

  it("**타임아웃이면 대화상자를 의심하라고 말한다**", async () => {
    // 실기에서 "'StarXTerminator' 명령은 현재 사용할 수 없습니다" 창이 떠 멈췄다.
    // 일반 타임아웃 메시지만으로는 그것을 알 수 없다.
    const bridge = new MockPhotoshopBridge();
    const slow = createPhotoshopMcp({
      bridge: {
        ...bridge,
        executeCommand: async () => {
          throw new PhotoshopMcpError(ErrorCode.COMMAND_TIMEOUT, "응답이 없습니다");
        },
      } as unknown as MockPhotoshopBridge,
      logger: createSilentLogger(),
      policy: new PermissionPolicy(ALL as never),
    });
    await expect(
      slow.tools.invoke("photoshop.action.run", { set: "s", action: "a" }, { requestId: "r" }),
    ).rejects.toThrow(/대화상자|window\.capture/u);
  });

  it("허용 목록 조회는 read 다", () => {
    // 무엇을 부를 수 있는지 보는 것은 실행이 아니다.
    expect(setup().tools.get("photoshop.action.declared")?.permission).toBe("read");
  });

  it("**Mock 은 허용 목록을 지어내지 않는다**", async () => {
    const result = (await setup().tools.invoke(
      "photoshop.action.declared",
      {},
      { requestId: "r" },
    )) as { actions: unknown[]; total: number; persisted: boolean };
    expect(result.actions).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.persisted).toBe(false);
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
