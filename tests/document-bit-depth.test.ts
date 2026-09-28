import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { DocumentBitDepthParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.document.bit_depth_convert`. (CORE_API §5 P2)
 *
 * **속성 대입이라 검증이 필수다.** `bitsPerChannel` 은 문자열 상수를 받고
 * 숫자를 대입하면 조용히 무시된다 — 이 프로젝트의 "조용한 실패" 네 번째 자리다.
 * (ROADMAP §39)
 */

function setup(
  allow: readonly string[] = ["read", "edit", "destructive"],
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

describe("document.bit_depth_convert", () => {
  it("**destructive 다** — 내리면 계조를 버린다", () => {
    expect(setup().tools.get("photoshop.document.bit_depth_convert")?.permission).toBe(
      "destructive",
    );
    expect(setup().commands.permissionOf("DOCUMENT_BIT_DEPTH_CONVERT")).toBe("destructive");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.document.bit_depth_convert", { depth: 8 }),
    ).rejects.toThrow();
  });

  it("**8 · 16 · 32 만 받는다**", () => {
    for (const depth of [8, 16, 32]) {
      expect(DocumentBitDepthParamsSchema.safeParse({ depth }).success).toBe(true);
    }
    /* 1비트는 Bitmap 색상 모드에서만 뜻이 있고 그 모드는 대화상자가 뜬다. */
    expect(DocumentBitDepthParamsSchema.safeParse({ depth: 1 }).success).toBe(false);
    expect(DocumentBitDepthParamsSchema.safeParse({ depth: 24 }).success).toBe(false);
  });

  it("**depth 는 필수다**", () => {
    expect(DocumentBitDepthParamsSchema.safeParse({}).success).toBe(false);
  });

  it("**바뀐 심도를 읽어서 답한다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.document.bit_depth_convert", { depth: 8 })) as {
      before: number | null;
      after: number | null;
      applied: boolean;
    };

    expect(result.before).toBe(16);
    expect(result.after).toBe(8);
    expect(result.applied).toBe(true);
  });

  it("**document.get 이 바뀐 심도를 그대로 보고한다**", async () => {
    /* 쓰고 나서 읽었을 때 다른 말이 나오면 둘 중 하나가 거짓말이다. */
    const mcp = setup();
    await invoke(mcp, "photoshop.document.bit_depth_convert", { depth: 8 });
    const got = (await invoke(mcp, "photoshop.document.get")) as { bitDepth: number };

    expect(got.bitDepth).toBe(8);
  });

  it("**이미 그 심도면 아무것도 하지 않는다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.document.bit_depth_convert", { depth: 16 })) as {
      before: number | null;
      after: number | null;
      applied: boolean;
    };

    expect(result.before).toBe(16);
    expect(result.after).toBe(16);
    expect(result.applied).toBe(true);
  });

  /**
   * **`document.create` 의 `bitDepth` 는 `documents.add` 가 무시한다.**
   * 실기에서 확인하고(ROADMAP §39) 만든 뒤 다시 걸도록 고쳤다. Mock 이 8 로
   * 고정돼 있으면 그 수정이 테스트에 나오지 않는다.
   */
  it("**document.create 가 요청한 심도를 준다**", async () => {
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.document.create", {
      width: 100,
      height: 100,
      bitDepth: 16,
    })) as { document: { bitDepth: number }; applied: Record<string, boolean> };

    expect(created.document.bitDepth).toBe(16);
    expect(created.applied["bitDepth"]).toBe(true);
  });

  it("**색상 모드와 다른 Tool 이다**", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.document.bit_depth_convert")).toBeDefined();
    expect(mcp.tools.get("photoshop.document.mode_convert")).toBeDefined();
  });
});
