import {
  ErrorCode,
  PROTOCOL_VERSION,
  WebSocketBridgeTransport,
  type ConnectionState,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it } from "vitest";
import { FakeUxpPlugin } from "./helpers/fake-uxp-plugin.js";

interface Harness {
  transport: WebSocketBridgeTransport;
  url: string;
  states: ConnectionState[];
  plugins: FakeUxpPlugin[];
}

let active: Harness | null = null;

/** 임의의 빈 포트로 전송을 기동한다. */
async function startTransport(timeoutMs?: number): Promise<Harness> {
  const states: ConnectionState[] = [];
  const transport = new WebSocketBridgeTransport({
    port: 0,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    onStateChange: (state) => states.push(state),
  });
  await transport.start();

  const harness: Harness = {
    transport,
    url: `ws://127.0.0.1:${transport.port}`,
    states,
    plugins: [],
  };
  active = harness;
  return harness;
}

async function connectPlugin(
  harness: Harness,
  options: Partial<ConstructorParameters<typeof FakeUxpPlugin>[0]> = {},
): Promise<FakeUxpPlugin> {
  const plugin = new FakeUxpPlugin({ url: harness.url, ...options });
  harness.plugins.push(plugin);
  await plugin.connect();
  return plugin;
}

afterEach(async () => {
  if (active === null) {
    return;
  }
  for (const plugin of active.plugins) {
    await plugin.disconnect();
  }
  await active.transport.stop();
  active = null;
});

describe("WebSocketBridgeTransport", () => {
  it("Photoshop 이 없어도 기동하고 미연결 상태로 시작한다", async () => {
    const { transport } = await startTransport();

    expect(transport.isConnected()).toBe(false);
    expect(transport.state()).toBe("disconnected");
    expect(transport.plugin).toBeNull();
    expect(transport.port).toBeGreaterThan(0);
  });

  it("핸드셰이크가 끝나면 연결됨으로 전이하고 Plugin 정보를 기록한다", async () => {
    const harness = await startTransport();
    const plugin = await connectPlugin(harness);

    expect(plugin.handshake).toEqual({ ok: true });
    expect(harness.transport.isConnected()).toBe(true);
    expect(harness.states).toEqual(["handshaking", "connected"]);
    expect(harness.transport.plugin).toEqual({
      name: "fake-uxp",
      version: "0.0.0",
      host: { app: "PS", version: "26.0.0" },
      commands: ["DOCUMENT_GET", "LAYER_LIST"],
    });
  });

  it("요청/응답을 id 로 대응시킨다", async () => {
    const harness = await startTransport();
    const plugin = await connectPlugin(harness);

    await expect(
      harness.transport.request({ command: "DOCUMENT_GET", payload: {} }),
    ).resolves.toMatchObject({ name: "phase2.psd" });

    expect(plugin.received).toEqual([{ command: "DOCUMENT_GET", payload: {} }]);
  });

  it("동시 요청이 서로 섞이지 않는다", async () => {
    const harness = await startTransport();
    await connectPlugin(harness);

    const [document, layers] = await Promise.all([
      harness.transport.request<{ name: string }>({ command: "DOCUMENT_GET", payload: {} }),
      harness.transport.request<unknown[]>({ command: "LAYER_LIST", payload: {} }),
    ]);

    expect(document.name).toBe("phase2.psd");
    expect(layers).toHaveLength(3);
  });

  it("미연결 상태에서 요청하면 PHOTOSHOP_NOT_CONNECTED 를 던진다", async () => {
    const { transport } = await startTransport();

    await expect(transport.request({ command: "DOCUMENT_GET", payload: {} })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED, recoverable: true }),
    );
  });

  it("Plugin 오류를 코드 그대로 전파한다", async () => {
    const harness = await startTransport();
    await connectPlugin(harness, {
      failWith: {
        DOCUMENT_GET: { code: "DOCUMENT_NOT_FOUND", message: "없음", recoverable: true },
      },
    });

    await expect(
      harness.transport.request({ command: "DOCUMENT_GET", payload: {} }),
    ).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND, recoverable: true }),
    );
  });

  it("Plugin 이 지원하지 않는 Command 는 COMMAND_NOT_SUPPORTED 로 돌아온다", async () => {
    const harness = await startTransport();
    await connectPlugin(harness);

    await expect(
      harness.transport.request({ command: "LAYER_DUPLICATE", payload: {} }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }));
  });

  it("타임아웃 내 응답이 없으면 COMMAND_TIMEOUT 을 던진다", async () => {
    const harness = await startTransport(120);
    await connectPlugin(harness, { silentCommands: ["DOCUMENT_GET"] });

    await expect(
      harness.transport.request({ command: "DOCUMENT_GET", payload: {} }),
    ).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_TIMEOUT, recoverable: true }),
    );
    // 타임아웃은 연결을 닫지 않는다. (PROTOCOL.md §6)
    expect(harness.transport.isConnected()).toBe(true);
  });

  it("타임아웃 후 다른 Command 는 계속 동작한다", async () => {
    const harness = await startTransport(120);
    await connectPlugin(harness, { silentCommands: ["DOCUMENT_GET"] });

    await expect(
      harness.transport.request({ command: "DOCUMENT_GET", payload: {} }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_TIMEOUT }));

    await expect(
      harness.transport.request({ command: "LAYER_LIST", payload: {} }),
    ).resolves.toHaveLength(3);
  });

  it("연결이 끊기면 대기 중인 요청을 타임아웃 대기 없이 즉시 실패시킨다", async () => {
    const harness = await startTransport(60_000);
    const plugin = await connectPlugin(harness, { silentCommands: ["DOCUMENT_GET"] });

    const pending = harness.transport.request({ command: "DOCUMENT_GET", payload: {} });
    const rejection = expect(pending).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED }),
    );

    await plugin.disconnect();
    await rejection;

    expect(harness.transport.isConnected()).toBe(false);
    expect(harness.transport.plugin).toBeNull();
  });

  it("재접속하면 다시 연결됨이 되고 요청이 동작한다", async () => {
    const harness = await startTransport();
    const first = await connectPlugin(harness);
    await first.disconnect();

    // 클라이언트의 close 가 먼저 완료되므로 서버가 끊김을 관측할 때까지 기다린다.
    await expect.poll(() => harness.transport.isConnected(), { timeout: 2000 }).toBe(false);

    await connectPlugin(harness);
    expect(harness.transport.isConnected()).toBe(true);

    await expect(
      harness.transport.request({ command: "LAYER_LIST", payload: {} }),
    ).resolves.toHaveLength(3);

    expect(harness.states).toEqual([
      "handshaking",
      "connected",
      "disconnected",
      "handshaking",
      "connected",
    ]);
  });

  it("프로토콜 버전이 다르면 핸드셰이크를 거부한다", async () => {
    const harness = await startTransport();
    const plugin = await connectPlugin(harness, { protocolVersion: PROTOCOL_VERSION + 1 });

    expect(plugin.handshake).toEqual({ ok: false, code: ErrorCode.PROTOCOL_VERSION_MISMATCH });
    expect(harness.transport.isConnected()).toBe(false);
  });

  it("JSON 이 아닌 프레임은 프로토콜 오류로 처리하고 연결을 닫는다", async () => {
    const harness = await startTransport();
    const plugin = await connectPlugin(harness);
    expect(harness.transport.isConnected()).toBe(true);

    plugin.sendRaw("이건 JSON 이 아니다");

    await expect.poll(() => harness.transport.isConnected(), { timeout: 2000 }).toBe(false);
  });

  it("stop 은 대기 중인 요청을 실패시킨다", async () => {
    const harness = await startTransport(60_000);
    await connectPlugin(harness, { silentCommands: ["DOCUMENT_GET"] });

    const pending = harness.transport.request({ command: "DOCUMENT_GET", payload: {} });
    const rejection = expect(pending).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED }),
    );

    await harness.transport.stop();
    await rejection;
  });
});
