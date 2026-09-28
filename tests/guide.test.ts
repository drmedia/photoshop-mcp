import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { GuideCreateParamsSchema, GuideDeleteParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 가이드. (ROADMAP §59)
 *
 * **전부 DOM 이다** — `document.guides`(23.0+) 와 `Guide` 클래스로 다 된다.
 * 방향과 좌표뿐이라 **Mock 도 전부 흉내낼 수 있다** — 이 저장소에서 드문 경우다.
 */

function setup(allow: string[] = ["read", "edit"]): ReturnType<typeof createPhotoshopMcp> {
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

describe("guide", () => {
  /**
   * **`delete` 가 `edit` 다.** `CORE_API.md` §5.12 는 DESTRUCTIVE 를 예정값으로
   * 적어 두었지만 지우는 것이 좌표 하나뿐이다 — 마스크나 채널처럼 쌓아 둔
   * 작업이 없고 같은 값으로 다시 만들면 된다. §5 의 Permission 은 "구현 시점의
   * 예정값" 이고 §2 의 경계 규칙이 최종이다.
   */
  it("**delete 까지 edit 다** — 지우는 것이 좌표 하나뿐이다", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("GUIDE_LIST")).toBe("read");
    expect(mcp.commands.permissionOf("GUIDE_CREATE")).toBe("edit");
    expect(mcp.commands.permissionOf("GUIDE_DELETE")).toBe("edit");
    /* 쌓아 둔 작업을 잃는 쪽은 destructive 로 남아 있다. */
    expect(mcp.commands.permissionOf("CHANNEL_DELETE")).toBe("destructive");
  });

  it("**만들면 목록에 보이고 지우면 사라진다**", async () => {
    const mcp = setup();
    expect(
      ((await invoke(mcp, "photoshop.guide.list")) as { guides: unknown[] }).guides,
    ).toHaveLength(0);

    const made = (await invoke(mcp, "photoshop.guide.create", {
      direction: "horizontal",
      coordinate: 100,
    })) as { direction: string; coordinate: number; index: number };
    expect(made).toMatchObject({ direction: "horizontal", coordinate: 100, index: 0 });

    await invoke(mcp, "photoshop.guide.create", { direction: "vertical", coordinate: 200.5 });
    const listed = (await invoke(mcp, "photoshop.guide.list")) as {
      guides: { direction: string; coordinate: number }[];
    };
    expect(listed.guides.map((entry) => entry.direction)).toEqual(["horizontal", "vertical"]);
    /* 소수를 받는다 — 레퍼런스가 "The value can be a decimal" 이라고 적는다. */
    expect(listed.guides[1]?.coordinate).toBe(200.5);

    const deleted = (await invoke(mcp, "photoshop.guide.delete", { index: 0 })) as {
      deleted: { direction: string };
      remaining: number;
    };
    expect(deleted.deleted.direction).toBe("horizontal");
    expect(deleted.remaining).toBe(1);
  });

  it("**범위 밖 색인은 거절한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.guide.create", { direction: "horizontal", coordinate: 10 });
    await expect(invoke(mcp, "photoshop.guide.delete", { index: 5 })).rejects.toThrow(/범위/u);
  });

  /** 가이드에는 이름이 없다 — 색인 아니면 id 다. */
  it("**index 와 id 중 정확히 하나를 받는다**", () => {
    expect(GuideDeleteParamsSchema.safeParse({ index: 0 }).success).toBe(true);
    expect(GuideDeleteParamsSchema.safeParse({ id: 782 }).success).toBe(true);
    expect(GuideDeleteParamsSchema.safeParse({ index: 0, id: 782 }).success).toBe(false);
    expect(GuideDeleteParamsSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(GuideDeleteParamsSchema.safeParse({}).success).toBe(false);
  });

  /**
   * **색인은 밀리고 id 는 안 밀린다.** 실기에서 하나를 지우니 뒤의 것이
   * 1 → 0 으로 내려왔다 — id 는 그대로였다. 여러 개를 지울 때 이 차이가 크다.
   */
  it("**id 로 지우면 색인이 밀려도 맞는 것을 지운다**", async () => {
    const mcp = setup();
    const a = (await invoke(mcp, "photoshop.guide.create", {
      direction: "vertical",
      coordinate: 10,
    })) as { id: number };
    const b = (await invoke(mcp, "photoshop.guide.create", {
      direction: "vertical",
      coordinate: 20,
    })) as { id: number };
    const c = (await invoke(mcp, "photoshop.guide.create", {
      direction: "vertical",
      coordinate: 30,
    })) as { id: number };

    /* 앞의 것을 지우면 뒤가 밀린다. */
    await invoke(mcp, "photoshop.guide.delete", { id: a.id });
    const listed = (await invoke(mcp, "photoshop.guide.list")) as {
      guides: { id: number; index: number }[];
    };
    expect(listed.guides.map((entry) => entry.index)).toEqual([0, 1]);
    expect(listed.guides.map((entry) => entry.id)).toEqual([b.id, c.id]);

    /* 밀린 뒤에도 id 로 정확히 고른다. */
    const gone = (await invoke(mcp, "photoshop.guide.delete", { id: c.id })) as {
      deleted: { coordinate: number };
    };
    expect(gone.deleted.coordinate).toBe(30);
  });

  it("**없는 id 는 거절한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.guide.create", { direction: "vertical", coordinate: 10 });
    await expect(invoke(mcp, "photoshop.guide.delete", { id: 9999 })).rejects.toThrow(
      /찾을 수 없습니다/u,
    );
  });

  it("**방향은 둘뿐이고 필수다**", () => {
    expect(GuideCreateParamsSchema.safeParse({ coordinate: 10 }).success).toBe(false);
    expect(
      GuideCreateParamsSchema.safeParse({ direction: "diagonal", coordinate: 10 }).success,
    ).toBe(false);
    expect(
      GuideCreateParamsSchema.safeParse({ direction: "horizontal", coordinate: 10 }).success,
    ).toBe(true);
  });

  /**
   * **캔버스 밖과 음수를 막지 않는다.** Photoshop 이 받는 값을 스키마가 먼저
   * 거절하면 호출자가 할 수 있는 일을 못 하게 된다.
   */
  it("**음수와 캔버스 밖을 막지 않는다**", async () => {
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.guide.create", { direction: "vertical", coordinate: -50 }),
    ).resolves.toMatchObject({ coordinate: -50 });
  });
});
