import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { LayerCompGetParamsSchema } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 레이어 컴프. (ROADMAP §57)
 *
 * 레이어의 **표시 여부 · 위치 · 모양**을 한 벌로 저장해 두고 오간다.
 * **전부 DOM 이다** — `document.layerComps`(24.0+) 와 `LayerComp` 클래스로
 * 다 된다.
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

describe("layer_comp", () => {
  /**
   * **덮어쓰거나 버리는 둘만 destructive 다.** `apply` 는 문서 배치를 바꾸지만
   * 저장해 둔 기록은 그대로 남는다.
   */
  it("**recapture 와 delete 만 destructive 다**", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("LAYER_COMP_LIST")).toBe("read");
    expect(mcp.commands.permissionOf("LAYER_COMP_GET")).toBe("read");
    expect(mcp.commands.permissionOf("LAYER_COMP_CREATE")).toBe("edit");
    expect(mcp.commands.permissionOf("LAYER_COMP_APPLY")).toBe("edit");
    expect(mcp.commands.permissionOf("LAYER_COMP_RECAPTURE")).toBe("destructive");
    expect(mcp.commands.permissionOf("LAYER_COMP_DELETE")).toBe("destructive");
  });

  it("**만들면 목록에 보이고 지우면 사라진다**", async () => {
    const mcp = setup();
    expect(
      ((await invoke(mcp, "photoshop.layer_comp.list")) as { comps: unknown[] }).comps,
    ).toHaveLength(0);

    await invoke(mcp, "photoshop.layer_comp.create", { name: "안 A" });
    await invoke(mcp, "photoshop.layer_comp.create", { name: "안 B" });
    const listed = (await invoke(mcp, "photoshop.layer_comp.list")) as {
      comps: { name: string }[];
    };
    expect(listed.comps.map((entry) => entry.name)).toEqual(["안 A", "안 B"]);

    const deleted = (await invoke(mcp, "photoshop.layer_comp.delete", { name: "안 A" })) as {
      deleted: string;
      remaining: number;
    };
    expect(deleted.deleted).toBe("안 A");
    expect(deleted.remaining).toBe(1);
  });

  /**
   * **레퍼런스가 "옵션 없이 만들면 표시 여부만 기록된다" 고 적는다.** 결과는
   * 요청값이 아니라 만든 뒤 읽은 값이라 무엇이 실제로 켜졌는지 드러난다.
   */
  it("**무엇을 기억하는지 결과가 말한다**", async () => {
    const mcp = setup();
    const plain = (await invoke(mcp, "photoshop.layer_comp.create", {})) as {
      visibility: boolean;
      appearance: boolean;
      position: boolean;
    };
    expect(plain.visibility).toBe(true);
    expect(plain.appearance).toBe(false);
    expect(plain.position).toBe(false);

    const full = (await invoke(mcp, "photoshop.layer_comp.create", {
      name: "전부",
      appearance: true,
      position: true,
    })) as { appearance: boolean; position: boolean };
    expect(full.appearance).toBe(true);
    expect(full.position).toBe(true);
  });

  /**
   * **이름이 유일하지 않다.** 실제 `getAllByName` 이 배열을 돌려준다 —
   * 조용히 첫 번째를 고르면 호출자가 무엇에 걸었는지 모른다. (액션과 같다)
   */
  it("**같은 이름이 여럿이면 거절하고 index 를 쓰라고 한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer_comp.create", { name: "같음" });
    await invoke(mcp, "photoshop.layer_comp.create", { name: "같음" });

    await expect(invoke(mcp, "photoshop.layer_comp.get", { name: "같음" })).rejects.toThrow(
      /index 로 고르세요/u,
    );
    /* 색인으로는 고를 수 있다. */
    const byIndex = (await invoke(mcp, "photoshop.layer_comp.get", { index: 1 })) as {
      name: string;
    };
    expect(byIndex.name).toBe("같음");
  });

  it("**없는 이름과 범위 밖 색인은 거절한다**", async () => {
    const mcp = setup();
    await invoke(mcp, "photoshop.layer_comp.create", { name: "있음" });
    await expect(invoke(mcp, "photoshop.layer_comp.get", { name: "없음" })).rejects.toThrow(
      /없습니다/u,
    );
    await expect(invoke(mcp, "photoshop.layer_comp.get", { index: 9 })).rejects.toThrow(/범위/u);
  });

  it("**name 과 index 중 정확히 하나를 받는다**", () => {
    expect(LayerCompGetParamsSchema.safeParse({}).success).toBe(false);
    expect(LayerCompGetParamsSchema.safeParse({ name: "A", index: 0 }).success).toBe(false);
    expect(LayerCompGetParamsSchema.safeParse({ name: "A" }).success).toBe(true);
    expect(LayerCompGetParamsSchema.safeParse({ index: 0 }).success).toBe(true);
  });

  /**
   * **Mock 은 `apply` 가 레이어를 바꾸는 것을 흉내내지 않는다.** 무엇이 어떻게
   * 바뀌는지는 좌표와 스타일이라 Mock 이 모른다 — 지어내면 워크플로가 그것을
   * 믿는다. 흉내내는 것은 "어느 컴프가 골라졌는가" 까지다.
   */
  it("**apply 는 선택 상태만 바꾼다 (Mock)**", async () => {
    const mcp = setup();
    const before = (await invoke(mcp, "photoshop.layer_comp.create", { name: "A" })) as {
      selected: boolean;
    };
    expect(before.selected).toBe(false);

    const applied = (await invoke(mcp, "photoshop.layer_comp.apply", { name: "A" })) as {
      selected: boolean;
    };
    expect(applied.selected).toBe(true);
  });

  it("**기본 권한으로는 recapture 와 delete 가 막힌다**", async () => {
    const mcp = setup(["read", "edit"]);
    await invoke(mcp, "photoshop.layer_comp.create", { name: "A" });
    /* 만들고 적용하는 것은 된다. */
    await expect(invoke(mcp, "photoshop.layer_comp.apply", { name: "A" })).resolves.toBeTruthy();
    await expect(invoke(mcp, "photoshop.layer_comp.recapture", { name: "A" })).rejects.toThrow();
    await expect(invoke(mcp, "photoshop.layer_comp.delete", { name: "A" })).rejects.toThrow();
  });
});
