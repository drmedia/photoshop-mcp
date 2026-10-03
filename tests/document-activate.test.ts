import { readFileSync } from "node:fs";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.document.activate` · `photoshop.document.compare_with`. (ROADMAP §101)
 *
 * Mock 은 문서를 하나만 든다 — 다문서 동작은 실기에서만 확인한다. 여기서는 **스키마 · 권한 ·
 * 거절 경로**와 Mock 이 둘째 문서를 지어내지 않는 것을 고정한다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"] as never),
  });
}

const invoke = async (
  mcp: Mcp,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

describe("document.activate", () => {
  it("권한은 edit 다", () => {
    expect(setup().tools.get("photoshop.document.activate")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("DOCUMENT_ACTIVATE")).toBe("edit");
  });

  it("documentId 와 name 중 정확히 하나만 받는다", async () => {
    const mcp = setup();
    await expect(invoke(mcp, "photoshop.document.activate", {})).rejects.toThrow();
    await expect(
      invoke(mcp, "photoshop.document.activate", { documentId: 1, name: "a" }),
    ).rejects.toThrow();
  });

  it("이미 활성인 문서는 changed:false 로 답한다", async () => {
    const mcp = setup();
    const current = (await invoke(mcp, "photoshop.document.get")) as { id: number };
    const result = await invoke(mcp, "photoshop.document.activate", { documentId: current.id });
    expect(result["changed"]).toBe(false);
    expect(result["method"]).toBe("already");
    expect((result["document"] as { id: number }).id).toBe(current.id);
  });

  it("열려 있지 않은 문서는 거절한다 — 열린 목록을 알려 준다", async () => {
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.document.activate", { documentId: 999999 }),
    ).rejects.toThrow(/열려 있지 않습니다/u);
  });
});

describe("document.compare_with", () => {
  it("권한은 read 다", () => {
    expect(setup().tools.get("photoshop.document.compare_with")?.permission).toBe("read");
  });

  it("활성 문서 자신과는 견주지 않는다", async () => {
    const mcp = setup();
    const current = (await invoke(mcp, "photoshop.document.get")) as { id: number };
    await expect(
      invoke(mcp, "photoshop.document.compare_with", { documentId: current.id }),
    ).rejects.toThrow(/document\.compare/u);
  });

  it("Mock 은 둘째 문서를 지어내지 않는다", async () => {
    await expect(
      invoke(setup(), "photoshop.document.compare_with", { documentId: 999999 }),
    ).rejects.toThrow(/열려 있지 않습니다/u);
  });
});

describe("생성 레이어 추적 목록", () => {
  /** 플러그인(`photoshop` 을 import 해 테스트에서 못 부른다)과 Mock 의 목록이 같아야 한다. */
  const names = (source: string, anchor: RegExp): string[] => {
    const block = anchor.exec(source)?.[1] ?? "";
    return [...block.matchAll(/"([A-Z_]+)"/gu)].map((match) => match[1] as string).sort();
  };

  it("플러그인과 Mock 이 같은 Command 를 추적한다", () => {
    const plugin = readFileSync("photoshop-uxp/src/dom/created-layers.ts", "utf8");
    const mock = readFileSync("packages/photoshop-bridge/src/mock-bridge.ts", "utf8");
    const fromPlugin = names(
      plugin,
      /LAYER_CREATING_COMMANDS: readonly string\[\] = \[([\s\S]*?)\];/u,
    );
    const fromMock = names(
      mock,
      /MOCK_LAYER_CREATING_COMMANDS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/u,
    );
    expect(fromPlugin.length).toBeGreaterThan(10);
    expect(fromMock).toEqual(fromPlugin);
  });
});
