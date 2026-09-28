import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.smart_object.get_info`. (ROADMAP §54)
 *
 * **DOM 에 스마트 오브젝트 관련 멤버가 하나도 없다** — Adobe Layer 레퍼런스가
 * 그렇다. 다만 batchPlay `get` 은 **읽기만** 하므로 키를 알아내는 데 알림
 * 캡처가 필요 없었다.
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

describe("smart_object.get_info", () => {
  /** 문서를 바꾸지 않는다 — batchPlay `get` 이다. */
  it("**read 다**", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("SMART_OBJECT_GET_INFO")).toBe("read");
    expect(mcp.commands.permissionOf("SMART_OBJECT_CONVERT")).toBe("edit");
  });

  it("**읽기 전용 서버에서도 돈다**", async () => {
    const mcp = setup(["read"]);
    await expect(
      invoke(mcp, "photoshop.smart_object.get_info", { layerId: 10 }),
    ).resolves.toBeTruthy();
  });

  /**
   * **스마트 오브젝트가 아니면 오류가 아니다.** 먼저 확인하는 용도로 쓸 수
   * 있어야 한다 — 오류로 만들면 호출자가 try/catch 로 분기하게 된다.
   */
  it("**스마트 오브젝트가 아니면 false 를 돌려준다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.smart_object.get_info", {
      layerId: 10,
    })) as { isSmartObject: boolean; linked: unknown; fileReference: unknown };

    expect(result.isSmartObject).toBe(false);
    expect(result.linked).toBeNull();
    expect(result.fileReference).toBeNull();
  });

  it("**스마트 오브젝트면 true 다**", async () => {
    const mcp = setup();
    const converted = (await invoke(mcp, "photoshop.smart_object.convert", {
      layerId: 10,
    })) as { layer: { id: number } };
    const result = (await invoke(mcp, "photoshop.smart_object.get_info", {
      layerId: converted.layer.id,
    })) as { isSmartObject: boolean };

    expect(result.isSmartObject).toBe(true);
  });

  /**
   * **Mock 은 파일 시스템에 닿는 값을 지어내지 않는다.**
   *
   * `linked` 와 `fileReference` 를 그럴듯하게 채우면 워크플로가 오지 않은
   * 결과를 믿는다. 흉내낼 수 있는 것은 `isSmartObject` 뿐이고 그것만 흉내낸다.
   */
  it("**Mock 은 연결 여부와 경로를 null 로 둔다**", async () => {
    const mcp = setup();
    const converted = (await invoke(mcp, "photoshop.smart_object.convert", {
      layerId: 10,
    })) as { layer: { id: number } };
    const result = (await invoke(mcp, "photoshop.smart_object.get_info", {
      layerId: converted.layer.id,
    })) as {
      linked: unknown;
      fileReference: unknown;
      placed: unknown;
      contentId: unknown;
      raw: unknown;
    };

    expect(result.linked).toBeNull();
    expect(result.fileReference).toBeNull();
    expect(result.placed).toBeNull();
    expect(result.contentId).toBeNull();
    expect(result.raw).toBeNull();
  });

  it("**없는 레이어는 거절한다**", async () => {
    await expect(
      invoke(setup(), "photoshop.smart_object.get_info", { layerId: 9999 }),
    ).rejects.toThrow();
  });

  /** `rasterize` 는 만들지 않았다 — `layer.rasterize` 가 이미 한다. */
  it("**smart_object.rasterize 는 없다** — layer.rasterize 가 그 자리다", () => {
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    expect(names).not.toContain("photoshop.smart_object.rasterize");
    expect(names).toContain("photoshop.layer.rasterize");
  });
});

/**
 * 사본 · 다시 연결 · 업데이트. (ROADMAP §55)
 *
 * descriptor 는 `["all"]` 알림으로 잡았다. **`relink` 이 경로를 인자로 받는
 * 것**이 이 셋을 만들 수 있느냐를 갈랐다 — 안 그랬으면 파일 선택 창이 떠
 * 플러그인이 멈춘다.
 */
describe("smart_object — 사본 · 다시 연결 · 업데이트", () => {
  const smartLayer = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> => {
    const converted = (await invoke(mcp, "photoshop.smart_object.convert", {
      layerId: 10,
    })) as { layer: { id: number } };
    return converted.layer.id;
  };

  it("**권한이 갈린다** — relink 만 external 이다", () => {
    const mcp = setup(["read", "edit", "external"]);
    expect(mcp.commands.permissionOf("SMART_OBJECT_NEW_VIA_COPY")).toBe("edit");
    expect(mcp.commands.permissionOf("SMART_OBJECT_UPDATE")).toBe("edit");
    /* 승인된 폴더의 파일을 읽어 들인다 — `layer.place` 와 같다. */
    expect(mcp.commands.permissionOf("SMART_OBJECT_RELINK")).toBe("external");
  });

  /**
   * **`layer.duplicate` 와 다른 것이 요점이다.** 복제본은 내용을 공유하고
   * 이것은 끊는다 — 실기에서 `contentId` 로 확인했다(§54).
   */
  it("**원본은 남고 새 레이어가 생긴다**", async () => {
    const mcp = setup();
    const id = await smartLayer(mcp);
    const before = ((await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] }).layers
      .length;

    const result = (await invoke(mcp, "photoshop.smart_object.new_via_copy", {
      layerId: id,
    })) as { layer: { id: number; type: string }; sourceId: number };

    expect(result.sourceId).toBe(id);
    expect(result.layer.id).not.toBe(id);
    expect(result.layer.type).toBe("smartObject");

    const after = ((await invoke(mcp, "photoshop.layer.list")) as { layers: unknown[] }).layers
      .length;
    expect(after).toBe(before + 1);
  });

  it("**스마트 오브젝트가 아니면 거절한다**", async () => {
    const mcp = setup();
    await expect(
      invoke(mcp, "photoshop.smart_object.new_via_copy", { layerId: 10 }),
    ).rejects.toThrow();
  });

  /** 승인된 폴더 밖은 애초에 이름으로도 줄 수 없다. */
  it("**relink 는 경로를 받지 않는다**", async () => {
    const mcp = setup(["read", "edit", "external"]);
    const id = await smartLayer(mcp);
    for (const filename of ["../x.tif", "sub/x.tif", "C:\\x.tif"]) {
      await expect(
        invoke(mcp, "photoshop.smart_object.relink", { layerId: id, filename }),
      ).rejects.toThrow();
    }
  });

  it("**relink 는 폴더 승인과 파일 존재를 요구한다**", async () => {
    const mcp = setup(["read", "edit", "external"]);
    const id = await smartLayer(mcp);
    await expect(
      invoke(mcp, "photoshop.smart_object.relink", { layerId: id, filename: "none.tif" }),
    ).rejects.toThrow();
  });

  /**
   * **문서 전체다.** Photoshop 의 이 명령이 원래 `Update All Modified Smart
   * Objects` 이고 레이어를 고르는 인자가 없다 — 있는 척하면 호출자가 한 레이어만
   * 도는 줄 안다.
   */
  it("**update 는 레이어를 고르지 않는다**", async () => {
    const mcp = setup();
    const result = (await invoke(mcp, "photoshop.smart_object.update")) as {
      documentId: number;
    };
    expect(typeof result.documentId).toBe("number");

    await expect(invoke(mcp, "photoshop.smart_object.update", { layerId: 10 })).rejects.toThrow();
  });
});

/**
 * **`contentId` 해석을 §55 에서 정정했다.**
 *
 * §54 에서 "복제본과 같고 별개와 다르다" 를 보고 "내용을 공유한다" 로 읽었는데,
 * 같은 파일로 만든 둘을 `new_via_copy` 로 갈라 놓아도 값이 같았다. 그 값은
 * **내용의 출처**를 가리킨다 — 관측은 맞았고 해석이 틀렸다.
 *
 * Mock 은 `contentId` 를 모르므로(파일에서 온다) 여기서는 **설명이 그 잘못된
 * 주장을 다시 담지 않는 것**을 고정한다.
 */
describe("contentId 설명 — 공유 판정으로 쓰지 않는다", () => {
  it("**Tool 설명이 contentId 를 공유 판정으로 말하지 않는다**", () => {
    const mcp = setup();
    const byName = new Map(mcp.tools.list().map((tool) => [tool.name, tool.description]));

    const copy = byName.get("photoshop.smart_object.new_via_copy") ?? "";
    expect(copy).toContain("contentId 로는 끊겼는지 확인할 수 없다");

    const info = byName.get("photoshop.smart_object.get_info") ?? "";
    expect(info).toContain("어디서 온 내용인가");
    /* 깨진 연결을 재는 방법을 함께 준다 — 경고만 하고 수단을 안 주지 않는다. */
    expect(info).toContain("linkMissing");
  });
});
