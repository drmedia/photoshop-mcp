import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { ColorSetParamsSchema, PreferencesGetParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 앱 설정과 색. (ROADMAP §61)
 *
 * **전부 DOM 이다** — `app.preferences`(24.0+) · `app.foregroundColor` ·
 * `app.backgroundColor`.
 *
 * **Mock 은 Photoshop 앱 상태를 모른다.** 환경 설정도 전경색도 실행 중인
 * Photoshop 에만 있어 전부 `null` 이다 — 계약이 "모르면 null" 이라고 정해
 * 두었으므로 지어내지 않는다. 다만 §62 로 **넣어 준 색은 안다** — 그것은
 * 짐작이 아니라 이 세션에서 실제로 일어난 일이다.
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
   * **환경 설정은 여전히 읽기만 한다.** 색과 갈리는 자리다 — 색은 바꾼 뒤
   * `previous` 로 되돌릴 수 있지만, 환경 설정은 무엇을 바꿨는지 호출자가
   * 추적하기 어렵고 범위가 Photoshop 전체다.
   */
  it("**환경 설정을 바꾸는 Tool 은 없다**", () => {
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    expect(names).not.toContain("photoshop.preferences.set");
    /* 색을 인자로 받는 쪽은 그대로 있다. */
    expect(names).toContain("photoshop.paint.dab");
    expect(names).toContain("photoshop.path.fill");
  });
});

/** ROADMAP 62 — 전경색·배경색 바꾸기. */
describe("color.set_foreground · set_background", () => {
  it("**둘 다 edit 다**", () => {
    const mcp = setup(["read", "edit"]);
    expect(mcp.commands.permissionOf("COLOR_SET_FOREGROUND")).toBe("edit");
    expect(mcp.commands.permissionOf("COLOR_SET_BACKGROUND")).toBe("edit");
  });

  /**
   * **되돌릴 수 있어야 만든 것이다.** `previous` 가 없으면 사용자가 UI 에서
   * 쓰던 색이 조용히 사라진다.
   */
  it("**previous 로 원상복구된다**", async () => {
    const mcp = setup(["read", "edit"]);
    await invoke(mcp, "photoshop.color.set_foreground", { red: 10, green: 20, blue: 30 });
    const second = (await invoke(mcp, "photoshop.color.set_foreground", {
      red: 220,
      green: 40,
      blue: 90,
    })) as {
      previous: Record<string, unknown>;
      current: Record<string, unknown>;
      applied: boolean;
    };

    expect(second.previous).toEqual({ red: 10, green: 20, blue: 30, hex: "#0A141E" });
    expect(second.current).toEqual({ red: 220, green: 40, blue: 90, hex: "#DC285A" });
    expect(second.applied).toBe(true);

    /* **되돌릴 때 previous 를 통째로 넘기지 않는다** — `hex` 가 함께 들어 있고
     * 스키마가 `.strict()` 라 거절한다. 셋만 꺼내 넣는다. */
    const { red, green, blue } = second.previous as Record<string, number>;
    await expect(
      invoke(mcp, "photoshop.color.set_foreground", second.previous as never),
    ).rejects.toThrow();
    await invoke(mcp, "photoshop.color.set_foreground", { red, green, blue });
    const now = (await invoke(mcp, "photoshop.color.get_foreground_background")) as {
      foreground: Record<string, unknown>;
    };
    expect(now.foreground).toEqual({ red: 10, green: 20, blue: 30, hex: "#0A141E" });
  });

  /** 전경과 배경은 서로 다른 값이다 — 한쪽을 바꿔도 다른 쪽은 그대로다. */
  it("**전경과 배경이 섞이지 않는다**", async () => {
    const mcp = setup(["read", "edit"]);
    await invoke(mcp, "photoshop.color.set_foreground", { red: 255, green: 0, blue: 0 });
    await invoke(mcp, "photoshop.color.set_background", { red: 0, green: 0, blue: 255 });
    const result = (await invoke(mcp, "photoshop.color.get_foreground_background")) as {
      foreground: { hex: string };
      background: { hex: string };
    };
    expect(result.foreground.hex).toBe("#FF0000");
    expect(result.background.hex).toBe("#0000FF");
  });

  /**
   * **Mock 도 처음에는 모른다.** 실행 중인 Photoshop 의 색을 지어내면
   * 첫 `previous` 가 거짓이 되고 되돌리기가 엉뚱한 색을 남긴다.
   */
  it("**첫 previous 는 전부 null 이다**", async () => {
    const first = (await invoke(setup(["read", "edit"]), "photoshop.color.set_foreground", {
      red: 1,
      green: 2,
      blue: 3,
    })) as { previous: Record<string, unknown> };
    expect(first.previous).toEqual({ red: null, green: null, blue: null, hex: null });
  });

  it("**범위 밖과 실수를 거절한다**", () => {
    expect(ColorSetParamsSchema.safeParse({ red: 0, green: 0, blue: 0 }).success).toBe(true);
    expect(ColorSetParamsSchema.safeParse({ red: 256, green: 0, blue: 0 }).success).toBe(false);
    expect(ColorSetParamsSchema.safeParse({ red: -1, green: 0, blue: 0 }).success).toBe(false);
    expect(ColorSetParamsSchema.safeParse({ red: 12.5, green: 0, blue: 0 }).success).toBe(false);
    /* 셋을 다 요구한다 — 하나만 주면 나머지가 무엇이 될지 알 수 없다. */
    expect(ColorSetParamsSchema.safeParse({ red: 10 }).success).toBe(false);
  });
});
