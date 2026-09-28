import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { DocumentPasteParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.document.paste`. (CORE_API §5)
 *
 * **이 서버에서 성격이 다른 Tool 이다.** 나머지는 문서 안에서 끝나는데 이것은
 * 사용자의 클립보드를 문서로 끌어들인다 — 들어온 것은 `document.capture` 로
 * 읽을 수 있으므로 **클립보드를 LLM 이 볼 수 있게 만드는 통로**다. (ROADMAP §41)
 */

function setup(
  allow: readonly string[] = ["read", "edit", "external"],
): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

describe("document.paste", () => {
  /**
   * **`external` 이다.** 문서 밖에서 데이터가 들어오고 그 데이터는 사용자의
   * 것이다. `layer.place` 와 같은 등급이지만 **폴더 승인조차 없다.**
   */
  it("**external 이다** — 클립보드는 문서 밖이다", () => {
    expect(setup().tools.get("photoshop.document.paste")?.permission).toBe("external");
    expect(setup().commands.permissionOf("DOCUMENT_PASTE")).toBe("external");
    // 같은 등급의 이웃: 파일을 문서로 들여온다.
    expect(setup().commands.permissionOf("LAYER_PLACE")).toBe("external");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(invoke(setup(["read", "edit"]), "photoshop.document.paste")).rejects.toThrow();
  });

  /**
   * **Mock 은 오지 않은 내용이 왔다고 하지 않는다.** 클립보드가 없는데
   * 그럴듯한 레이어를 만들면 워크플로가 내용이 들어왔다고 믿는다 —
   * `DOCUMENT_OPEN` · `DOCUMENT_DUPLICATE` 와 같은 규칙이다.
   */
  it("**Mock 은 붙여 넣지 않고 실패한다**", async () => {
    await expect(invoke(setup(), "photoshop.document.paste")).rejects.toThrow(
      /실제 Photoshop 연결이 필요합니다/,
    );
  });

  it("**인자 없이 부를 수 있다**", () => {
    expect(DocumentPasteParamsSchema.safeParse({}).success).toBe(true);
    expect(DocumentPasteParamsSchema.safeParse({ intoSelection: true }).success).toBe(true);
  });

  it("**모르는 파라미터는 거절한다**", () => {
    /* 붙여 넣을 위치나 내용을 지정하는 통로를 만들지 않는다. */
    expect(DocumentPasteParamsSchema.safeParse({ x: 10, y: 10 }).success).toBe(false);
    expect(DocumentPasteParamsSchema.safeParse({ asSmartObject: true }).success).toBe(false);
  });

  it("**복사하는 Tool 은 없다**", () => {
    /* UXP 에 클립보드 쓰기 API 가 없다. 클립보드를 채우는 것은 언제나
     * 사용자이고, 그래서 이 Tool 은 사용자가 준 것만 가져온다. */
    const mcp = setup();
    const names = mcp.tools.list().map((tool) => tool.name);
    expect(names.filter((name) => name.includes("copy"))).toEqual([]);
    expect(names.filter((name) => name.includes("clipboard"))).toEqual([]);
  });
});
