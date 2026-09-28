import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { PathFillParamsSchema, PathStrokeParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 패스. (ROADMAP §58)
 *
 * **전부 DOM 이다** — `document.pathItems`(23.3+) 와 `PathItem` 클래스로 다
 * 된다. descriptor 를 한 번도 잡지 않았다.
 *
 * `create` 는 **선택 영역에서** 만든다. `pathItems.add` 는 베지어 기하를
 * 요구하고 `SubPathInfo` 의 인터페이스 문서가 없어 짐작해 넘기지 않았다.
 */

function setup(
  allow: string[] = ["read", "edit", "destructive"],
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

const withSelection = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<void> => {
  await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
};

describe("path", () => {
  it("**조회는 read · 삭제만 destructive 다**", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("PATH_LIST")).toBe("read");
    expect(mcp.commands.permissionOf("PATH_GET")).toBe("read");
    for (const type of [
      "PATH_CREATE",
      "PATH_SELECT",
      "PATH_TO_SELECTION",
      "PATH_FILL",
      "PATH_STROKE",
    ]) {
      expect(mcp.commands.permissionOf(type)).toBe("edit");
    }
    expect(mcp.commands.permissionOf("PATH_DELETE")).toBe("destructive");
  });

  /** `pathItems.add` 대신 `makeWorkPath` 를 쓰므로 선택이 전제다. */
  it("**선택이 없으면 만들 수 없다**", async () => {
    await expect(invoke(setup(), "photoshop.path.create", {})).rejects.toThrow(
      /선택 영역이 없습니다/u,
    );
  });

  it("**만들면 목록에 보이고 지우면 사라진다**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    const made = (await invoke(mcp, "photoshop.path.create", { name: "하늘 윤곽" })) as {
      name: string;
    };
    expect(made.name).toBe("하늘 윤곽");

    const listed = (await invoke(mcp, "photoshop.path.list")) as { paths: { name: string }[] };
    expect(listed.paths.map((entry) => entry.name)).toEqual(["하늘 윤곽"]);

    const deleted = (await invoke(mcp, "photoshop.path.delete", { name: "하늘 윤곽" })) as {
      deleted: string;
      remaining: number;
    };
    expect(deleted.deleted).toBe("하늘 윤곽");
    expect(deleted.remaining).toBe(0);
  });

  /**
   * **선택 → 패스 → 선택이 왕복한다.** 이것이 이 묶음의 요점이다 —
   * 선택은 다음 작업에서 쉽게 사라지지만 패스는 남는다.
   */
  it("**선택과 패스가 왕복한다**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    await invoke(mcp, "photoshop.path.create", { name: "P" });
    await invoke(mcp, "photoshop.selection.clear");

    const back = (await invoke(mcp, "photoshop.path.to_selection", { name: "P" })) as {
      hasSelection: boolean;
      path: { name: string };
    };
    expect(back.hasSelection).toBe(true);
    expect(back.path.name).toBe("P");
  });

  /**
   * **이름이 유일하지 않다.** `getByName` 이 "the **first** PathItem matching"
   * 이라고 적혀 있다 — 조용히 첫 번째를 고르면 호출자가 무엇에 걸었는지 모른다.
   */
  it("**같은 이름이 여럿이면 거절하고 index 를 쓰라고 한다**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    await invoke(mcp, "photoshop.path.create", { name: "같음" });
    await invoke(mcp, "photoshop.path.create", { name: "같음" });

    await expect(invoke(mcp, "photoshop.path.get", { name: "같음" })).rejects.toThrow(
      /index 로 고르세요/u,
    );
    const byIndex = (await invoke(mcp, "photoshop.path.get", { index: 1 })) as { name: string };
    expect(byIndex.name).toBe("같음");
  });

  it("**없는 이름과 범위 밖 색인은 거절한다**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    await invoke(mcp, "photoshop.path.create", { name: "있음" });
    await expect(invoke(mcp, "photoshop.path.get", { name: "없음" })).rejects.toThrow(/없습니다/u);
    await expect(invoke(mcp, "photoshop.path.get", { index: 9 })).rejects.toThrow(/범위/u);
  });

  it("**fill 은 색이 필수이고 0~255 다**", () => {
    expect(PathFillParamsSchema.safeParse({ index: 0 }).success).toBe(false);
    expect(
      PathFillParamsSchema.safeParse({ index: 0, color: { red: 0, green: 0, blue: 0 } }).success,
    ).toBe(true);
    expect(
      PathFillParamsSchema.safeParse({ index: 0, color: { red: 256, green: 0, blue: 0 } }).success,
    ).toBe(false);
  });

  /**
   * **굵기와 색을 받지 않는다.** `strokePath` 에 그것을 주는 인자가 없고
   * 도구의 현재 설정을 따른다 — 받는 척하면 호출자가 정했다고 믿는다.
   */
  it("**stroke 는 굵기·색을 받지 않는다**", () => {
    expect(PathStrokeParamsSchema.safeParse({ index: 0 }).success).toBe(true);
    expect(PathStrokeParamsSchema.safeParse({ index: 0, tool: "brush" }).success).toBe(true);
    expect(PathStrokeParamsSchema.safeParse({ index: 0, width: 5 }).success).toBe(false);
    expect(
      PathStrokeParamsSchema.safeParse({ index: 0, color: { red: 0, green: 0, blue: 0 } }).success,
    ).toBe(false);
    /* 목록에 없는 도구는 거절한다. */
    expect(PathStrokeParamsSchema.safeParse({ index: 0, tool: "gradient" }).success).toBe(false);
  });

  /**
   * **Mock 은 픽셀을 그리지 않는다.** 무엇이 어떻게 그려지는지 모른다 —
   * 필터와 같은 자리다. 패스를 찾는 계약만 흉내낸다.
   */
  it("**fill · stroke 는 패스를 찾는 것까지만 흉내낸다 (Mock)**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    await invoke(mcp, "photoshop.path.create", { name: "P" });

    await expect(
      invoke(mcp, "photoshop.path.fill", { name: "P", color: { red: 255, green: 0, blue: 0 } }),
    ).resolves.toMatchObject({ name: "P" });
    await expect(invoke(mcp, "photoshop.path.stroke", { name: "P" })).resolves.toMatchObject({
      name: "P",
    });
    await expect(
      invoke(mcp, "photoshop.path.fill", { name: "없음", color: { red: 0, green: 0, blue: 0 } }),
    ).rejects.toThrow();
  });

  /** 실기 값을 모르는 것은 Mock 이 `null` 로 둔다. */
  it("**Mock 은 kind 를 지어내지 않는다**", async () => {
    const mcp = setup();
    await withSelection(mcp);
    const made = (await invoke(mcp, "photoshop.path.create", { name: "P" })) as {
      kind: unknown;
      subPathCount: unknown;
    };
    expect(made.kind).toBeNull();
    expect(made.subPathCount).toBeNull();
  });
});
