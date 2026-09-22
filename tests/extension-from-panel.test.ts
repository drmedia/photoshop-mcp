import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { WebSocketBridgeTransport, type Logger } from "@photoshop-mcp/photoshop-bridge";
import { startPhotoshopMcpServer, type StartedPhotoshopMcp } from "@photoshop-mcp/mcp-server";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeUxpPlugin } from "./helpers/fake-uxp-plugin.js";

/**
 * 패널에서 등록한 Extension 을 서버가 붙인다. (ROADMAP §18.3)
 *
 * **기본은 "아무 패널도 안 깔려 있다" 다.** 서버의 cwd 는 MCP 클라이언트가
 * 정하므로 서버는 사용자가 설치한 Extension 의 위치를 알 수 없다. 플러그인이
 * 알려 주고, 서버는 **Bridge 가 붙은 뒤에** 묻는다.
 *
 * 그래서 여기서 재는 것은 "Tool 이 늘어나는가" 하나가 아니다. **언제** 늘어나는지,
 * 그리고 **안 늘어날 때 그 이유가 보이는지**가 같이 걸려 있다.
 */

let workspace: string;
let started: StartedPhotoshopMcp | null = null;
let plugin: FakeUxpPlugin | null = null;
let client: Client | null = null;
/** 서버가 낸 경고. **조용히 실패하지 않는지**를 재려면 이것이 필요하다. */
let warnings: string[] = [];

/* fixture 를 **저장소 안**에 만든다. Extension 이 `zod` 를 import 하는데 OS 임시
 * 폴더에 두면 Node 가 위로 올라가며 찾을 `node_modules` 가 없다.
 * (`tool-list-changed.test.ts` 와 같은 이유) */
const TMP_ROOT = fileURLToPath(new URL("../.tmp-tests/", import.meta.url));

beforeEach(async () => {
  await mkdir(TMP_ROOT, { recursive: true });
  workspace = await mkdtemp(join(TMP_ROOT, "frompanel-"));
  warnings = [];
});

afterEach(async () => {
  await client?.close();
  await plugin?.disconnect();
  await started?.stop();
  client = null;
  plugin = null;
  started = null;
  await rm(workspace, { recursive: true, force: true });
});

/** 사용자가 설치한 Extension 을 흉내낸다. 경로를 돌려준다. */
async function installed(namespace: string): Promise<string> {
  const directory = join(workspace, namespace);
  await mkdir(directory, { recursive: true });
  const entry = "index.mjs";
  await writeFile(
    join(directory, entry),
    `import { z } from "zod";
     export function activate(context) {
       context.tools.register({
         name: "${namespace}.hello",
         description: "테스트용",
         permission: "read",
         inputSchema: z.object({}).strict(),
         handler: () => Promise.resolve({ ok: true }),
       });
     }`,
    "utf8",
  );
  await writeFile(
    join(directory, "extension.json"),
    JSON.stringify({
      id: `com.test.${namespace}`,
      name: namespace,
      version: "0.0.0",
      namespace,
      main: entry,
      permissions: ["photoshop.read"],
    }),
    "utf8",
  );
  return directory;
}

/**
 * 서버를 띄운다. **Extension 디렉터리를 주지 않는다** — 번들된 것 없이
 * 패널이 알려 준 것만으로 붙는지를 재는 것이 요점이다.
 */
async function startServer(): Promise<string> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: (message) => {
      warnings.push(message);
    },
  };
  started = await startPhotoshopMcpServer({
    mode: "uxp",
    port: 0,
    transport: serverTransport,
    logger,
  });

  client = new Client({ name: "from-panel-test", version: "0.0.0" });
  await client.connect(clientTransport);

  const transport = started.bridgeTransport;
  if (!(transport instanceof WebSocketBridgeTransport)) {
    throw new Error("uxp 모드인데 WebSocket 전송이 아닙니다.");
  }
  return `ws://127.0.0.1:${transport.port}`;
}

/** 플러그인을 붙이고 핸드셰이크가 끝날 때까지 기다린다. */
async function attach(registered: string[]): Promise<void> {
  const url = await startServer();
  plugin = new FakeUxpPlugin({
    url,
    // 핸드셰이크에 담아 보내야 서버가 묻는다. 실제 플러그인은
    // `dispatcher.list()` 를 그대로 싣는다.
    commands: ["DOCUMENT_GET", "LAYER_LIST", "EXTENSION_REGISTRY"],
    results: {
      EXTENSION_REGISTRY: {
        extensions: registered.map((path) => ({ path, addedAt: 1_700_000_000_000 })),
        total: registered.length,
        persisted: true,
      },
    },
  });
  await plugin.connect();
  await expect.poll(() => started?.bridge.isConnected(), { timeout: 2000 }).toBe(true);
}

const toolNames = async (): Promise<string[]> =>
  (await client!.listTools()).tools.map((tool) => tool.name);

describe("패널이 알려 준 Extension", () => {
  it("**Bridge 가 붙으면 적재된다**", async () => {
    const directory = await installed("panelext");
    await attach([directory]);

    await expect.poll(toolNames, { timeout: 3000 }).toContain("panelext.hello");
  });

  it("**붙기 전에는 없다** — 기동 시점에는 물어볼 수 없다", async () => {
    /* 이것이 `tools/list_changed` 가 필요했던 이유다. 서버가 뜨는 시점에
     * Photoshop 은 아직 붙어 있지 않다. */
    const url = await startServer();
    expect(await toolNames()).not.toContain("panelext.hello");
    expect(url).toContain("ws://");
  });

  it("**아무것도 등록하지 않았으면 아무것도 안 붙는다**", async () => {
    await attach([]);

    // 기본이 "없음" 이라는 것을 고정한다. 번들된 Extension 이 슬쩍 들어오면 깨진다.
    const names = await toolNames();
    expect(names.every((name) => name.startsWith("photoshop."))).toBe(true);
  });
});

describe("재연결", () => {
  it("**다시 붙어도 두 번 적재하지 않는다**", async () => {
    /* 같은 것을 또 넣으면 namespace 충돌로 거부되고, 그 경고가 사용자에게는
     * 아무 일도 없는데 뭔가 잘못된 것처럼 보인다. */
    const directory = await installed("again");
    await attach([directory]);
    await expect.poll(toolNames, { timeout: 3000 }).toContain("again.hello");

    await plugin!.disconnect();
    await expect.poll(() => started?.bridge.isConnected(), { timeout: 2000 }).toBe(false);

    const transport = started!.bridgeTransport;
    if (!(transport instanceof WebSocketBridgeTransport)) {
      throw new Error("uxp 모드인데 WebSocket 전송이 아닙니다.");
    }
    plugin = new FakeUxpPlugin({
      url: `ws://127.0.0.1:${transport.port}`,
      commands: ["DOCUMENT_GET", "LAYER_LIST", "EXTENSION_REGISTRY"],
      results: {
        EXTENSION_REGISTRY: {
          extensions: [{ path: directory, addedAt: 1_700_000_000_000 }],
          total: 1,
          persisted: true,
        },
      },
    });
    await plugin.connect();
    await expect.poll(() => started?.bridge.isConnected(), { timeout: 2000 }).toBe(true);

    const names = await toolNames();
    expect(names.filter((name) => name === "again.hello")).toHaveLength(1);

    /* **경고가 없어야 한다.** Tool 개수만 재면 중복 적재를 잡지 못한다 —
     * 두 번째 시도가 거부되어도 첫 번째가 남아 있어 개수는 그대로다.
     * 사용자에게는 멀쩡한 상태인데 경고만 쌓이는 것이 드러나는 자리다.
     *
     * 재연결이 끝난 직후에 재면 아직 안 왔을 수 있으므로 잠깐 기다린다. */
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(warnings).toEqual([]);
  });
});

describe("옛 플러그인", () => {
  it("**모른다고 하면 묻지 않는다** — 경고를 남기지 않는다", async () => {
    /* 핸드셰이크에 `EXTENSION_REGISTRY` 가 없으면 물어볼 이유가 없다.
     * 불러 보고 실패를 삼키면 붙을 때마다 경고가 한 줄씩 나고, 정상인데
     * 무언가 잘못된 것처럼 보이며 진짜 경고가 그 사이에 묻힌다. */
    const url = await startServer();
    plugin = new FakeUxpPlugin({ url, commands: ["DOCUMENT_GET", "LAYER_LIST"] });
    await plugin.connect();
    await expect.poll(() => started?.bridge.isConnected(), { timeout: 2000 }).toBe(true);

    await expect(client!.listTools()).resolves.toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(warnings).toEqual([]);
    // 아예 보내지도 않는다.
    expect(plugin.received.map((entry) => entry.command)).not.toContain("EXTENSION_REGISTRY");
  });

  it("**있다고 해 놓고 실패하면 알린다**", async () => {
    /* 위에서 없는 경우는 걸러졌으므로 여기 오는 것은 진짜 문제다.
     * 조용히 넘기면 사용자는 등록했는데 Tool 이 안 붙는 이유를 알 수 없다. */
    const url = await startServer();
    plugin = new FakeUxpPlugin({
      url,
      commands: ["EXTENSION_REGISTRY"],
      failWith: {
        EXTENSION_REGISTRY: { code: "INTERNAL_ERROR", message: "저장소가 깨졌습니다" },
      },
    });
    await plugin.connect();
    await expect.poll(() => started?.bridge.isConnected(), { timeout: 2000 }).toBe(true);

    await expect
      .poll(() => warnings.join(" | "), { timeout: 2000 })
      .toMatch(/등록된 Extension 목록을 읽지 못했습니다/u);
  });
});
