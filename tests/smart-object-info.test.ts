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
