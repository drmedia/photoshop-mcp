import {
  ErrorCode,
  PhotoshopMcpError,
  ToolRegistry,
  type ToolDefinition,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { z } from "zod";

function makeTool(name: string, result: unknown = { ok: true }): ToolDefinition {
  return {
    name,
    description: `${name} 테스트용 Tool`,
    permission: "read",
    inputSchema: z.object({}).strict(),
    handler: async () => result,
  };
}

describe("ToolRegistry", () => {
  it("Tool 을 등록하면 이름으로 조회하고 목록에 나타난다", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("photoshop.ping"));

    expect(registry.has("photoshop.ping")).toBe(true);
    expect(registry.get("photoshop.ping")?.description).toBe("photoshop.ping 테스트용 Tool");
    expect(registry.list().map((tool) => tool.name)).toEqual(["photoshop.ping"]);
    expect(registry.size).toBe(1);
  });

  it("등록 순서를 유지한다", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("photoshop.ping"));
    registry.register(makeTool("photoshop.document.get"));
    registry.register(makeTool("photoshop.layer.list"));

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "photoshop.ping",
      "photoshop.document.get",
      "photoshop.layer.list",
    ]);
  });

  it("같은 이름을 다시 등록하면 DUPLICATE_TOOL 로 거부한다", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("photoshop.ping"));

    expect(() => registry.register(makeTool("photoshop.ping"))).toThrowError(PhotoshopMcpError);
    try {
      registry.register(makeTool("photoshop.ping"));
      expect.unreachable("중복 등록이 거부되지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoshopMcpError);
      expect((error as PhotoshopMcpError).code).toBe(ErrorCode.DUPLICATE_TOOL);
    }

    // 거부된 뒤에도 기존 등록이 유지된다.
    expect(registry.size).toBe(1);
  });

  it("빈 이름은 INVALID_PARAMETER 로 거부한다", () => {
    const registry = new ToolRegistry();
    try {
      registry.register(makeTool("   "));
      expect.unreachable("빈 이름이 거부되지 않았습니다");
    } catch (error) {
      expect((error as PhotoshopMcpError).code).toBe(ErrorCode.INVALID_PARAMETER);
    }
  });

  it("등록되지 않은 Tool 을 호출하면 TOOL_NOT_FOUND 를 던진다", async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke("photoshop.unknown", {}, { requestId: "req-1" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.TOOL_NOT_FOUND }),
    );
  });

  it("입력 스키마를 만족하지 않으면 INVALID_PARAMETER 를 던진다", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "photoshop.test",
      description: "입력 검증 테스트",
      permission: "read",
      inputSchema: z.object({ count: z.number().int().positive() }).strict(),
      handler: async (input) => input,
    });

    await expect(
      registry.invoke("photoshop.test", { count: -1 }, { requestId: "req-1" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("검증을 통과한 입력과 컨텍스트를 핸들러에 전달한다", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "photoshop.test",
      description: "핸들러 전달 테스트",
      permission: "read",
      inputSchema: z.object({ count: z.number() }).strict(),
      handler: async (input, context) => ({ ...input, requestId: context.requestId }),
    });

    await expect(
      registry.invoke("photoshop.test", { count: 7 }, { requestId: "req-42" }),
    ).resolves.toEqual({ count: 7, requestId: "req-42" });
  });
});
