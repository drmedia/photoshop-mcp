import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import {
  DocumentDuplicateParamsSchema,
  DocumentDuplicateResultSchema,
} from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.document.duplicate`. (CORE_API §5 P2)
 *
 * **되돌릴 수 없는 작업 앞의 안전망이다.** `image.resize` · `flatten` ·
 * `mask.apply` 를 복제본에서 하면 원본이 남는다. (ROADMAP §35)
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"] as never),
  });
}

const invoke = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke(name, args, { requestId: "r" })) as Record<string, unknown>;

describe("document.duplicate", () => {
  it("**edit 다** — 파일을 만들지 않는다", () => {
    expect(setup().tools.get("photoshop.document.duplicate")?.permission).toBe("edit");
    expect(setup().commands.permissionOf("DOCUMENT_DUPLICATE")).toBe("edit");
  });

  /**
   * **Mock 은 할 수 없는 것을 한 척하지 않는다.** 문서를 하나만 들고 있어
   * 진짜 복제본을 만들 수 없는데, 그럴듯한 값을 돌려주면 이 Command 가
   * 막으려는 바로 그 사고가 난다 — 원본을 복제본으로 알고 되돌릴 수 없는
   * 작업을 건다. `document.open` 과 같은 규칙이다.
   */
  it("**Mock 은 복제하지 않고 실패한다**", async () => {
    await expect(invoke(setup(), "photoshop.document.duplicate")).rejects.toThrow(
      /실제 Photoshop 연결이 필요합니다/,
    );
  });

  it("**경로 구분자가 든 이름은 거절한다**", () => {
    /* 파일을 만들지 않지만 이 이름이 나중에 save_as 로 넘어간다.
     * 작업 폴더 승인과 같은 규칙을 지킨다. */
    expect(DocumentDuplicateParamsSchema.safeParse({ name: "a/b" }).success).toBe(false);
    expect(DocumentDuplicateParamsSchema.safeParse({ name: "a\\b" }).success).toBe(false);
    expect(DocumentDuplicateParamsSchema.safeParse({ name: "사본" }).success).toBe(true);
  });

  it("**모르는 파라미터는 거절한다**", () => {
    expect(DocumentDuplicateParamsSchema.safeParse({ flatten: true }).success).toBe(false);
  });

  it("**인자 없이 부를 수 있다**", () => {
    expect(DocumentDuplicateParamsSchema.safeParse({}).success).toBe(true);
  });

  /**
   * **읽지 못한 것은 `null` 이다.** `layers` 를 0 으로, `activeDocumentId` 를
   * 복제본 id 로 채우면 틀린 사실을 말하게 된다.
   */
  it("**activeDocumentId 와 layers 는 null 을 허용한다**", () => {
    const parsed = DocumentDuplicateResultSchema.safeParse({
      document: { id: 2, name: "사본", width: 10, height: 10, bitDepth: 8, colorMode: "RGB" },
      activeDocumentId: null,
      layers: null,
      openDocuments: 2,
    });

    expect(parsed.success).toBe(true);
  });
});
