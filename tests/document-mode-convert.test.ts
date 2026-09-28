import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { DocumentModeConvertParamsSchema } from "@photoshop-mcp/photoshop-tools";

/**
 * `photoshop.document.mode_convert`. (CORE_API §5 P2)
 *
 * **되돌릴 수 없다.** grayscale 은 색을 영영 버리고 cmyk 는 색역 밖을 잘라낸다.
 * `ChangeMode` 일곱 중 넷만 연다 — 나머지는 대화상자 위험이다. (ROADMAP §38)
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

describe("document.mode_convert", () => {
  it("**destructive 다** — 색을 버린다", () => {
    expect(setup().tools.get("photoshop.document.mode_convert")?.permission).toBe("destructive");
    expect(setup().commands.permissionOf("DOCUMENT_MODE_CONVERT")).toBe("destructive");
  });

  it("**기본 허용에서는 막힌다**", async () => {
    await expect(
      invoke(setup(["read", "edit"]), "photoshop.document.mode_convert", { mode: "grayscale" }),
    ).rejects.toThrow();
  });

  /**
   * **대화상자가 뜨는 모드는 열지 않았다.** 뜨면 플러그인이 멈추고 Bridge 가
   * 15초에 타임아웃한다 — 이 프로젝트에서 네 번 반복된 실패 유형이다.
   */
  it("**bitmap · indexedColor · multichannel 은 받지 않는다**", () => {
    expect(DocumentModeConvertParamsSchema.safeParse({ mode: "bitmap" }).success).toBe(false);
    expect(DocumentModeConvertParamsSchema.safeParse({ mode: "indexedColor" }).success).toBe(false);
    expect(DocumentModeConvertParamsSchema.safeParse({ mode: "multichannel" }).success).toBe(false);
  });

  it("**넷은 받는다**", () => {
    for (const mode of ["rgb", "grayscale", "cmyk", "lab"]) {
      expect(DocumentModeConvertParamsSchema.safeParse({ mode }).success).toBe(true);
    }
  });

  it("**mode 는 필수다**", () => {
    expect(DocumentModeConvertParamsSchema.safeParse({}).success).toBe(false);
  });

  it("**바뀐 모드를 읽어서 답한다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.document.mode_convert", {
      mode: "grayscale",
    })) as { before: { mode: string }; after: { mode: string }; applied: boolean };

    expect(result.before.mode).toBe("RGB");
    expect(result.after.mode).toBe("Grayscale");
    expect(result.applied).toBe(true);
  });

  /**
   * **이미 그 모드면 아무것도 하지 않는다.** 같은 모드로 다시 걸면 얻는 것
   * 없이 평탄화만 될 수 있다.
   */
  it("**같은 모드로 부르면 레이어를 잃지 않는다**", async () => {
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] };
    const result = (await invoke(mcp, "photoshop.document.mode_convert", { mode: "rgb" })) as {
      layersDiscarded: number;
      applied: boolean;
    };
    const after = (await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] };

    expect(result.applied).toBe(true);
    expect(result.layersDiscarded).toBe(0);
    expect(after.layers.length).toBe(before.layers.length);
  });
});
