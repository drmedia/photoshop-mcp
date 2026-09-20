import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 스마트 오브젝트 변환. (ROADMAP §17.27)
 *
 * 이 Tool 의 존재 이유는 **그 뒤에 거는 필터가 스마트 필터가 되는 것**이다.
 * 그래서 고정할 것이 둘이다 — id 가 바뀐다는 사실을 호출자에게 전달하는가,
 * 그리고 두 번 불러도 겹겹이 감싸지 않는가.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

interface ConvertResult {
  layer: { id: number; name: string; type: string; isBackground?: boolean };
  converted: boolean;
  previousId: number;
}

const convert = async (mcp: Mcp, layerId?: number): Promise<ConvertResult> =>
  (await mcp.tools.invoke(
    "photoshop.smart_object.convert",
    layerId === undefined ? {} : { layerId },
    { requestId: "r" },
  )) as ConvertResult;

const layers = async (mcp: Mcp): Promise<{ id: number; type: string; name: string }[]> =>
  (
    (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: { id: number; type: string; name: string }[];
    }
  ).layers;

describe("permission", () => {
  it("픽셀을 버리지 않으므로 edit 이다", () => {
    // 한 겹 감쌀 뿐이고 smart_object.rasterize 로 되돌린다.
    expect(setup().tools.get("photoshop.smart_object.convert")?.permission).toBe("edit");
  });

  it("읽기 전용 서버에서는 막힌다", async () => {
    await expect(convert(setup(["read"]))).rejects.toThrow(/권한|permission/iu);
  });
});

describe("변환", () => {
  it("스마트 오브젝트가 된다", async () => {
    const mcp = setup();
    const result = await convert(mcp);
    expect(result.converted).toBe(true);
    expect(result.layer.type).toBe("smartObject");
  });

  it("**id 가 바뀌고 그 사실을 알린다**", async () => {
    // 옛 id 로 이어서 작업하면 조용히 다른 레이어를 건드린다.
    const mcp = setup();
    const before = await layers(mcp);
    const target = before[0] as { id: number };

    const result = await convert(mcp, target.id);

    expect(result.previousId).toBe(target.id);
    expect(result.layer.id).not.toBe(target.id);
  });

  it("문서에 실제로 반영된다", async () => {
    // 결과만 그럴듯하고 문서는 그대로인 경우를 막는다.
    const mcp = setup();
    const result = await convert(mcp);
    const after = await layers(mcp);

    const found = after.find((layer) => layer.id === result.layer.id);
    expect(found?.type).toBe("smartObject");
    expect(after.some((layer) => layer.id === result.previousId)).toBe(false);
  });

  it("이름을 유지한다", async () => {
    const mcp = setup();
    const before = await layers(mcp);
    const result = await convert(mcp, (before[0] as { id: number }).id);
    expect(result.layer.name).toBe((before[0] as { name: string }).name);
  });

  it("**배경이었어도 배경이 아니게 된다**", async () => {
    // "배경인 스마트 오브젝트" 는 존재하지 않는 상태다. 남겨 두면 이후 Command 가
    // 배경 취급을 해서 rename · set_blend_mode 를 잘못 막는다.
    const mcp = setup();
    const result = await convert(mcp);
    expect(result.layer.isBackground).toBeUndefined();
  });
});

describe("**두 번 감싸지 않는다**", () => {
  it("이미 스마트 오브젝트면 아무것도 하지 않는다", async () => {
    // 겹치면 스마트 오브젝트 안에 스마트 오브젝트가 생겨 되돌리기 어렵다.
    const mcp = setup();
    const first = await convert(mcp);
    const second = await convert(mcp, first.layer.id);

    expect(second.converted).toBe(false);
    expect(second.layer.id).toBe(first.layer.id);
    expect(second.previousId).toBe(first.layer.id);
  });

  it("오류로 만들지 않는다", async () => {
    // 이미 원하는 상태다. 오류면 호출자가 매번 먼저 확인해야 한다.
    const mcp = setup();
    const first = await convert(mcp);
    await expect(convert(mcp, first.layer.id)).resolves.toBeDefined();
  });

  it("레이어 수가 늘지 않는다", async () => {
    const mcp = setup();
    const first = await convert(mcp);
    const count = (await layers(mcp)).length;
    await convert(mcp, first.layer.id);
    expect((await layers(mcp)).length).toBe(count);
  });
});

describe("대상 지정", () => {
  it("없는 레이어를 거절한다", async () => {
    await expect(convert(setup(), 99999)).rejects.toThrow(/찾을 수 없|not found/iu);
  });

  it("0 이하를 거절한다", async () => {
    await expect(convert(setup(), 0)).rejects.toThrow();
    await expect(convert(setup(), -1)).rejects.toThrow();
  });

  it("모르는 필드를 거절한다", async () => {
    // strict 스키마다. 오타가 조용히 무시되면 호출자가 안 걸린 줄 모른다.
    await expect(
      setup().tools.invoke("photoshop.smart_object.convert", { layerID: 1 }, { requestId: "r" }),
    ).rejects.toThrow();
  });
});
