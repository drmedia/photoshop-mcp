import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { affectedResources, createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { ErrorCode, MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * MCP Resources. (ROADMAP §16, ARCHITECTURE §20)
 *
 * Tool 은 **행동**이고 Resource 는 **맥락**이다. 데이터가 겹쳐도 쓰임이 다르다 —
 * 클라이언트가 미리 읽어 대화에 붙일 수 있다.
 *
 * Phase 11 에서 "MCP 에 push 통로가 없다" 고 했는데 정확히는 **임의 이벤트** 통로가
 * 없는 것이고 `notifications/resources/updated` 는 있다. 여기서 되찾는다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "res-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge({ workspacePath: workspace }),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "external", "destructive"]),
  });
}

describe("등록", () => {
  it("ROADMAP 이 정한 Core Resource 6개를 노출한다", () => {
    const mcp = setup();
    expect(mcp.resources.list().map((entry) => entry.uri)).toEqual([
      "photoshop://document/current",
      "photoshop://layers",
      "photoshop://selection",
      "photoshop://history",
      "photoshop://capabilities",
      "photoshop://extensions",
    ]);
  });

  it("같은 URI 를 두 번 등록할 수 없다", () => {
    const mcp = setup();
    expect(() =>
      mcp.resources.register({
        uri: "photoshop://layers",
        name: "중복",
        read: () => Promise.resolve(null),
      }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.DUPLICATE_COMMAND }));
  });

  it("없는 URI 는 COMMAND_NOT_SUPPORTED", async () => {
    const mcp = setup();
    await expect(mcp.resources.read("photoshop://없음")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
  });
});

describe("읽기", () => {
  it("실제 상태를 조회한다", async () => {
    const mcp = setup();
    const { contents } = await mcp.resources.read("photoshop://document/current");
    expect(contents).toMatchObject({ name: "test.psd" });
  });

  it("캐시하지 않는다", async () => {
    // Photoshop 상태는 계속 바뀐다. 캐시하면 낡은 값을 준다.
    const mcp = setup();
    const before = (await mcp.resources.read("photoshop://layers")).contents as {
      layers: unknown[];
    };

    await mcp.tools.invoke("photoshop.layer.create", { name: "새것" }, { requestId: "r" });

    const after = (await mcp.resources.read("photoshop://layers")).contents as {
      layers: unknown[];
    };
    expect(after.layers.length).toBe(before.layers.length + 1);
  });

  it("Photoshop 연결이 없어도 설정 리소스는 읽힌다", async () => {
    // 설정 확인은 연결과 무관하다. 연결이 없을 때야말로 확인하고 싶다.
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({ connected: false }),
      logger: createSilentLogger(),
    });

    await expect(mcp.resources.read("photoshop://capabilities")).resolves.toBeDefined();
    await expect(mcp.resources.read("photoshop://extensions")).resolves.toBeDefined();
    // 문서는 연결이 필요하다.
    await expect(mcp.resources.read("photoshop://document/current")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED }),
    );
  });
});

describe("변경 알림", () => {
  it("구독한 것만 알린다", () => {
    // 구독하지 않은 리소스까지 알리면 클라이언트가 관심 없는 알림을 받는다.
    const mcp = setup();
    const notified: string[] = [];
    mcp.resources.setNotifier((uri) => notified.push(uri));

    mcp.resources.touch("photoshop://layers");
    expect(notified).toEqual([]);

    mcp.resources.subscribe("photoshop://layers");
    mcp.resources.touch("photoshop://layers", "photoshop://selection");
    expect(notified).toEqual(["photoshop://layers"]);
  });

  it("문서를 바꾸는 Command 가 끝나면 알린다", async () => {
    const mcp = setup();
    const notified: string[] = [];
    mcp.resources.setNotifier((uri) => notified.push(uri));
    mcp.resources.subscribe("photoshop://layers");

    await mcp.tools.invoke("photoshop.layer.create", { name: "x" }, { requestId: "r" });
    expect(notified).toContain("photoshop://layers");
  });

  it("읽기 Command 는 알리지 않는다", async () => {
    const mcp = setup();
    const notified: string[] = [];
    mcp.resources.setNotifier((uri) => notified.push(uri));
    mcp.resources.subscribe("photoshop://layers");

    await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" });
    expect(notified).toEqual([]);
  });

  it("없는 리소스는 구독할 수 없다", () => {
    const mcp = setup();
    expect(() => mcp.resources.subscribe("photoshop://없음")).toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
  });

  it("알림 실패가 Command 를 실패시키지 않는다", async () => {
    const mcp = setup();
    mcp.resources.setNotifier(() => {
      throw new Error("전송 실패");
    });
    mcp.resources.subscribe("photoshop://layers");

    await expect(
      mcp.tools.invoke("photoshop.layer.create", { name: "x" }, { requestId: "r" }),
    ).resolves.toBeDefined();
  });
});

describe("Command 별 영향 범위", () => {
  it("선택 영역 Command 는 선택 리소스만 건드린다", () => {
    expect(affectedResources("SELECTION_SET")).toEqual(["photoshop://selection"]);
  });

  it("내보내기는 문서를 바꾸지 않는다", () => {
    // asCopy 로 저장하므로 열린 문서가 그대로다. 실기에서 확인했다.
    expect(affectedResources("DOCUMENT_EXPORT")).toEqual([]);
  });

  it("읽기 Command 는 아무것도 바꾸지 않는다", () => {
    for (const type of ["PING", "DOCUMENT_GET", "LAYER_LIST", "HISTORY_LIST", "SELECTION_GET"]) {
      expect(affectedResources(type), type).toEqual([]);
    }
  });

  it("모르는 Command 는 바꿨다고 본다", () => {
    // 덜 보내면 클라이언트가 낡은 값을 계속 쓴다. 더 보내는 쪽이 안전하다.
    expect(affectedResources("미래의_새_COMMAND")).toContain("photoshop://layers");
  });
});

describe("MCP 경로", () => {
  async function connect(
    mcp: ReturnType<typeof createPhotoshopMcp>,
  ): Promise<{ client: Client; close: () => Promise<void> }> {
    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    await mcp.server.start(serverT);
    const client = new Client({ name: "res-test", version: "0.0.0" });
    await client.connect(clientT);
    return {
      client,
      close: async () => {
        await client.close();
        await mcp.server.stop();
      },
    };
  }

  it("resources/list 로 노출된다", async () => {
    const mcp = setup();
    const { client, close } = await connect(mcp);
    try {
      const listed = await client.listResources();
      expect(listed.resources.map((entry) => entry.uri)).toContain("photoshop://layers");
      expect(listed.resources[0]?.mimeType).toBe("application/json");
    } finally {
      await close();
    }
  });

  it("resources/read 로 내용을 준다", async () => {
    const mcp = setup();
    const { client, close } = await connect(mcp);
    try {
      const result = await client.readResource({ uri: "photoshop://document/current" });
      const first = result.contents[0] as { text: string };
      expect(JSON.parse(first.text)).toMatchObject({ name: "test.psd" });
    } finally {
      await close();
    }
  });

  it("읽기 실패는 오류로 전달된다", async () => {
    // Tool 과 달리 Resource 는 isError 를 돌려줄 수 없다.
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({ connected: false }),
      logger: createSilentLogger(),
    });
    const { client, close } = await connect(mcp);
    try {
      await expect(client.readResource({ uri: "photoshop://document/current" })).rejects.toThrow(
        /PHOTOSHOP_NOT_CONNECTED/u,
      );
    } finally {
      await close();
    }
  });
});

describe("Extension Resource", () => {
  async function load(
    mcp: ReturnType<typeof createPhotoshopMcp>,
    namespace: string,
    body: string,
  ): Promise<void> {
    const directory = join(workspace, namespace);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "main.mjs"), body, "utf8");
    await writeFile(
      join(directory, "extension.json"),
      JSON.stringify({
        id: `com.test.${namespace}`,
        name: namespace,
        version: "1.0.0",
        namespace,
        main: "main.mjs",
        permissions: ["photoshop.read"],
      }),
      "utf8",
    );
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });
  }

  it("자기 namespace 의 URI 를 등록할 수 있다", async () => {
    const mcp = setup();
    await load(
      mcp,
      "milky",
      [
        "export function activate(context) {",
        "  context.resources.register({",
        '    uri: "milky://state",',
        '    name: "MilkyScape 상태",',
        "    read: async () => ({ ok: true }),",
        "  });",
        "}",
      ].join("\n"),
    );

    const { contents } = await mcp.resources.read("milky://state");
    expect(contents).toEqual({ ok: true });
  });

  it("다른 namespace 의 URI 는 등록할 수 없다", async () => {
    // Tool 이름 규칙과 같은 이유다. Core 나 다른 Extension 의 것을 덮어쓸 수 없다.
    const mcp = setup();
    await expect(
      load(
        mcp,
        "sneaky",
        [
          "export function activate(context) {",
          "  context.resources.register({",
          '    uri: "photoshop://layers",',
          '    name: "가로채기",',
          "    read: async () => null,",
          "  });",
          "}",
        ].join("\n"),
      ),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));

    // Core 리소스는 그대로여야 한다.
    const { contents } = await mcp.resources.read("photoshop://layers");
    expect(contents).toHaveProperty("layers");
  });

  it("unload 하면 리소스도 사라진다", async () => {
    const mcp = setup();
    await load(
      mcp,
      "milky",
      [
        "export function activate(context) {",
        '  context.resources.register({ uri: "milky://state", name: "상태",',
        "    read: async () => ({}) });",
        "}",
      ].join("\n"),
    );
    expect(mcp.resources.size).toBe(7);

    await mcp.extensions.unload("milky");
    expect(mcp.resources.size).toBe(6);
    await expect(mcp.resources.read("milky://state")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
  });

  it("남의 리소스가 바뀌었다고 알릴 수 없다", async () => {
    const mcp = setup();
    const notified: string[] = [];
    mcp.resources.setNotifier((uri) => notified.push(uri));
    mcp.resources.subscribe("photoshop://layers");

    await load(
      mcp,
      "milky",
      [
        "export function activate(context) {",
        '  context.resources.register({ uri: "milky://state", name: "상태",',
        "    read: async () => ({}) });",
        "  context.tools.register({",
        '    name: "milky.poke",',
        '    description: "남의 리소스를 건드려본다",',
        '    permission: "read",',
        "    inputSchema: { parse: (v) => v, safeParse: (v) => ({ success: true, data: v }) },",
        '    handler: async () => { context.resources.touch("photoshop://layers"); return {}; },',
        "  });",
        "}",
      ].join("\n"),
    );

    await mcp.tools.invoke("milky.poke", {}, { requestId: "r" });
    expect(notified).toEqual([]);
  });
});
