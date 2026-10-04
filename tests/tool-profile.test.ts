import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  RETOUCH_TOOLS,
  createPhotoshopMcp,
  createSilentLogger,
  isToolVisible,
  parseToolProfile,
  type ToolProfile,
} from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it } from "vitest";
import { INSTRUCTIONS, retouchPrompt } from "../packages/mcp-core/src/server/guidance.js";

/**
 * Tool 프로필. (ROADMAP §102)
 *
 * `tools/list` 에 보이는 것만 줄인다. 권한 강제는 그대로이고 감춘 Tool 을 부르면 실행하지 않고
 * 이유를 말한다.
 */

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(profile?: ToolProfile): Promise<{
  client: Client;
  mcp: ReturnType<typeof createPhotoshopMcp>;
}> {
  const mcp = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"] as never),
    ...(profile === undefined ? {} : { profile }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "profile-test", version: "0.0.0" });
  clients.push(client);
  await Promise.all([mcp.server.start(serverTransport), client.connect(clientTransport)]);
  return { client, mcp };
}

const names = async (client: Client): Promise<string[]> =>
  (await client.listTools()).tools.map((tool) => tool.name);

describe("parseToolProfile", () => {
  it("생략하거나 빈 값은 full 이다", () => {
    expect(parseToolProfile(undefined)).toEqual({ profile: "full", unknown: null });
    expect(parseToolProfile("  ")).toEqual({ profile: "full", unknown: null });
  });

  it("대소문자와 공백을 가리지 않는다", () => {
    expect(parseToolProfile(" Retouch ").profile).toBe("retouch");
    expect(parseToolProfile("READONLY").profile).toBe("readonly");
  });

  it("모르는 값은 full 로 두고 알린다", () => {
    expect(parseToolProfile("lite")).toEqual({ profile: "full", unknown: "lite" });
  });
});

describe("isToolVisible", () => {
  it("full 은 전부 보인다", () => {
    expect(isToolVisible("full", { name: "photoshop.text.create", permission: "edit" })).toBe(true);
  });

  it("retouch 는 목록에 없는 Core Tool 을 감춘다", () => {
    expect(isToolVisible("retouch", { name: "photoshop.text.create", permission: "edit" })).toBe(
      false,
    );
    expect(
      isToolVisible("retouch", { name: "photoshop.camera_raw.apply", permission: "edit" }),
    ).toBe(true);
  });

  it("retouch 는 Extension Tool 을 가리지 않는다", () => {
    expect(
      isToolVisible("retouch", { name: "graxpert.run_gradient", permission: "external" }),
    ).toBe(true);
  });

  it("readonly 는 read 만 보인다 — Extension 도 마찬가지다", () => {
    expect(isToolVisible("readonly", { name: "photoshop.layer.list", permission: "read" })).toBe(
      true,
    );
    expect(isToolVisible("readonly", { name: "photoshop.layer.create", permission: "edit" })).toBe(
      false,
    );
    expect(
      isToolVisible("readonly", { name: "graxpert.run_gradient", permission: "external" }),
    ).toBe(false);
  });
});

describe("retouch 목록", () => {
  it("적힌 이름이 전부 레지스트리에 있다 — 오타가 조용히 Tool 을 감추지 못한다", async () => {
    const { mcp } = await connect();
    const registered = new Set(mcp.tools.list().map((tool) => tool.name));
    const missing = [...RETOUCH_TOOLS].filter((name) => !registered.has(name));
    expect(missing).toEqual([]);
  });

  it("보정 지침이 언급한 Tool 이 전부 들어 있다", async () => {
    const { mcp } = await connect();
    const text = `${INSTRUCTIONS}\n${retouchPrompt(undefined)}`;
    const mentioned = mcp.tools
      .list()
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("photoshop."))
      // `document.close` 가 `document.close_created` 안에서 잡히지 않도록 이름의 끝을 본다.
      .filter((name) =>
        new RegExp(`${name.slice("photoshop.".length).replace(".", "\\.")}(?![a-z_])`).test(text),
      );
    expect(mentioned.length).toBeGreaterThan(5);
    expect(mentioned.filter((name) => !RETOUCH_TOOLS.has(name))).toEqual([]);
  });
});

describe("프로필별 tools/list", () => {
  it("기본은 full 이고 Core 전부가 보인다", async () => {
    const { client, mcp } = await connect();
    expect(await names(client)).toEqual(mcp.tools.list().map((tool) => tool.name));
  });

  it("retouch 는 목록을 줄이되 보정에 쓰는 것은 남긴다", async () => {
    const { client, mcp } = await connect("retouch");
    const listed = await names(client);
    expect(listed.length).toBeLessThan(mcp.tools.size);
    expect(listed).toContain("photoshop.camera_raw.apply");
    expect(listed).toContain("photoshop.document.compare");
    expect(listed).not.toContain("photoshop.text.create");
    expect(listed).not.toContain("photoshop.path.stroke");
  });

  it("readonly 는 read 권한 Tool 만 보인다", async () => {
    const { client, mcp } = await connect("readonly");
    const listed = new Set(await names(client));
    expect(listed.size).toBeGreaterThan(0);
    for (const tool of mcp.tools.list()) {
      expect(listed.has(tool.name)).toBe(tool.permission === "read");
    }
  });

  it("감춘 Tool 을 부르면 실행하지 않고 이유를 말한다", async () => {
    const { client } = await connect("retouch");
    const before = await client.callTool({ name: "photoshop.layer.list", arguments: {} });
    expect(before.isError).not.toBe(true);

    const result = await client.callTool({
      name: "photoshop.text.create",
      arguments: { text: "x" },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain("retouch");
    expect(text).toContain("PHOTOSHOP_MCP_PROFILE=full");
    // 전체 Tool 이름을 쏟지 않는다 — 감춘 이유가 토큰이다.
    expect(text.length).toBeLessThan(600);
  });

  it("diagnostics 가 말하는 감춘 수가 tools/list 가 실제로 뺀 수와 같다", async () => {
    /* 실기에서 모델이 `diagnostics` 로 184개를 보고도 감춘 Tool 을 "서버에 없다" 고 답했다.
     * 감춘 수는 목록을 거르는 쪽과 **독립으로** 맞아야 한다 — 같은 함수를 두 번 부르는 것은
     * 검증이 아니다. 여기서는 실제 MCP 클라이언트가 받은 `tools/list` 로 센다. */
    for (const profile of ["full", "retouch", "readonly"] as const) {
      const { client } = await connect(profile);
      const listed = (await names(client)).length;
      const result = await client.callTool({ name: "photoshop.diagnostics", arguments: {} });
      const report = JSON.parse(
        (result.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { registry: { tools: number; profile: string; hiddenTools: number } };

      expect(report.registry.profile).toBe(profile);
      expect(report.registry.tools - report.registry.hiddenTools).toBe(listed);
    }
  });

  it("모르는 이름은 프로필과 무관하게 그냥 없는 Tool 이다", async () => {
    const { client } = await connect("retouch");
    const result = await client.callTool({ name: "photoshop.nope", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).not.toContain("프로필");
  });
});
