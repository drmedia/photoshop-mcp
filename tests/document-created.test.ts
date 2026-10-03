import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.document.list_created` · `close_created`. (ROADMAP §101)
 *
 * Mock 은 문서를 하나만 들고 만든 문서를 열어 두지 않는다 — 실제로 닫히는 것은 실기에서 확인한다.
 * 여기서는 권한 · 스키마 · 사용자 문서를 건드리지 않는 것을 고정한다.
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

describe("세션 생성 문서", () => {
  it("권한: list 는 read, close 는 edit — destructive 가 아니다", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.document.list_created")?.permission).toBe("read");
    expect(mcp.tools.get("photoshop.document.close_created")?.permission).toBe("edit");
  });

  it("discardChanges: true 를 명시해야 한다 — 기본값이 없다", async () => {
    const mcp = setup();
    await expect(invoke(mcp, "photoshop.document.close_created", {})).rejects.toThrow();
    await expect(
      invoke(mcp, "photoshop.document.close_created", { discardChanges: false }),
    ).rejects.toThrow();
  });

  it("사용자의 문서는 id 를 줘도 닫지 않고 notCreated 로 알린다", async () => {
    const mcp = setup();
    const current = (await invoke(mcp, "photoshop.document.get")) as { id: number };
    const result = await invoke(mcp, "photoshop.document.close_created", {
      documentIds: [current.id],
      discardChanges: true,
    });
    expect(result["closed"]).toEqual([]);
    expect(result["notCreated"]).toEqual([current.id]);
    // 문서는 그대로 열려 있다.
    expect(
      ((await invoke(mcp, "photoshop.document.list")) as { documents: unknown[] }).documents,
    ).toHaveLength(1);
  });

  it("만든 문서가 없으면 목록이 비어 있다", async () => {
    const result = await invoke(setup(), "photoshop.document.list_created");
    expect(result["documents"]).toEqual([]);
  });
});
