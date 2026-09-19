import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, isCapturedImage } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 화면 캡처. (ROADMAP §17.10)
 *
 * 호출자가 **자기 편집 결과를 볼 수** 있어야 한다. 이것이 없어서 보정 열 단계를
 * 다 쌓은 뒤에야 하늘이 보라색이 된 것을 발견한 적이 있다.
 *
 * 가장 중요한 성질은 결과가 **MCP image content block 으로 나간다**는 것이다.
 * base64 를 텍스트 JSON 에 담아 보내면 LLM 은 그것을 볼 수 없고 토큰만 먹는다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> & { bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  return { ...createPhotoshopMcp({ bridge, logger: createSilentLogger() }), bridge };
}

async function connect(
  core: ReturnType<typeof createPhotoshopMcp>,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "capture-test", version: "0.0.0" });
  await Promise.all([core.server.start(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await core.server.stop();
    },
  };
}

describe("캡처", () => {
  it("읽기 전용이다", () => {
    // 문서를 바꾸지 않고 파일도 쓰지 않는다. export 와 달리 external 이 필요 없다.
    const { tools } = setup();
    for (const name of [
      "photoshop.document.capture",
      "photoshop.layer.capture",
      "photoshop.selection.capture",
    ]) {
      expect(tools.get(name)?.permission, name).toBe("read");
    }
  });

  it("결과를 이미지로 알아본다", async () => {
    const mcp = setup();
    const result = await mcp.tools.invoke("photoshop.document.capture", {}, { requestId: "r" });
    expect(isCapturedImage(result)).toBe(true);
  });

  it("MCP 로는 image content block 으로 나간다", async () => {
    // 이것이 핵심이다. 텍스트로 나가면 LLM 이 볼 수 없다.
    const mcp = setup();
    const { client, close } = await connect(mcp);
    try {
      const result = await client.callTool({
        name: "photoshop.document.capture",
        arguments: {},
      });
      const content = result.content as { type: string; mimeType?: string; data?: string }[];
      const image = content.find((entry) => entry.type === "image");
      expect(image?.mimeType).toMatch(/^image\//u);
      expect(image?.data).toBeTruthy();

      // 크기 정보는 텍스트로 함께 준다 — 이미지 블록만으로는 몇 픽셀인지 알 수 없다.
      const text = content.find((entry) => entry.type === "text");
      expect(text).toBeDefined();
    } finally {
      await close();
    }
  });

  it("선택이 없으면 선택 캡처는 실패한다", async () => {
    const mcp = setup();
    await expect(
      mcp.tools.invoke("photoshop.selection.capture", {}, { requestId: "r" }),
    ).rejects.toThrow(/선택 영역/u);
  });

  it("longEdge 범위를 강제한다", async () => {
    // 원본 해상도를 받을 이유가 없다. 크면 토큰만 먹는다.
    const mcp = setup();
    for (const longEdge of [32, 4096]) {
      await expect(
        mcp.tools.invoke("photoshop.document.capture", { longEdge }, { requestId: "r" }),
      ).rejects.toThrow(/longEdge/u);
    }
  });
});
