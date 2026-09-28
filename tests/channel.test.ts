import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import {
  ChannelDeleteParamsSchema,
  ChannelGetParamsSchema,
  ChannelSelectParamsSchema,
} from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 채널. (ROADMAP §56)
 *
 * **전부 DOM 이다** — `Channels` 컬렉션과 `Channel` 클래스, 읽기/쓰기인
 * `document.activeChannels` 로 다 된다. descriptor 를 한 번도 잡지 않았다.
 *
 * **Mock 은 알파 채널만 모델링한다.** 색 성분 채널의 이름이 Photoshop 언어
 * 설정에 따라 달라(한국어는 `빨강`·`녹색`·`파랑`) 영어 이름을 지어 넣으면
 * 실기와 다른 이름을 사실로 굳힌다. 그 대가로 "색 성분은 거절한다" 경로는
 * 실기에서 확인한다.
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

describe("channel", () => {
  it("**조회는 read · 삭제만 destructive 다**", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("CHANNEL_LIST")).toBe("read");
    expect(mcp.commands.permissionOf("CHANNEL_GET")).toBe("read");
    expect(mcp.commands.permissionOf("CHANNEL_CREATE")).toBe("edit");
    expect(mcp.commands.permissionOf("CHANNEL_SELECT")).toBe("edit");
    expect(mcp.commands.permissionOf("CHANNEL_DUPLICATE")).toBe("edit");
    /* 저장해 둔 선택 영역을 버린다. */
    expect(mcp.commands.permissionOf("CHANNEL_DELETE")).toBe("destructive");
  });

  /**
   * **이 Tool 이 생긴 이유다.** `selection.save_channel` 이 채널을 만드는데
   * 목록을 볼 방법이 없어서, 이름이 틀리면 `load_channel` 이
   * `"설정" 명령은 현재 사용할 수 없습니다` 만 돌려줬다.
   */
  it("**save_channel 이 만든 채널이 목록에 보인다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.selection.set", { shape: "canvas" });
    await invoke(mcp, "photoshop.selection.save_channel", { name: "하늘" });

    const result = (await invoke(mcp, "photoshop.channel.list")) as {
      channels: { name: string; isComponent: boolean }[];
    };
    expect(result.channels.map((entry) => entry.name)).toContain("하늘");
    expect(result.channels.every((entry) => !entry.isComponent)).toBe(true);
  });

  it("**만들면 늘고 지우면 준다**", async () => {
    const mcp = setup();
    const created = (await invoke(mcp, "photoshop.channel.create", { name: "A" })) as {
      name: string;
    };
    expect(created.name).toBe("A");

    await invoke(mcp, "photoshop.channel.create", { name: "B" });
    const listed = (await invoke(mcp, "photoshop.channel.list")) as { channels: unknown[] };
    expect(listed.channels).toHaveLength(2);

    const deleted = (await invoke(mcp, "photoshop.channel.delete", { name: "A" })) as {
      deleted: string;
      remaining: number;
    };
    expect(deleted.deleted).toBe("A");
    expect(deleted.remaining).toBe(1);
  });

  it("**복제하면 하나 는다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.channel.create", { name: "원본" });
    const copy = (await invoke(mcp, "photoshop.channel.duplicate", { name: "원본" })) as {
      name: string;
    };
    expect(copy.name).not.toBe("원본");

    const listed = (await invoke(mcp, "photoshop.channel.list")) as { channels: unknown[] };
    expect(listed.channels).toHaveLength(2);
  });

  /**
   * **없는 이름에 무엇이 있는지 함께 말한다.** 이 Tool 이 없앤 것이 바로
   * "이름이 틀려도 무엇이 있는지 알 수 없다" 였다.
   */
  it("**없는 채널은 거절한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.channel.create", { name: "있음" });
    await expect(invoke(mcp, "photoshop.channel.get", { name: "없음" })).rejects.toThrow(
      /없습니다/u,
    );
    await expect(invoke(mcp, "photoshop.channel.get", { index: 9 })).rejects.toThrow(/범위/u);
  });

  /** 이름과 색인을 함께 주면 어느 쪽을 쓸지 호출자가 모른다. */
  it("**name 과 index 중 정확히 하나를 받는다**", () => {
    expect(ChannelGetParamsSchema.safeParse({}).success).toBe(false);
    expect(ChannelGetParamsSchema.safeParse({ name: "A", index: 0 }).success).toBe(false);
    expect(ChannelGetParamsSchema.safeParse({ name: "A" }).success).toBe(true);
    expect(ChannelGetParamsSchema.safeParse({ index: 0 }).success).toBe(true);
    expect(ChannelDeleteParamsSchema.safeParse({}).success).toBe(false);
    expect(ChannelDeleteParamsSchema.safeParse({ name: "A", index: 1 }).success).toBe(false);
  });

  /**
   * **히스토그램은 픽셀이라 Mock 이 모른다.** 그럴듯한 256개를 지어내면
   * 워크플로가 그것을 보고 판단한다.
   */
  it("**Mock 은 히스토그램을 지어내지 않는다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.channel.create", { name: "H" });
    const result = (await invoke(mcp, "photoshop.channel.get", {
      name: "H",
      histogram: true,
    })) as { histogram: unknown; kind: unknown };
    expect(result.histogram).toBeNull();
    /* 실기 값을 모르는 것도 `null` 이다. */
    expect(result.kind).toBeNull();
  });

  it("**select 는 이름을 하나 이상 받는다**", () => {
    expect(ChannelSelectParamsSchema.safeParse({ names: [] }).success).toBe(false);
    expect(ChannelSelectParamsSchema.safeParse({ names: ["빨강"] }).success).toBe(true);
  });

  it("**select 는 건 뒤 다시 읽은 값을 답한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.channel.create", { name: "X" });
    const result = (await invoke(mcp, "photoshop.channel.select", { names: ["X"] })) as {
      active: string[];
    };
    expect(result.active).toEqual(["X"]);
  });

  /** `selection.load_channel` 이 이미 한다 — 같은 능력에 이름을 둘 두지 않는다. */
  it("**channel.load_as_selection 은 없다**", () => {
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    expect(names).not.toContain("photoshop.channel.load_as_selection");
    expect(names).toContain("photoshop.selection.load_channel");
  });
});
