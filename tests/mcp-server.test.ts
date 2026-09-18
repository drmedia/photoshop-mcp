import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import {
  DEFAULT_MOCK_LAYERS,
  ErrorCode,
  MockPhotoshopBridge,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_TOOLS } from "./helpers/expected-tools.js";

interface Harness {
  client: Client;
  bridge: MockPhotoshopBridge;
  close: () => Promise<void>;
}

let active: Harness | null = null;

/** In-memory transport 로 MCP Client 와 서버를 연결한다. */
async function connect(): Promise<Harness> {
  const bridge = new MockPhotoshopBridge();
  const { server } = createPhotoshopMcp({ bridge });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.start(serverTransport), client.connect(clientTransport)]);

  const harness: Harness = {
    client,
    bridge,
    close: async () => {
      await client.close();
      await server.stop();
    },
  };
  active = harness;
  return harness;
}

/** `tools/call` 응답 본문(JSON 텍스트)을 파싱한다. */
/**
 * Tool 호출 결과에서 JSON 본문을 꺼낸다.
 *
 * `callTool` 의 반환 타입은 유니온이라 `content` 가 없는 갈래도 있다.
 * 좁은 타입을 파라미터로 받으면 타입 오류가 나므로 `unknown` 을 받아 여기서 좁힌다.
 */
function payload(result: unknown): unknown {
  const content = (result as { content?: unknown }).content as
    { type: string; text: string }[] | undefined;
  const first = content?.[0];
  if (first === undefined || first.type !== "text") {
    throw new Error("텍스트 content 가 없습니다.");
  }
  return JSON.parse(first.text);
}

afterEach(async () => {
  await active?.close();
  active = null;
});

describe("PhotoshopMcpServer", () => {
  it("tools/list 로 Tool 을 스키마와 함께 노출한다", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOLS]);
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("tools/call 로 photoshop.ping 을 실행한다", async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: "photoshop.ping", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(payload(result)).toEqual({
      status: "ok",
      server: "PhotoshopMCP",
      version: "0.1.0",
      bridgeConnected: true,
    });
  });

  it("tools/call 로 문서와 레이어를 조회한다", async () => {
    const { client } = await connect();

    expect(
      payload(await client.callTool({ name: "photoshop.document.get", arguments: {} })),
    ).toMatchObject({ name: "test.psd", width: 6048 });
    expect(payload(await client.callTool({ name: "photoshop.layer.list", arguments: {} }))).toEqual(
      { layers: DEFAULT_MOCK_LAYERS.map((layer) => ({ ...layer })) },
    );
  });

  it("Bridge 오류를 오류 코드가 담긴 Error Response 로 변환한다", async () => {
    const { client, bridge } = await connect();
    bridge.setConnected(false);

    const result = await client.callTool({ name: "photoshop.document.get", arguments: {} });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({
      code: ErrorCode.PHOTOSHOP_NOT_CONNECTED,
      recoverable: true,
    });
  });

  it("등록되지 않은 Tool 호출은 TOOL_NOT_FOUND Error Response 를 반환한다", async () => {
    const { client } = await connect();

    const result = await client.callTool({ name: "photoshop.nonexistent.tool", arguments: {} });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ code: ErrorCode.TOOL_NOT_FOUND });
  });

  it("스키마에 없는 인자를 주면 INVALID_PARAMETER Error Response 를 반환한다", async () => {
    const { client } = await connect();

    const result = await client.callTool({
      name: "photoshop.ping",
      arguments: { unexpected: true },
    });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ code: ErrorCode.INVALID_PARAMETER });
  });
});
