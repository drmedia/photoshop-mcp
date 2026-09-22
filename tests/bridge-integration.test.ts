import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startPhotoshopMcpServer, type StartedPhotoshopMcp } from "photoshop-mcp";
import { ErrorCode, WebSocketBridgeTransport } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_TOOLS, FORBIDDEN_TOOLS } from "./helpers/expected-tools.js";
import { FAKE_DOCUMENT, FAKE_LAYERS, FakeUxpPlugin } from "./helpers/fake-uxp-plugin.js";

/**
 * Phase 2 통합 테스트.
 *
 * MCP Client 부터 가짜 UXP Plugin 까지 전 구간을 실제 WebSocket 으로 연결한다.
 *
 * ```text
 * MCP Client → PhotoshopMcpServer → ToolRegistry → CommandEngine
 *            → UXPPhotoshopBridge → WebSocketBridgeTransport
 *            ═ WebSocket ═ FakeUxpPlugin
 * ```
 *
 * Photoshop DOM 호출부(`photoshop-uxp/src/dom/*`)는 Photoshop 런타임이 필요하므로
 * 여기서 검증하지 않는다. 그 부분은 실기 확인 대상이다.
 */

interface Harness {
  client: Client;
  mcp: StartedPhotoshopMcp;
  plugin: FakeUxpPlugin | null;
  url: string;
}

let active: Harness | null = null;

type PluginOptions = Partial<ConstructorParameters<typeof FakeUxpPlugin>[0]>;

async function connect(
  options: { plugin?: PluginOptions | null; timeoutMs?: number } = {},
): Promise<Harness> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcp = await startPhotoshopMcpServer({
    mode: "uxp",
    port: 0,
    transport: serverTransport,
  });

  const client = new Client({ name: "phase2-test", version: "0.0.0" });
  await client.connect(clientTransport);

  const transport = mcp.bridgeTransport;
  // instanceof 로 좁힌다. BridgeTransport 인터페이스에는 port 가 없다 —
  // 전송 방식에 따라 포트 개념이 없을 수 있기 때문이다.
  if (!(transport instanceof WebSocketBridgeTransport)) {
    throw new Error("uxp 모드인데 WebSocket 전송이 아닙니다.");
  }
  const port = transport.port;
  const url = `ws://127.0.0.1:${port}`;

  let plugin: FakeUxpPlugin | null = null;
  if (options.plugin !== null) {
    plugin = new FakeUxpPlugin({ url, ...options.plugin });
    await plugin.connect();
    // ready 에는 ack 가 없으므로 Server 가 처리할 때까지 기다린다. (PROTOCOL.md §3.4)
    await expect.poll(() => mcp.bridge.isConnected(), { timeout: 2000 }).toBe(true);
  }

  const harness: Harness = { client, mcp, plugin, url };
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
  if (active === null) {
    return;
  }
  await active.plugin?.disconnect();
  await active.client.close();
  await active.mcp.stop();
  active = null;
});

describe("Phase 2 Bridge 통합", () => {
  it("Photoshop 이 연결되지 않아도 MCP 서버는 기동하고 Tool 을 노출한다", async () => {
    const { client, mcp } = await connect({ plugin: null });

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOLS]);
    expect(mcp.bridge.isConnected()).toBe(false);
  });

  it("Plugin 미연결 시 ping 은 성공하고 bridgeConnected: false 를 보고한다", async () => {
    const { client } = await connect({ plugin: null });

    const result = await client.callTool({ name: "photoshop.ping", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(payload(result)).toMatchObject({ status: "ok", bridgeConnected: false });
  });

  it("Plugin 미연결 시 document.get 은 PHOTOSHOP_NOT_CONNECTED 를 반환한다", async () => {
    const { client } = await connect({ plugin: null });

    const result = await client.callTool({ name: "photoshop.document.get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({
      code: ErrorCode.PHOTOSHOP_NOT_CONNECTED,
      recoverable: true,
    });
  });

  it("Plugin 이 연결되면 ping 이 bridgeConnected: true 를 보고한다", async () => {
    const { client } = await connect();

    expect(payload(await client.callTool({ name: "photoshop.ping", arguments: {} }))).toMatchObject(
      { status: "ok", bridgeConnected: true },
    );
  });

  it("document.get 이 Plugin 응답을 그대로 전달한다", async () => {
    const { client, plugin } = await connect();

    const result = await client.callTool({ name: "photoshop.document.get", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(payload(result)).toEqual(FAKE_DOCUMENT);
    // Tool → Command Engine → Bridge → Plugin 경로로 Command 가 전달되었다.
    expect(plugin?.received).toEqual([{ command: "DOCUMENT_GET", payload: {} }]);
  });

  it("layer.list 가 Plugin 응답을 그대로 전달한다", async () => {
    const { client, plugin } = await connect();

    const result = await client.callTool({ name: "photoshop.layer.list", arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(payload(result)).toEqual({ layers: FAKE_LAYERS });
    expect(plugin?.received).toEqual([{ command: "LAYER_LIST", payload: {} }]);
  });

  it("활성 문서가 없으면 DOCUMENT_NOT_FOUND 가 MCP 오류 응답으로 전파된다", async () => {
    const { client } = await connect({ plugin: { document: null } });

    for (const name of ["photoshop.document.get", "photoshop.layer.list"]) {
      const result = await client.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(payload(result)).toMatchObject({
        code: ErrorCode.DOCUMENT_NOT_FOUND,
        recoverable: true,
      });
    }
  });

  it("Plugin 응답이 스키마를 만족하지 않으면 PROTOCOL_ERROR 로 차단한다", async () => {
    const { client } = await connect({
      plugin: { malformedResults: { DOCUMENT_GET: { id: "문자열이면 안 된다" } } },
    });

    const result = await client.callTool({ name: "photoshop.document.get", arguments: {} });

    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ code: ErrorCode.PROTOCOL_ERROR });
  });

  it("Plugin 이 끊기면 이후 요청이 PHOTOSHOP_NOT_CONNECTED 가 된다", async () => {
    const { client, plugin, mcp } = await connect();

    expect(
      payload(await client.callTool({ name: "photoshop.document.get", arguments: {} })),
    ).toEqual(FAKE_DOCUMENT);

    await plugin?.disconnect();
    await expect.poll(() => mcp.bridge.isConnected(), { timeout: 2000 }).toBe(false);

    const result = await client.callTool({ name: "photoshop.document.get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(payload(result)).toMatchObject({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED });
  });

  it("Plugin 이 재접속하면 다시 동작한다", async () => {
    const harness = await connect();

    await harness.plugin?.disconnect();
    await expect.poll(() => harness.mcp.bridge.isConnected(), { timeout: 2000 }).toBe(false);

    const reconnected = new FakeUxpPlugin({ url: harness.url });
    harness.plugin = reconnected;
    await reconnected.connect();
    // ready 에는 ack 가 없으므로 Server 가 처리할 때까지 기다린다. (PROTOCOL.md §3.4)
    await expect.poll(() => harness.mcp.bridge.isConnected(), { timeout: 2000 }).toBe(true);
    expect(
      payload(await harness.client.callTool({ name: "photoshop.layer.list", arguments: {} })),
    ).toEqual({ layers: FAKE_LAYERS });
  });

  it("아직 범위 밖인 Tool 은 노출하지 않는다", async () => {
    const { client } = await connect();

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(names).not.toContain(forbidden);
    }
  });
});
