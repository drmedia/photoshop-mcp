import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { PreferencesGetParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 앱 설정과 색. (ROADMAP §61)
 *
 * **전부 DOM 이다** — `app.preferences`(24.0+) · `app.foregroundColor` ·
 * `app.backgroundColor`.
 *
 * **Mock 은 Photoshop 앱 상태를 모른다.** 환경 설정도 전경색도 실행 중인
 * Photoshop 에만 있어 전부 `null` 이다 — 계약이 "모르면 null" 이라고 정해
 * 두었으므로 지어내지 않는다.
 */

function setup(allow: string[] = ["read"]): ReturnType<typeof createPhotoshopMcp> {
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

describe("preferences · color", () => {
  /** 둘 다 읽기만 한다 — 읽기 전용 서버에서도 돌아야 한다. */
  it("**둘 다 read 다**", async () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("PREFERENCES_GET")).toBe("read");
    expect(mcp.commands.permissionOf("COLOR_GET_FOREGROUND_BACKGROUND")).toBe("read");
    await expect(invoke(mcp, "photoshop.preferences.get")).resolves.toBeTruthy();
    await expect(invoke(mcp, "photoshop.color.get_foreground_background")).resolves.toBeTruthy();
  });

  it("**열두 범주를 준다**", async () => {
    const result = (await invoke(setup(), "photoshop.preferences.get")) as {
      categories: Record<string, unknown>;
    };
    expect(Object.keys(result.categories)).toEqual([
      "cursors",
      "fileHandling",
      "general",
      "guidesGridsAndSlices",
      "history",
      "interface",
      "notifications",
      "performance",
      "tools",
      "transparencyAndGamut",
      "type",
      "unitsAndRulers",
    ]);
  });

  it("**범주 하나만 고를 수 있다**", async () => {
    const result = (await invoke(setup(), "photoshop.preferences.get", {
      category: "unitsAndRulers",
    })) as { categories: Record<string, unknown> };
    expect(Object.keys(result.categories)).toEqual(["unitsAndRulers"]);
  });

  it("**모르는 범주는 거절한다**", () => {
    expect(PreferencesGetParamsSchema.safeParse({ category: "colors" }).success).toBe(false);
    expect(PreferencesGetParamsSchema.safeParse({ category: "general" }).success).toBe(true);
    expect(PreferencesGetParamsSchema.safeParse({}).success).toBe(true);
  });

  /**
   * **지어내지 않는다.** 환경 설정과 색은 실행 중인 Photoshop 에만 있다 —
   * 그럴듯한 값을 넣으면 워크플로가 오지 않은 결과를 믿는다.
   */
  it("**Mock 은 값을 지어내지 않는다**", async () => {
    const mcp = setup();
    const prefs = (await invoke(mcp, "photoshop.preferences.get")) as {
      categories: Record<string, unknown>;
    };
    expect(Object.values(prefs.categories).every((value) => value === null)).toBe(true);

    const color = (await invoke(mcp, "photoshop.color.get_foreground_background")) as {
      foreground: { red: unknown; hex: unknown };
      background: { red: unknown };
    };
    expect(color.foreground.red).toBeNull();
    expect(color.foreground.hex).toBeNull();
    expect(color.background.red).toBeNull();
  });

  /**
   * **바꾸는 Tool 을 만들지 않았다.** 환경 설정과 전경색은 사용자가 Photoshop
   * UI 에서 쓰는 상태다 — LLM 이 말없이 바꾸면 이후 사용자의 모든 작업이
   * 달라진다. 색을 정해 칠하려면 색을 인자로 받는 Tool 을 쓴다.
   */
  it("**바꾸는 Tool 은 없다**", () => {
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    expect(names).not.toContain("photoshop.preferences.set");
    expect(names).not.toContain("photoshop.color.set_foreground_background");
    /* 색을 인자로 받는 쪽은 있다. */
    expect(names).toContain("photoshop.paint.dab");
    expect(names).toContain("photoshop.path.fill");
  });
});
