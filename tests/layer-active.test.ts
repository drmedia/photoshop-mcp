import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { LAYER_GET_ACTIVE, layerGetActiveCommand } from "@photoshop-mcp/photoshop-tools";
import { MockPhotoshopBridge, type LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.layer.get_active` — 지금 선택된 레이어. (CORE_API §4.2)
 *
 * 편집 Tool 이 `layerId` 를 생략하면 활성 레이어를 대상으로 삼는데, 그것이 무엇인지
 * 물어볼 방법이 없었다. 이 Tool 이 답한다.
 *
 * 가장 중요한 성질은 **`layer` 와 `layers[0]` 이 절대 어긋나지 않는다**는 것이다.
 * 어긋나면 "편집 Tool 이 무엇을 건드리는지" 알려주는 Tool 자체가 거짓말을 한다.
 */

interface ActiveResult {
  layer: LayerInfo | null;
  layers: LayerInfo[];
}

function setup(): ReturnType<typeof createPhotoshopMcp> & { bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  return { ...createPhotoshopMcp({ bridge, logger: createSilentLogger() }), bridge };
}

const getActive = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<ActiveResult> =>
  mcp.tools.invoke<ActiveResult>("photoshop.layer.get_active", {}, { requestId: "req-active" });

describe("photoshop.layer.get_active", () => {
  it("읽기 전용이다", () => {
    const { tools, commands } = setup();
    expect(tools.get("photoshop.layer.get_active")?.permission).toBe("read");
    expect(commands.permissionOf(LAYER_GET_ACTIVE)).toBe("read");
  });

  it("편집 Tool 이 대상으로 삼는 레이어와 일치한다", async () => {
    // 이것이 이 Tool 의 존재 이유다. 여기가 어긋나면 나머지는 의미가 없다.
    const mcp = setup();
    await mcp.tools.invoke("photoshop.layer.select", { layerId: 12 }, { requestId: "r" });

    const active = await getActive(mcp);
    expect(active.layer?.id).toBe(12);

    // 같은 조건에서 layerId 를 생략한 편집이 실제로 그 레이어를 건드리는지 본다.
    const renamed = await mcp.tools.invoke<LayerInfo>(
      "photoshop.layer.rename",
      { name: "확인" },
      { requestId: "r" },
    );
    expect(renamed.id).toBe(active.layer?.id);
  });

  it("layer 는 항상 layers 의 첫 번째다", async () => {
    const mcp = setup();
    const active = await getActive(mcp);
    expect(active.layer).toEqual(active.layers[0] ?? null);
  });

  it("선택이 없으면 실패가 아니라 null 을 준다", async () => {
    // 조회에서 '없음' 은 답이지 오류가 아니다. 던지면 호출자가 try 로 감싸야 한다.
    const bridge = new MockPhotoshopBridge();
    const mcp = { ...createPhotoshopMcp({ bridge, logger: createSilentLogger() }), bridge };
    // Mock 의 활성 레이어를 없는 id 로 옮겨 '선택 없음' 을 만든다.
    await bridge.executeCommand({ type: "LAYER_SELECT", params: { layerId: 12 } });
    bridge.setLayers([]);

    const active = await getActive(mcp);
    expect(active).toEqual({ layer: null, layers: [] });
  });

  it("그룹 안의 레이어면 parentId 를 유지한다", async () => {
    // 평탄화 목록에서 걸러 내지 않고 activeLayers 를 그대로 변환하면 parentId 가
    // null 이 된다. 그러면 그룹 안의 레이어가 최상위로 보고된다.
    const bridge = new MockPhotoshopBridge();
    const mcp = { ...createPhotoshopMcp({ bridge, logger: createSilentLogger() }), bridge };

    const group = await mcp.tools.invoke<LayerInfo>(
      "photoshop.group.create",
      { name: "묶음", layerIds: [12] },
      { requestId: "r" },
    );
    await mcp.tools.invoke("photoshop.layer.select", { layerId: 12 }, { requestId: "r" });

    const active = await getActive(mcp);
    expect(active.layer?.parentId).toBe(group.id);
  });

  it("Plugin 이 배열만 보내고 layer 는 서버가 뽑는다", async () => {
    // Plugin 이 layer 와 layers 를 따로 보내면 둘이 어긋날 수 있다.
    // 어긋날 수 있는 두 값을 검증하는 대신 어긋날 수 없게 만든 설계를 고정한다.
    const sent: LayerInfo[] = [
      {
        id: 7,
        name: "위",
        type: "pixel",
        visible: true,
        opacity: 100,
        parentId: null,
        blendMode: "normal",
      },
      {
        id: 8,
        name: "아래",
        type: "pixel",
        visible: true,
        opacity: 100,
        parentId: null,
        blendMode: "normal",
      },
    ];
    const result = await layerGetActiveCommand({ type: LAYER_GET_ACTIVE, params: {} }, {
      bridge: { executeCommand: async () => sent },
      requestId: "r",
    } as never);

    expect(result).toEqual({ layer: sent[0], layers: sent });
  });
});
