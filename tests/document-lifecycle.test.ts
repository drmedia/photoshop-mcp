import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import type { LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 문서 평탄화와 닫기. (ROADMAP §17.25)
 *
 * CORE_API §5.1 이 처음부터 둘 다 `DESTRUCTIVE` 로 분류해 두고 구현은 미뤄 둔
 * 것이다. 되돌릴 수 없는 일을 출력 단계에 모은다는 RETOUCH_PROCESS 9단계의
 * 짝이다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit", "destructive"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

interface FlattenResult {
  layer: LayerInfo;
  previousLayers: number;
  hiddenDiscarded: number;
}

interface CloseResult {
  closed: { id: number; name: string };
  remainingDocuments: number;
}

const flatten = async (mcp: Mcp): Promise<FlattenResult> =>
  (await mcp.tools.invoke("photoshop.document.flatten", {}, { requestId: "r" })) as FlattenResult;

const close = async (mcp: Mcp, args: Record<string, unknown>): Promise<CloseResult> =>
  (await mcp.tools.invoke("photoshop.document.close", args, { requestId: "r" })) as CloseResult;

const listing = async (mcp: Mcp): Promise<LayerInfo[]> =>
  (
    (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: LayerInfo[];
    }
  ).layers;

async function addLayer(mcp: Mcp, name: string, visible = true): Promise<LayerInfo> {
  const layer = (await mcp.tools.invoke(
    "photoshop.layer.create",
    { name },
    { requestId: "r" },
  )) as LayerInfo;
  if (!visible) {
    await mcp.tools.invoke(
      "photoshop.layer.set_visibility",
      { layerId: layer.id, visible: false },
      { requestId: "r" },
    );
  }
  return layer;
}

describe("permission", () => {
  it("둘 다 destructive 다", () => {
    const { tools } = setup();
    expect(tools.get("photoshop.document.flatten")?.permission).toBe("destructive");
    expect(tools.get("photoshop.document.close")?.permission).toBe("destructive");
  });

  it("**기본 권한에서는 막힌다**", async () => {
    // 기본은 read · edit 다. 작업을 없애는 일이 기본으로 열려 있으면 안 된다.
    const mcp = setup(["read", "edit"]);
    await expect(flatten(mcp)).rejects.toThrow(/권한|permission/iu);
    await expect(close(mcp, { discardChanges: true })).rejects.toThrow(/권한|permission/iu);
  });

  it("목록에는 있다", () => {
    // 없는 것처럼 숨기면 왜 안 되는지 물어볼 수도 없다.
    const names = setup(["read"])
      .tools.list()
      .map((tool) => tool.name);
    expect(names).toContain("photoshop.document.flatten");
    expect(names).toContain("photoshop.document.close");
  });
});

describe("평탄화", () => {
  it("하나로 합친다", async () => {
    const mcp = setup();
    await addLayer(mcp, "A");
    await addLayer(mcp, "B");

    const result = await flatten(mcp);
    expect(result.previousLayers).toBeGreaterThan(1);
    expect(await listing(mcp)).toHaveLength(1);
  });

  it("**숨긴 레이어가 몇 장 사라졌는지 알린다**", async () => {
    // 평탄화는 숨긴 레이어를 합치지 않고 버린다. 호출자가 가장 놀랄 일이다.
    //
    // Mock 기본 문서에 이미 숨긴 레이어가 있으므로 숫자를 박아 두지 않고
    // 실제로 세어 비교한다 — 고정값을 쓰면 Mock 을 고칠 때 같이 깨진다.
    const mcp = setup();
    await addLayer(mcp, "보임");
    await addLayer(mcp, "숨김1", false);
    await addLayer(mcp, "숨김2", false);

    const hidden = (await listing(mcp)).filter((layer) => !layer.visible).length;
    expect(hidden).toBeGreaterThanOrEqual(2);
    expect((await flatten(mcp)).hiddenDiscarded).toBe(hidden);
  });

  it("보이는 레이어만 있으면 0 이다", async () => {
    const mcp = setup();
    for (const layer of (await listing(mcp)).filter((entry) => !entry.visible)) {
      await mcp.tools.invoke(
        "photoshop.layer.set_visibility",
        { layerId: layer.id, visible: true },
        { requestId: "r" },
      );
    }
    expect((await flatten(mcp)).hiddenDiscarded).toBe(0);
  });

  it("합친 뒤 레이어를 돌려준다", async () => {
    const mcp = setup();
    await addLayer(mcp, "A");
    const result = await flatten(mcp);
    expect(result.layer.type).toBe("pixel");
    expect(result.layer.parentId).toBeNull();
  });

  it("**되돌릴 수 있다**", async () => {
    // History 로는 돌아온다. 저장하면 끝이라는 것이 destructive 인 이유다.
    const mcp = setup();
    await addLayer(mcp, "A");
    await addLayer(mcp, "B");
    const before = (await listing(mcp)).map((layer) => layer.name);

    await flatten(mcp);
    await mcp.tools.invoke("photoshop.history.undo", {}, { requestId: "r" });

    expect((await listing(mcp)).map((layer) => layer.name)).toEqual(before);
  });
});

describe("닫기", () => {
  it("**discardChanges 를 명시해야 한다**", async () => {
    // 기본값을 두지 않은 것은 이것이 작업을 잃는 선택이기 때문이다.
    await expect(close(setup(), {})).rejects.toThrow();
  });

  it("false 도 거절한다", async () => {
    // 저장하고 닫는 길은 없다 — document.save 를 먼저 부른다.
    await expect(close(setup(), { discardChanges: false })).rejects.toThrow();
  });

  it("닫은 문서를 알려준다", async () => {
    const mcp = setup();
    const document = (await mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" })) as {
      id: number;
      name: string;
    };

    const result = await close(mcp, { discardChanges: true });
    expect(result.closed.id).toBe(document.id);
    expect(result.closed.name).toBe(document.name);
  });

  it("**닫은 뒤에는 조회가 실패한다**", async () => {
    // remainingDocuments 가 0 이면 이후 Command 가 전부 실패한다. 그 사실을
    // 결과로 미리 알 수 있어야 한다.
    const mcp = setup();
    expect((await close(mcp, { discardChanges: true })).remainingDocuments).toBe(0);

    await expect(
      mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" }),
    ).rejects.toThrow();
  });
});
