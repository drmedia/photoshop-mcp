import { createServer, type Server } from "node:net";
import {
  DEFAULT_PORT,
  PORT_CANDIDATES,
  WebSocketBridgeTransport,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { portConflictMessage } from "../packages/mcp-server/src/port-holder.js";
import { readOptionsFromEnv } from "../packages/mcp-server/src/run.js";
import { WebSocketServer } from "ws";
import { CommandDispatcher } from "../photoshop-uxp/src/dispatcher/dispatcher.js";
import {
  BRIDGE_PORT_COUNT,
  BRIDGE_PORT_START,
  bridgeUrls,
  orderedBridgeUrls,
} from "../photoshop-uxp/src/transport/bridge-ports.js";
import { BridgeClient } from "../photoshop-uxp/src/transport/ws-client.js";

/**
 * 포트 범위 탐색. (ROADMAP §93)
 *
 * 다른 프로그램이 8765 를 쓰고 있어도 서버가 다음 빈 포트를 열고, Plugin 이 같은 범위를 훑어 찾는다.
 * 실제 서버 전송과 실제 `BridgeClient` 를 루프백에서 붙여 본다 — 목으로 흉내 내면 "닫힌 포트는
 * 즉시 거절된다", "남의 WebSocket 서버는 hello_ack 를 안 준다" 같은 전제가 시험에서 빠진다.
 */

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

/** OS 가 고른 빈 포트. 닫은 뒤 돌려주므로 잠깐 사이 다른 곳이 가져갈 수 있으나 시험에는 충분하다. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** 포트를 점유한다(TCP 만 — WebSocket 서버가 아닌 다른 프로그램). */
async function occupy(port: number): Promise<Server> {
  const blocker = createServer();
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, "127.0.0.1", resolve);
  });
  cleanups.push(() => new Promise<void>((resolve) => blocker.close(() => resolve())));
  return blocker;
}

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("조건이 시간 안에 충족되지 않았습니다.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const url = (port: number): string => `ws://127.0.0.1:${String(port)}`;

function makeClient(
  urls: string[],
  extra: { onConnected?: (u: string) => void; log?: (m: string) => void } = {},
): BridgeClient {
  const dispatcher = new CommandDispatcher();
  dispatcher.register("PING", async () => ({ ok: true }));
  const client = new BridgeClient({
    urls,
    dispatcher,
    plugin: { name: "test", version: "0.0.0" },
    ...extra,
  });
  cleanups.push(() => client.stop());
  return client;
}

describe("서버 — 빈 포트 찾기", () => {
  it("앞 포트가 쓰이고 있으면 다음 포트를 연다", async () => {
    const base = await freePort();
    await occupy(base);
    const transport = new WebSocketBridgeTransport({ port: base, portCount: 3 });
    cleanups.push(() => transport.stop());
    await transport.start();
    expect(transport.port).toBeGreaterThan(base);
    expect(transport.port).toBeLessThan(base + 3);
  });

  it("후보가 하나뿐이면(포트 고정) 넘어가지 않고 EADDRINUSE 로 실패한다", async () => {
    const base = await freePort();
    await occupy(base);
    const transport = new WebSocketBridgeTransport({ port: base });
    await expect(transport.start()).rejects.toThrow(/EADDRINUSE/u);
  });

  it("후보를 모두 쓰고 있으면 EADDRINUSE 로 실패한다 — run.ts 가 이것으로 충돌을 알아본다", async () => {
    const base = await freePort();
    await occupy(base);
    await occupy(base + 1).catch(() => undefined);
    const transport = new WebSocketBridgeTransport({ port: base, portCount: 2 });
    await expect(transport.start()).rejects.toThrow(/EADDRINUSE/u);
  });

  it("앞 포트가 비어 있으면 그 포트를 쓴다", async () => {
    const base = await freePort();
    const transport = new WebSocketBridgeTransport({ port: base, portCount: 5 });
    cleanups.push(() => transport.stop());
    await transport.start();
    expect(transport.port).toBe(base);
  });
});

describe("서버와 Plugin 의 범위가 같다", () => {
  it("시작 포트와 후보 수가 서버 상수와 같다 — 한쪽만 바뀌면 Plugin 이 서버를 못 찾는다", () => {
    expect(BRIDGE_PORT_START).toBe(DEFAULT_PORT);
    expect(BRIDGE_PORT_COUNT).toBe(PORT_CANDIDATES);
  });

  it("후보 URL 은 루프백의 연속 포트뿐이다", () => {
    const urls = bridgeUrls();
    expect(urls).toHaveLength(PORT_CANDIDATES);
    expect(urls[0]).toBe(`ws://127.0.0.1:${String(DEFAULT_PORT)}`);
    expect(urls.at(-1)).toBe(`ws://127.0.0.1:${String(DEFAULT_PORT + PORT_CANDIDATES - 1)}`);
  });

  it("마지막으로 붙은 주소가 맨 앞에 서고 나머지 순서는 유지된다", () => {
    const preferred = `ws://127.0.0.1:${String(DEFAULT_PORT + 4)}`;
    const ordered = orderedBridgeUrls(preferred);
    expect(ordered[0]).toBe(preferred);
    expect(ordered).toHaveLength(PORT_CANDIDATES);
    expect(new Set(ordered).size).toBe(PORT_CANDIDATES);
    expect(ordered.slice(1)).toEqual(bridgeUrls().filter((candidate) => candidate !== preferred));
  });

  it("범위 밖이거나 모르는 저장 값은 무시한다 — 저장소 값이 임의 주소로 가는 길이 되면 안 된다", () => {
    for (const bad of [
      "ws://example.com:8765",
      "ws://127.0.0.1:9999",
      "garbage",
      "",
      null,
      undefined,
    ]) {
      expect(orderedBridgeUrls(bad)).toEqual(bridgeUrls());
    }
  });
});

describe("Plugin — 서버 찾기", () => {
  it("닫힌 포트를 지나 서버가 있는 포트에 붙는다", async () => {
    const dead = await freePort();
    const transport = new WebSocketBridgeTransport({ port: 0 });
    cleanups.push(() => transport.stop());
    await transport.start();
    const live = url(transport.port);

    const connected: string[] = [];
    const client = makeClient([url(dead), live], { onConnected: (u) => connected.push(u) });
    client.start();
    await until(() => client.state === "connected");

    expect(client.url).toBe(live);
    expect(connected).toEqual([live]);
    // 클라이언트는 ready 를 보낸 직후 connected 가 된다. 서버가 그것을 처리할 때까지 기다린다 — 곧바로
    // 단언하면 부하에서 서버가 아직 awaiting_ready 일 때 검사하게 된다.
    await until(() => transport.isConnected());
    // 서버가 알려 준 pid — 같은 기계에 서버가 여럿일 때 어느 쪽인지 가린다.
    expect(client.serverPid).toBe(process.pid);
  });

  it("남의 WebSocket 서버(핸드셰이크에 답하지 않음)는 기한이 지나면 넘어간다", async () => {
    const foreign = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>((resolve) => foreign.once("listening", () => resolve()));
    cleanups.push(() => new Promise<void>((resolve) => foreign.close(() => resolve())));
    const foreignPort = (foreign.address() as { port: number }).port;

    const transport = new WebSocketBridgeTransport({ port: 0 });
    cleanups.push(() => transport.stop());
    await transport.start();

    const client = makeClient([url(foreignPort), url(transport.port)]);
    client.start();
    await until(() => client.state === "connected", 10_000);
    expect(client.url).toBe(url(transport.port));
  }, 15_000);

  it("모든 후보가 비면 백오프 상태가 되고, 사유가 훑은 범위를 말한다", async () => {
    const a = await freePort();
    const b = await freePort();
    const client = makeClient([url(a), url(b)]);
    client.start();
    await until(() => client.state === "retrying");
    expect(client.lastError).toMatch(/No server found/u);
    expect(client.lastError).toContain(url(a));
    expect(client.urlRange).toBe(`${url(a)}–${String(b)}`);
  });

  it("끊긴 뒤에는 마지막으로 붙은 후보부터 시도한다 — 앞 후보를 다시 두드리지 않는다", async () => {
    const dead = await freePort();
    const first = new WebSocketBridgeTransport({ port: 0 });
    await first.start();
    const port = first.port;

    const logs: string[] = [];
    const client = makeClient([url(dead), url(port)], { log: (m) => logs.push(m) });
    client.start();
    await until(() => client.state === "connected");

    logs.length = 0;
    await first.stop();
    await until(() => client.state !== "connected");

    // 같은 포트에 서버를 다시 띄운다. 백오프(1초) 뒤 재접속한다.
    const second = new WebSocketBridgeTransport({ port });
    cleanups.push(() => second.stop());
    await second.start();
    await until(() => client.state === "connected", 8_000);

    expect(logs.some((line) => line.includes(url(dead)))).toBe(false);
    expect(client.url).toBe(url(port));
  }, 15_000);

  it("stop() 이후에는 더 시도하지 않는다", async () => {
    const dead = [await freePort(), await freePort(), await freePort()];
    const logs: string[] = [];
    const client = makeClient(dead.map(url), { log: (m) => logs.push(m) });
    client.start();
    client.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const settled = logs.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(logs.length).toBe(settled);
    expect(client.state).toBe("disconnected");
  });
});

describe("run.ts — 포트를 고정했는가", () => {
  it("환경 변수가 없으면 고정하지 않은 것이다 — 서버가 범위를 훑는다", () => {
    const options = readOptionsFromEnv({});
    expect(options.portPinned).toBe(false);
    expect(options.port).toBe(DEFAULT_PORT);
  });

  it("값을 주면 고정이다 — 그 포트 하나만 쓴다", () => {
    const options = readOptionsFromEnv({ PHOTOSHOP_MCP_PORT: "8770" });
    expect(options.portPinned).toBe(true);
    expect(options.port).toBe(8770);
  });

  it("올바르지 않은 값은 기본으로 물러나고 고정으로 치지 않는다", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanups.push(() => logged.mockRestore());
    const options = readOptionsFromEnv({ PHOTOSHOP_MCP_PORT: "abc" });
    expect(options.portPinned).toBe(false);
    expect(options.port).toBe(DEFAULT_PORT);
  });

  it("범위 밖으로 고정하면 Plugin 이 못 찾는다고 알린다", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanups.push(() => logged.mockRestore());
    readOptionsFromEnv({ PHOTOSHOP_MCP_PORT: "9000" });
    expect(logged.mock.calls.flat().join("\n")).toMatch(/Plugin 이 찾는 범위.*밖/u);
  });

  it("범위 안으로 고정하면 경고하지 않는다", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    cleanups.push(() => logged.mockRestore());
    readOptionsFromEnv({ PHOTOSHOP_MCP_PORT: "8768" });
    expect(logged.mock.calls.flat().join("\n")).not.toMatch(/범위/u);
  });

  it("범위를 다 쓰고 있을 때의 안내는 범위를 말하고, 하나뿐일 때는 PHOTOSHOP_MCP_PORT 를 권한다", () => {
    const range = portConflictMessage(8765, 4242, 10);
    expect(range).toContain("8765~8774");
    expect(range).toContain("4242");
    expect(range).not.toContain("PHOTOSHOP_MCP_PORT");
    expect(portConflictMessage(8765, 4242)).toContain("PHOTOSHOP_MCP_PORT");
  });
});
