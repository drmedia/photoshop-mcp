import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 보정 절차 안내. (ROADMAP §92)
 *
 * 사용자는 "이 사진 보정해줘" 처럼 짧게 말한다. 절차는 서버가 `instructions` 와 `retouch`
 * 프롬프트로 건넨다. 실제 MCP 클라이언트로 확인한다 — 서버 내부를 부르면 클라이언트가
 * 받는 모양(initialize 응답 · prompts/get)을 놓친다.
 */

let close: (() => Promise<void>) | undefined;

afterEach(async () => {
  await close?.();
  close = undefined;
});

async function connect(): Promise<Client> {
  const mcp = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "guidance-test", version: "0.0.0" });
  await mcp.server.start(serverTransport);
  await client.connect(clientTransport);
  close = async () => {
    await client.close();
    await mcp.server.stop();
  };
  return client;
}

describe("instructions", () => {
  it("initialize 응답에 실린다 — 클라이언트가 세션 맥락에 넣는다", async () => {
    const client = await connect();
    const text = client.getInstructions() ?? "";
    expect(text).toMatch(/읽기.*분석.*계획.*적용.*재분석|1\) 읽기[\s\S]*5\) 재분석/u);
  });

  it("이 프로젝트에서 틀렸던 것을 담는다", async () => {
    const text = (await connect()).getInstructions() ?? "";
    expect(text).toMatch(/스마트 필터는 덮어쓰이지 않고 쌓인다/u);
    expect(text).toMatch(/document\.compare/u);
    expect(text).toMatch(/승인받은 뒤 적용/u);
    expect(text).toMatch(/mask\.create 의 from/u);
  });

  it("지침에 나온 Tool 이름이 모두 실제로 등록돼 있다 — 없는 이름을 안내하지 않는다", async () => {
    const client = await connect();
    const names = new Set((await client.listTools()).tools.map((tool) => tool.name));
    const text = (await client.getInstructions()) ?? "";
    const prompt = await client.getPrompt({ name: "retouch" });
    const body = prompt.messages
      .map((m) => (m.content.type === "text" ? m.content.text : ""))
      .join("\n");
    const mentioned = new Set(
      [
        ...`${text}\n${body}`.matchAll(
          /\b((?:photoshop\.)?(?:layer|smart_object|metadata|document|mask|history|camera_raw)\.[a-z_]+)\b/gu,
        ),
      ].map((match) => (match[1] as string).replace(/^(?!photoshop\.)/u, "photoshop.")),
    );
    expect(mentioned.size).toBeGreaterThan(5);
    for (const name of mentioned) {
      expect(names.has(name), `${name} 은 등록된 Tool 이 아니다`).toBe(true);
    }
  });

  it("짧다 — 매 세션 토큰을 먹는다", async () => {
    const text = (await connect()).getInstructions() ?? "";
    expect(text.length).toBeLessThan(1200);
  });
});

describe("prompts", () => {
  it("retouch 하나를 낸다", async () => {
    const { prompts } = await (await connect()).listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["retouch"]);
    expect(prompts[0]?.arguments?.[0]).toMatchObject({ name: "goal", required: false });
  });

  it("goal 이 없어도 되고, 있으면 요청에 들어간다", async () => {
    const client = await connect();
    const bare = await client.getPrompt({ name: "retouch" });
    const first = bare.messages[0]?.content;
    expect(first?.type === "text" ? first.text : "").toMatch(/무엇을 고칠지는 분석 결과로/u);

    const withGoal = await client.getPrompt({
      name: "retouch",
      arguments: { goal: "은하수를 살린다" },
    });
    const text = withGoal.messages[0]?.content;
    expect(text?.type === "text" ? text.text : "").toMatch(/목표: 은하수를 살린다/u);
  });

  it("다섯 단계가 순서대로 있고 계획에서 승인을 기다린다", async () => {
    const prompt = await (await connect()).getPrompt({ name: "retouch" });
    const content = prompt.messages[0]?.content;
    const text = content?.type === "text" ? content.text : "";
    const order = ["## 1. 읽기", "## 2. 분석", "## 3. 계획", "## 4. 적용", "## 5. 재분석"].map(
      (heading) => text.indexOf(heading),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toMatch(/승인하기 전에는 4단계로 넘어가지 않는다/u);
  });

  it("모르는 프롬프트는 거절한다", async () => {
    await expect((await connect()).getPrompt({ name: "nope" })).rejects.toThrow(
      /알 수 없는 프롬프트/u,
    );
  });
});
