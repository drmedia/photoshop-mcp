import { CommandEngine, CommandRegistry } from "@photoshop-mcp/command-engine";
import type { PhotoshopCommand } from "@photoshop-mcp/photoshop-bridge";
import { ErrorCode, MockPhotoshopBridge, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/** 이 파일은 실행 흐름만 검증한다. Permission 판정은 permission.test.ts 가 다룬다. */
const EDIT = { permission: "edit" } as const;

function createEngine(): { engine: CommandEngine; bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  const engine = new CommandEngine({ registry: new CommandRegistry(), bridge });
  return { engine, bridge };
}

describe("CommandEngine", () => {
  it("등록된 Command 를 실행하고 결과를 반환한다", async () => {
    const { engine } = createEngine();
    engine.register(
      "ECHO",
      async (command: PhotoshopCommand<{ value: number }>) => ({
        echoed: command.params.value,
      }),
      EDIT,
    );

    await expect(engine.execute({ type: "ECHO", params: { value: 3 } })).resolves.toEqual({
      echoed: 3,
    });
  });

  it("핸들러에 Bridge 와 correlation ID 를 전달한다", async () => {
    const { engine, bridge } = createEngine();
    engine.register(
      "CONTEXT",
      async (_command, context) => ({
        sameBridge: context.bridge === bridge,
        requestId: context.requestId,
      }),
      EDIT,
    );

    await expect(
      engine.execute({ type: "CONTEXT", params: {} }, { requestId: "req-abc" }),
    ).resolves.toEqual({ sameBridge: true, requestId: "req-abc" });
  });

  it("requestId 를 주지 않으면 순번 ID 를 생성한다", async () => {
    const { engine } = createEngine();
    engine.register("CONTEXT", async (_command, context) => context.requestId, EDIT);

    await expect(engine.execute({ type: "CONTEXT", params: {} })).resolves.toBe("req-1");
    await expect(engine.execute({ type: "CONTEXT", params: {} })).resolves.toBe("req-2");
  });

  it("등록되지 않은 Command 는 COMMAND_NOT_SUPPORTED 를 던진다", async () => {
    const { engine } = createEngine();
    engine.register("PING", async () => null, EDIT);

    try {
      await engine.execute({ type: "LAYER_DUPLICATE", params: {} });
      expect.unreachable("알 수 없는 Command 가 거부되지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoshopMcpError);
      const mcpError = error as PhotoshopMcpError;
      expect(mcpError.code).toBe(ErrorCode.COMMAND_NOT_SUPPORTED);
      expect(mcpError.details).toEqual({ type: "LAYER_DUPLICATE", registered: ["PING"] });
    }
  });

  it("Command.type 이 비어 있으면 INVALID_PARAMETER 를 던진다", async () => {
    const { engine } = createEngine();

    await expect(engine.execute({ type: "", params: {} })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("Bridge 오류를 코드 그대로 전파한다", async () => {
    const { engine, bridge } = createEngine();
    engine.register(
      "DOCUMENT_GET",
      async (_command, context) => context.bridge.getDocumentInfo(),
      EDIT,
    );
    bridge.setConnected(false);

    await expect(engine.execute({ type: "DOCUMENT_GET", params: {} })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PHOTOSHOP_NOT_CONNECTED }),
    );
  });

  it("PhotoshopMcpError 가 아닌 예외는 COMMAND_FAILED 로 정규화한다", async () => {
    const { engine } = createEngine();
    engine.register(
      "BOOM",
      async () => {
        throw new TypeError("예상치 못한 실패");
      },
      EDIT,
    );

    try {
      await engine.execute({ type: "BOOM", params: {} });
      expect.unreachable("예외가 전파되지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoshopMcpError);
      const mcpError = error as PhotoshopMcpError;
      expect(mcpError.code).toBe(ErrorCode.COMMAND_FAILED);
      expect(mcpError.message).toBe("예상치 못한 실패");
      expect(mcpError.cause).toBeInstanceOf(TypeError);
    }
  });
});
