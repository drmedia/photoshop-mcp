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
  it("Phase 1 Tool 과 Command 만 등록한다", () => {
    const { tools, commands } = setup();

    expect(tools.list().map((tool) => tool.name)).toEqual([
      "photoshop.ping",
      "photoshop.document.get",
      "photoshop.layer.list",
    ]);
    expect(commands.list()).toEqual(["PING", "DOCUMENT_GET", "LAYER_LIST"]);
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
        layers: [
          { id: 10, name: "Background", type: "pixel", visible: true },
          { id: 11, name: "Curves 1", type: "adjustment", visible: true },
          { id: 12, name: "Retouch", type: "pixel", visible: false },
        ],
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
    commands.register("LAYER_LIST", async (command, context) => {
      dispatched.push(`${command.type}:${context.requestId}`);
      return [{ id: 99, name: "Stub", type: "pixel" as const, visible: true }];
    });

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

    await expect(call(mcp, "photoshop.layer.duplicate")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.TOOL_NOT_FOUND }),
    );
  });
});
