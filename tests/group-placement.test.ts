import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 그룹 생성 위치. (ROADMAP §17.20)
 *
 * 실기 보정에서 그룹 하나를 선택한 뒤 새 그룹을 만들었더니 **그 안에 들어갔고**,
 * 다음 그룹은 다시 그 안에, 마지막 조정 레이어는 세 겹 마스크에 갇혀 아무 데도
 * 걸리지 않았다. 오류는 없었다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit"]),
  });
}

const create = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  args: Record<string, unknown>,
): Promise<LayerInfo> =>
  (await mcp.tools.invoke("photoshop.group.create", args, { requestId: "r" })) as LayerInfo;

describe("그룹 생성 위치", () => {
  it("**기본은 최상위다**", async () => {
    // 호출자가 "지금 활성 레이어가 어디 있는지" 를 추적해야 결과를 예측할 수
    // 있는 API 는 조용히 틀린다.
    const group = await create(setup(), { name: "A" });
    expect(group.parentId).toBeNull();
  });

  it("**앞서 만든 그룹을 선택해도 최상위다**", async () => {
    // 이것이 실기에서 깨졌던 보장이다. 연쇄의 시작점.
    const mcp = setup();
    const outer = await create(mcp, { name: "바깥" });
    await mcp.tools.invoke("photoshop.layer.select", { layerId: outer.id }, { requestId: "r" });

    const next = await create(mcp, { name: "다음" });
    expect(next.parentId).toBeNull();
  });

  it("그룹 안에 만들려면 명시한다", async () => {
    const mcp = setup();
    const outer = await create(mcp, { name: "바깥" });
    const inner = await create(mcp, { name: "안", parentId: outer.id });
    expect(inner.parentId).toBe(outer.id);
  });

  it("null 은 최상위를 명시하는 것이다", async () => {
    const mcp = setup();
    const outer = await create(mcp, { name: "바깥" });
    await mcp.tools.invoke("photoshop.layer.select", { layerId: outer.id }, { requestId: "r" });
    expect((await create(mcp, { name: "A", parentId: null })).parentId).toBeNull();
  });

  it("없는 그룹을 가리키면 거절한다", async () => {
    // 조용히 최상위에 만들면 호출자는 그룹 안에 있다고 믿는다.
    await expect(create(setup(), { name: "A", parentId: 9999 })).rejects.toThrow(/9999/u);
  });

  it("**거절하면 그룹이 남지 않는다**", async () => {
    // 실기에서 잡은 버그다. 오류를 돌려주면서 그룹은 만들어져 있었다 —
    // 검증이 생성 뒤에 있었기 때문이다. Mock 은 앞에서 검증해 이 경로를
    // 놓쳤다. 계약을 여기에 고정한다.
    const mcp = setup();
    const before = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: LayerInfo[];
    };

    await expect(create(mcp, { name: "A", parentId: 9999 })).rejects.toThrow();

    const after = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: LayerInfo[];
    };
    expect(after.layers).toHaveLength(before.layers.length);
  });

  describe("layerIds 와 함께 쓸 수 없다", () => {
    it("둘 다 주면 거절한다", async () => {
      // 레이어를 묶으면 그 레이어들이 있던 자리에 그룹이 생긴다. 위치를 따로
      // 주면 둘이 충돌하는데, 조용히 한쪽을 무시하면 호출자가 알 수 없다.
      const mcp = setup();
      const outer = await create(mcp, { name: "바깥" });
      const layers = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
        layers: LayerInfo[];
      };
      const target = layers.layers.find((layer) => layer.type !== "group");
      expect(target).toBeDefined();

      await expect(
        create(mcp, { layerIds: [target?.id ?? 1], parentId: outer.id }),
      ).rejects.toThrow(/layerIds/u);
    });

    it("layerIds 만 주는 것은 그대로 동작한다", async () => {
      const mcp = setup();
      const layers = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
        layers: LayerInfo[];
      };
      const target = layers.layers[0];
      expect(target).toBeDefined();

      const group = await create(mcp, { layerIds: [target?.id ?? 1] });
      expect(group.type).toBe("group");
    });
  });

  it("연쇄가 생기지 않는다", async () => {
    // 실기에서 일어난 흐름을 그대로 재현한다 — 그룹을 만들고 선택하기를 반복.
    // 전부 최상위여야 한다.
    const mcp = setup();
    const created: LayerInfo[] = [];
    for (const name of ["01", "02", "03"]) {
      const group = await create(mcp, { name });
      await mcp.tools.invoke("photoshop.layer.select", { layerId: group.id }, { requestId: "r" });
      created.push(group);
    }
    expect(created.map((group) => group.parentId)).toEqual([null, null, null]);
  });
});
