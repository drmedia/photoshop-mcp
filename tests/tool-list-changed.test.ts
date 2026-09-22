import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `tools/list_changed`. (ROADMAP §18.3)
 *
 * Extension 은 **기동 뒤에도 붙는다** — 사용자가 Photoshop 패널에서 등록하면
 * 그때 Tool 이 늘어난다. 클라이언트는 `tools/list` 를 캐시하므로 알리지 않으면
 * 새 Tool 이 영원히 보이지 않는다.
 *
 * **선언만 하고 안 보내는 것이 안 하는 것보다 나쁘다.** 클라이언트가 알림을
 * 믿고 다시 묻지 않게 되기 때문이다. 그래서 실제 MCP 클라이언트로 확인한다.
 */

let workspace: string;

/* fixture 를 **저장소 안**에 만든다.
 *
 * Extension 이 `zod` 를 import 하는데, OS 임시 폴더에 두면 Node 가 위로
 * 올라가며 찾을 `node_modules` 가 없어 해석에 실패한다. 저장소 안이면 된다.
 * `.gitignore` 에 등록해 두었다. */
const TMP_ROOT = fileURLToPath(new URL("../.tmp-tests/", import.meta.url));

beforeEach(async () => {
  await mkdir(TMP_ROOT, { recursive: true });
  workspace = await mkdtemp(join(TMP_ROOT, "toollist-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function create(): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"] as never),
  });
}

/** 알림을 세는 클라이언트를 붙인다. */
async function connect(mcp: Mcp): Promise<{
  client: Client;
  /** 지금까지 받은 `tools/list_changed` 수. */
  count: () => number;
  /** `n` 번째 알림이 올 때까지 기다린다. */
  waitFor: (n: number, timeoutMs?: number) => Promise<void>;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "list-changed-test", version: "0.0.0" });

  let received = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    received += 1;
  });

  await Promise.all([mcp.server.start(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    count: () => received,
    waitFor: async (n, timeoutMs = 2000) => {
      const deadline = Date.now() + timeoutMs;
      while (received < n && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    close: async () => {
      await client.close();
      await mcp.server.stop();
    },
  };
}

/** Tool 하나를 등록하는 최소 Extension 을 만든다. */
async function fixture(namespace: string): Promise<string> {
  const directory = join(workspace, namespace);
  await mkdir(directory, { recursive: true });
  const entry = join(directory, "index.mjs");
  await writeFile(
    entry,
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

describe("tools/list_changed", () => {
  it("**서버가 listChanged 를 선언한다**", async () => {
    // 선언하지 않으면 클라이언트가 알림을 무시한다.
    const mcp = create();
    const { client, close } = await connect(mcp);
    try {
      expect(client.getServerCapabilities()?.tools).toMatchObject({ listChanged: true });
    } finally {
      await close();
    }
  });

  it("**기동 뒤에 붙인 Extension 의 Tool 이 목록에 나타난다**", async () => {
    /* 이것이 이 기능의 존재 이유다 — 사용자가 패널에서 Extension 을 등록하는
     * 시점은 서버가 이미 떠 있은 뒤다. */
    const mcp = create();
    const { client, waitFor, count, close } = await connect(mcp);
    try {
      const before = (await client.listTools()).tools.map((tool) => tool.name);
      expect(before).not.toContain("late.hello");

      const directory = await fixture("late");
      await mcp.extensions.load({
        directory,
        manifestPath: join(directory, "extension.json"),
      });

      await waitFor(1);
      expect(count()).toBeGreaterThanOrEqual(1);

      const after = (await client.listTools()).tools.map((tool) => tool.name);
      expect(after).toContain("late.hello");
    } finally {
      await close();
    }
  });

  it("**unload 해도 알린다**", async () => {
    // 늘어날 때만 알리면 사라진 Tool 을 클라이언트가 계속 부른다.
    const mcp = create();
    const directory = await fixture("gone");
    await mcp.extensions.load({
      directory,
      manifestPath: join(directory, "extension.json"),
    });

    const { client, waitFor, close } = await connect(mcp);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain("gone.hello");

      await mcp.extensions.unload("gone");
      await waitFor(1);

      expect((await client.listTools()).tools.map((t) => t.name)).not.toContain("gone.hello");
    } finally {
      await close();
    }
  });

  it("**전송이 붙기 전에 등록해도 던지지 않는다**", async () => {
    /* 기동 시 Extension 을 적재하는 경로가 그렇다. 알림을 보낼 곳이 아직
     * 없는데 그것 때문에 적재가 실패하면 안 된다. */
    const mcp = create();
    const directory = await fixture("early");
    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).resolves.toBeDefined();
    expect(mcp.tools.has("early.hello")).toBe(true);
  });
});
