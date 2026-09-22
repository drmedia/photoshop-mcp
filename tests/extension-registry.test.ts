import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  PhotoshopMcpError,
  type PhotoshopBridge,
  type PhotoshopCommand,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 패널이 보관하는 Extension 등록 목록. (ROADMAP §18.3)
 *
 * **기본은 "아무 패널도 안 깔려 있다" 다.** 서버는 자기 cwd 를 통제할 수 없으므로
 * 사용자가 설치한 Extension 의 위치를 알 방법이 없다. 플러그인이 알려 준다.
 *
 * 고정하는 것은 셋이다 — **조회일 뿐 적재가 아니고**(`read`), 모양이 다르면
 * 조용히 넘기지 않으며, Mock 은 비어 있다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(bridge: PhotoshopBridge, allow: string[] = ["read", "edit"]): Mcp {
  return createPhotoshopMcp({
    bridge,
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

/** 플러그인이 무엇을 돌려주든 그대로 흘려보내는 Bridge. 모양 검사를 재려면 필요하다. */
function bridgeReturning(value: unknown): PhotoshopBridge {
  return {
    isConnected: () => true,
    executeCommand: async <TResult>(command: PhotoshopCommand): Promise<TResult> => {
      if (command.type !== "EXTENSION_REGISTRY") {
        throw new Error(`예상하지 못한 Command: ${command.type}`);
      }
      return value as TResult;
    },
    getDocumentInfo: () => {
      throw new Error("쓰이지 않는다");
    },
    getLayers: () => {
      throw new Error("쓰이지 않는다");
    },
  };
}

const read = async (mcp: Mcp): Promise<unknown> =>
  mcp.engine.execute({ type: "EXTENSION_REGISTRY", params: {} }, { requestId: "r" });

describe("permission", () => {
  it("**read 다 — 목록을 보는 것은 적재가 아니다**", () => {
    // 적재는 서버가 하고, 무엇을 적재할지는 사용자가 패널에서 정한다.
    // 이것을 edit 으로 두면 읽기 전용 서버에서 Extension 이 전부 사라진다.
    expect(setup(new MockPhotoshopBridge()).commands.get("EXTENSION_REGISTRY")?.permission).toBe(
      "read",
    );
  });

  it("읽기 전용 서버에서도 된다", async () => {
    await expect(read(setup(new MockPhotoshopBridge(), ["read"]))).resolves.toBeDefined();
  });
});

describe("Mock", () => {
  it("**비어 있다** — Mock 에는 패널이 없다", async () => {
    // 지어내면 Mock 으로 돌린 서버가 존재하지 않는 경로를 적재하려 한다.
    await expect(read(setup(new MockPhotoshopBridge()))).resolves.toEqual({
      extensions: [],
      total: 0,
      persisted: false,
    });
  });
});

describe("결과 검증", () => {
  it("정상 응답을 그대로 돌려준다", async () => {
    const mcp = setup(
      bridgeReturning({
        extensions: [{ path: "D:/tools/graxpert", addedAt: 1_700_000_000_000 }],
        total: 1,
        persisted: true,
      }),
    );

    await expect(read(mcp)).resolves.toEqual({
      extensions: [{ path: "D:/tools/graxpert", addedAt: 1_700_000_000_000 }],
      total: 1,
      persisted: true,
    });
  });

  it("**모양이 다르면 거절한다** — 조용히 빈 목록으로 떨어뜨리지 않는다", async () => {
    // 빈 목록으로 떨어뜨리면 사용자는 등록했는데 Tool 이 안 붙는 이유를 알 수 없다.
    const mcp = setup(bridgeReturning({ extensions: [{ path: 7 }], total: 1, persisted: true }));

    try {
      await read(mcp);
      expect.unreachable("깨진 응답이 거부되지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoshopMcpError);
      expect((error as PhotoshopMcpError).code).toBe(ErrorCode.PROTOCOL_ERROR);
    }
  });

  it("`persisted` 가 빠져도 거절한다 — 없는 값을 참으로 읽지 않는다", async () => {
    const mcp = setup(bridgeReturning({ extensions: [], total: 0 }));

    await expect(read(mcp)).rejects.toThrow(PhotoshopMcpError);
  });
});

describe("파라미터", () => {
  it("**인자를 받지 않는다** — 경로는 사용자가 패널에서만 정한다", async () => {
    // 여기로 경로가 들어올 수 있으면 LLM 이 임의 폴더를 적재시킬 수 있게 된다.
    const mcp = setup(new MockPhotoshopBridge());

    await expect(
      mcp.engine.execute(
        { type: "EXTENSION_REGISTRY", params: { path: "D:/anywhere" } },
        { requestId: "r" },
      ),
    ).rejects.toThrow();
  });
});

describe("Tool 로 노출되지 않는다", () => {
  it("**`photoshop.extension.*` Tool 이 없다**", () => {
    // LLM 이 알아야 할 것이 아니다. 서버가 Bridge 로 묻고 끝나는 내부 조회다.
    const names = setup(new MockPhotoshopBridge())
      .tools.list()
      .map((tool) => tool.name);

    expect(names.filter((name) => name.includes("extension"))).toEqual([]);
  });
});
