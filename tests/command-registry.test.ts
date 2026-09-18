import { CommandRegistry, type CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

const noop: CommandHandler<Record<string, never>, null> = async () => null;

/** 이 파일은 등록·조회만 검증한다. Permission 판정은 permission.test.ts 가 다룬다. */
const READ = { permission: "read" } as const;

describe("CommandRegistry", () => {
  it("Command 를 등록하면 타입으로 조회하고 목록에 나타난다", () => {
    const registry = new CommandRegistry();
    registry.register("DOCUMENT_GET", noop, READ);

    expect(registry.has("DOCUMENT_GET")).toBe(true);
    expect(registry.get("DOCUMENT_GET")?.handler).toBe(noop);
    expect(registry.list()).toEqual(["DOCUMENT_GET"]);
    expect(registry.size).toBe(1);
  });

  it("여러 Command 를 등록 순서대로 유지한다", () => {
    const registry = new CommandRegistry();
    registry.register("PING", noop, READ);
    registry.register("DOCUMENT_GET", noop, READ);
    registry.register("LAYER_LIST", noop, READ);

    expect(registry.list()).toEqual(["PING", "DOCUMENT_GET", "LAYER_LIST"]);
  });

  it("같은 타입을 다시 등록하면 DUPLICATE_COMMAND 로 거부한다", () => {
    const registry = new CommandRegistry();
    registry.register("PING", noop, READ);

    try {
      registry.register("PING", noop, READ);
      expect.unreachable("중복 등록이 거부되지 않았습니다");
    } catch (error) {
      expect(error).toBeInstanceOf(PhotoshopMcpError);
      expect((error as PhotoshopMcpError).code).toBe(ErrorCode.DUPLICATE_COMMAND);
    }

    expect(registry.size).toBe(1);
  });

  it("빈 타입은 INVALID_PARAMETER 로 거부한다", () => {
    const registry = new CommandRegistry();
    try {
      registry.register("  ", noop, READ);
      expect.unreachable("빈 타입이 거부되지 않았습니다");
    } catch (error) {
      expect((error as PhotoshopMcpError).code).toBe(ErrorCode.INVALID_PARAMETER);
    }
  });

  it("등록되지 않은 타입 조회는 undefined 를 반환한다", () => {
    const registry = new CommandRegistry();
    expect(registry.get("LAYER_DUPLICATE")).toBeUndefined();
    expect(registry.has("LAYER_DUPLICATE")).toBe(false);
  });
});
