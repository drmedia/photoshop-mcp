import {
  DEFAULT_MOCK_LAYERS,
  ErrorCode,
  MockPhotoshopBridge,
  PhotoshopMcpError,
  ToolRegistry,
} from "@photoshop-mcp/photoshop-bridge";
import { CommandEngine, CommandRegistry } from "@photoshop-mcp/command-engine";
import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import { registerPhotoshopTools } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";
import { EXPECTED_COMMANDS, EXPECTED_TOOLS } from "./helpers/expected-tools.js";

function setup(): ReturnType<typeof createPhotoshopMcp> & { bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  const mcp = createPhotoshopMcp({ bridge });
  return { ...mcp, bridge };
}

const call = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  input: unknown = {},
): Promise<unknown> => mcp.tools.invoke(name, input, { requestId: "req-test" });

describe("Phase 1 Core Tools", () => {
  it("Tool 과 Command 를 등록 순서대로 노출한다", () => {
    const { tools, commands } = setup();

    expect(tools.list().map((tool) => tool.name)).toEqual([...EXPECTED_TOOLS]);
    expect(commands.list()).toEqual([...EXPECTED_COMMANDS]);
  });

  describe("photoshop.ping", () => {
    it("서버 상태와 Bridge 연결 여부를 반환한다", async () => {
      const mcp = setup();

      await expect(call(mcp, "photoshop.ping")).resolves.toEqual({
        status: "ok",
        server: "PhotoshopMCP",
        version: "0.1.0",
        bridgeConnected: true,
      });
    });

    it("Bridge 가 끊겨도 실패하지 않고 연결 상태를 보고한다", async () => {
      const mcp = setup();
      mcp.bridge.setConnected(false);

      await expect(call(mcp, "photoshop.ping")).resolves.toMatchObject({
        status: "ok",
        bridgeConnected: false,
      });
    });
  });

  describe("photoshop.document.get", () => {
    it("Mock 문서 정보를 반환한다", async () => {
      const mcp = setup();

      await expect(call(mcp, "photoshop.document.get")).resolves.toEqual({
        id: 1,
        name: "test.psd",
        width: 6048,
        height: 4024,
        bitDepth: 16,
        colorMode: "RGB",
      });
    });

    it("문서가 없으면 DOCUMENT_NOT_FOUND 를 전파한다", async () => {
      const mcp = setup();
      mcp.bridge.setDocument(null);

      await expect(call(mcp, "photoshop.document.get")).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND }),
      );
    });

    it("Bridge 오류 코드를 COMMAND_FAILED 로 덮어쓰지 않는다", async () => {
      const mcp = setup();
      mcp.bridge.failNextWith(
        new PhotoshopMcpError(ErrorCode.PHOTOSHOP_NOT_CONNECTED, "연결 없음", {
          recoverable: true,
        }),
      );

      try {
        await call(mcp, "photoshop.document.get");
        expect.unreachable("Bridge 오류가 전파되지 않았습니다");
      } catch (error) {
        const mcpError = error as PhotoshopMcpError;
        expect(mcpError.code).toBe(ErrorCode.PHOTOSHOP_NOT_CONNECTED);
        expect(mcpError.recoverable).toBe(true);
      }
    });
  });

  describe("photoshop.layer.list", () => {
    it("Mock 레이어 목록을 반환한다", async () => {
      const mcp = setup();

      await expect(call(mcp, "photoshop.layer.list")).resolves.toEqual({
        layers: DEFAULT_MOCK_LAYERS.map((layer) => ({ ...layer })),
      });
    });

    it("레이어가 없으면 빈 배열을 반환한다", async () => {
      const mcp = setup();
      mcp.bridge.setLayers([]);

      await expect(call(mcp, "photoshop.layer.list")).resolves.toEqual({ layers: [] });
    });

    it("Bridge 오류를 전파한다", async () => {
      const mcp = setup();
      mcp.bridge.setConnected(false);

      await expect(call(mcp, "photoshop.layer.list")).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED }),
      );
    });
  });

  it("Tool 은 Bridge 를 직접 호출하지 않고 Command Engine 을 거친다", async () => {
    // LAYER_LIST 핸들러를 대체한 엔진으로 Tool 을 구성한다.
    // Tool 이 Bridge 를 직접 호출한다면 Mock Bridge 의 레이어 3개가 나올 것이고,
    // Command Engine 을 거친다면 대체 핸들러의 결과가 나온다.
    const bridge = new MockPhotoshopBridge();
    const commands = new CommandRegistry();
    const dispatched: string[] = [];
    commands.register(
      "LAYER_LIST",
      async (command, context) => {
        dispatched.push(`${command.type}:${context.requestId}`);
        return [{ id: 99, name: "Stub", type: "pixel" as const, visible: true }];
      },
      { permission: "read" },
    );

    const engine = new CommandEngine({ registry: commands, bridge });
    const tools = new ToolRegistry();
    registerPhotoshopTools(tools, engine);

    await expect(
      tools.invoke("photoshop.layer.list", {}, { requestId: "req-trace" }),
    ).resolves.toEqual({ layers: [{ id: 99, name: "Stub", type: "pixel", visible: true }] });

    // Command 로 라우팅되었고, correlation ID 가 Tool → Command 로 그대로 전달되었다.
    expect(dispatched).toEqual(["LAYER_LIST:req-trace"]);
    // Mock Bridge 의 기본 레이어는 사용되지 않았다.
    expect(DEFAULT_MOCK_LAYERS).toHaveLength(3);
  });

  it("알 수 없는 Tool 은 TOOL_NOT_FOUND 를 던진다", async () => {
    const mcp = setup();

    await expect(call(mcp, "photoshop.nonexistent.tool")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.TOOL_NOT_FOUND }),
    );
  });
});

describe("검증 오류 메시지", () => {
  /**
   * 검증 실패는 **호출자가 고칠 수 있는 유일한 종류의 오류**다. 무엇이 왜 잘못됐는지
   * 말해주면 바로 고쳐 다시 부른다.
   *
   * 예전에는 전부 같은 문장이었다 — "Tool 입력이 올바르지 않습니다: <이름>".
   * bounds 를 빠뜨렸는지, 곡선 제어점 순서가 틀렸는지, 반지름이 범위를 넘었는지
   * 구분할 수 없었다. 정확한 설명은 details.issues 에 있었지만 호출자는 message 를
   * 먼저 읽는다. LLM 으로 테스트하다 세 가지 다른 실수가 똑같은 문장을 내는 것을
   * 보고 고쳤다.
   */
  function setup(): ReturnType<typeof createPhotoshopMcp> {
    return createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
  }

  const call = (mcp: ReturnType<typeof createPhotoshopMcp>, name: string, input: unknown) =>
    mcp.tools.invoke(name, input, { requestId: "req-validation" });

  it("무엇이 잘못됐는지 message 에 담는다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.selection.set", { shape: "rectangle" })).rejects.toThrow(
      /bounds/u,
    );
  });

  it("서로 다른 실수는 서로 다른 메시지를 낸다", async () => {
    const mcp = setup();
    const messages: string[] = [];
    for (const [name, input] of [
      ["photoshop.selection.set", { shape: "rectangle" }],
      ["photoshop.filter.gaussian_blur", { radius: 5000 }],
      ["photoshop.layer.set_opacity", { opacity: 500 }],
    ] as const) {
      try {
        await call(mcp, name, input);
        expect.unreachable(`${name} 이 거부되지 않았습니다`);
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(new Set(messages).size).toBe(3);
  });

  it("고쳐서 다시 부를 수 있는 오류로 표시한다", async () => {
    // recoverable: false 면 호출자가 포기한다. 입력만 바로잡으면 되는 오류다.
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.selection.set", { shape: "rectangle" }),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_PARAMETER, recoverable: true });
  });
});
