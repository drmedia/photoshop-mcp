import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import { ErrorCode, MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { FORBIDDEN_TOOLS } from "./helpers/expected-tools.js";

/**
 * Phase 3 레이어 편집. (ROADMAP §7.1)
 *
 * Mock Bridge 위에서 Tool → Command Engine → Bridge 경로를 검증한다.
 * 실제 Photoshop DOM 호출은 실기 확인 대상이다.
 */

function setup(): ReturnType<typeof createPhotoshopMcp> & { bridge: MockPhotoshopBridge } {
  const bridge = new MockPhotoshopBridge();
  return { ...createPhotoshopMcp({ bridge }), bridge };
}

const call = async <T = unknown>(
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  input: unknown = {},
): Promise<T> => mcp.tools.invoke<T>(name, input, { requestId: "req-test" });

interface Layer {
  id: number;
  name: string;
  type: string;
  visible: boolean;
  opacity: number;
  parentId: number | null;
}

describe("Phase 3 레이어 편집 Tool", () => {
  it("편집 Tool 6개를 등록한다", () => {
    const { tools, commands } = setup();

    for (const name of [
      "photoshop.layer.create",
      "photoshop.layer.duplicate",
      "photoshop.layer.rename",
      "photoshop.layer.select",
      "photoshop.layer.set_visibility",
      "photoshop.layer.set_opacity",
    ]) {
      expect(tools.list().map((tool) => tool.name)).toContain(name);
    }

    for (const type of [
      "LAYER_CREATE",
      "LAYER_DUPLICATE",
      "LAYER_RENAME",
      "LAYER_SELECT",
      "LAYER_VISIBILITY",
      "LAYER_OPACITY",
    ]) {
      expect(commands.list()).toContain(type);
    }
  });

  it("아직 범위 밖인 Tool 은 등록하지 않는다", () => {
    const names = setup()
      .tools.list()
      .map((tool) => tool.name);
    for (const forbidden of FORBIDDEN_TOOLS) {
      expect(names).not.toContain(forbidden);
    }
  });

  describe("create", () => {
    it("이름을 지정해 레이어를 만들고 맨 위에 넣는다", async () => {
      const mcp = setup();

      const created = await call<Layer>(mcp, "photoshop.layer.create", { name: "New Layer" });
      expect(created).toMatchObject({
        name: "New Layer",
        type: "pixel",
        visible: true,
        opacity: 100,
      });

      const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
      expect(layers[0]?.id).toBe(created.id);
      expect(layers).toHaveLength(4);
    });

    it("이름을 생략할 수 있다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.layer.create")).resolves.toMatchObject({ type: "pixel" });
    });
  });

  describe("duplicate", () => {
    it("layerId 를 생략하면 활성 레이어를 복제한다", async () => {
      const mcp = setup();

      const copy = await call<Layer>(mcp, "photoshop.layer.duplicate");

      // 기본 활성 레이어는 첫 번째(Background).
      expect(copy.name).toBe("Background copy");
      expect(copy.id).not.toBe(10);
      await expect(call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).resolves.toMatchObject({
        layers: expect.arrayContaining([expect.objectContaining({ id: copy.id })]),
      });
    });

    it("지정한 레이어를 이름과 함께 복제한다", async () => {
      const mcp = setup();

      const copy = await call<Layer>(mcp, "photoshop.layer.duplicate", {
        layerId: 11,
        name: "Curves copy",
      });

      expect(copy).toMatchObject({ name: "Curves copy", type: "adjustment" });
    });
  });

  describe("rename / visibility / opacity", () => {
    it("활성 레이어의 이름을 바꾼다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.layer.rename", { name: "MCP Test" }),
      ).resolves.toMatchObject({ id: 10, name: "MCP Test" });
    });

    it("표시 여부를 바꾼다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.layer.set_visibility", { layerId: 10, visible: false }),
      ).resolves.toMatchObject({ id: 10, visible: false });
    });

    it("불투명도를 바꾼다", async () => {
      const mcp = setup();
      // 배경이 아닌 레이어. 배경은 아래 테스트에서 따로 본다.
      await expect(
        call(mcp, "photoshop.layer.set_opacity", { layerId: 11, opacity: 50 }),
      ).resolves.toMatchObject({ id: 11, opacity: 50 });
    });

    it("배경 레이어는 승격되어 id 와 이름이 바뀐다", async () => {
      // 배경은 반투명할 수 없어 Photoshop 이 일반 레이어로 바꾼다. 실기에서 확인했다.
      // 이때 반환되는 id 는 요청한 것과 다르다 — 호출자는 반환값을 그대로 써야 한다.
      const mcp = setup();
      const result = await call<Layer>(mcp, "photoshop.layer.set_opacity", {
        layerId: 10,
        opacity: 50,
      });

      expect(result.id).not.toBe(10);
      expect(result.opacity).toBe(50);

      const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
      expect(layers.find((layer) => layer.id === 10)).toBeUndefined();
      expect(layers.find((layer) => layer.id === result.id)).toMatchObject({ opacity: 50 });
    });

    it("배경 레이어를 100 으로 두면 승격하지 않는다", async () => {
      // 불투명도가 100 이면 배경으로 있을 수 있다. 괜히 승격시키지 않는다.
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.layer.set_opacity", { layerId: 10, opacity: 100 }),
      ).resolves.toMatchObject({ id: 10, opacity: 100 });
    });

    it("변경이 목록에 반영된다", async () => {
      const mcp = setup();
      await call(mcp, "photoshop.layer.set_opacity", { layerId: 11, opacity: 25 });

      const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
      expect(layers.find((layer) => layer.id === 11)?.opacity).toBe(25);
    });
  });

  describe("select", () => {
    it("활성 레이어를 바꾸면 이후 생략 호출의 대상이 바뀐다", async () => {
      const mcp = setup();

      await call(mcp, "photoshop.layer.select", { layerId: 12 });
      await expect(call(mcp, "photoshop.layer.rename", { name: "선택됨" })).resolves.toMatchObject({
        id: 12,
        name: "선택됨",
      });
    });
  });

  describe("오류", () => {
    it("없는 레이어는 LAYER_NOT_FOUND 를 던진다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.layer.rename", { layerId: 999, name: "x" }),
      ).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND, recoverable: true }),
      );
    });

    it("문서가 없으면 DOCUMENT_NOT_FOUND 를 던진다", async () => {
      const mcp = setup();
      mcp.bridge.setDocument(null);
      await expect(call(mcp, "photoshop.layer.create", { name: "x" })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND }),
      );
    });

    it("불투명도 범위를 벗어나면 INVALID_PARAMETER 를 던진다", async () => {
      const mcp = setup();
      for (const opacity of [-1, 101]) {
        await expect(call(mcp, "photoshop.layer.set_opacity", { opacity })).rejects.toThrow(
          expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
        );
      }
    });

    it("빈 이름은 INVALID_PARAMETER 를 던진다", async () => {
      const mcp = setup();
      await expect(call(mcp, "photoshop.layer.rename", { name: "   " })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    });

    it("스키마에 없는 인자는 거부한다", async () => {
      const mcp = setup();
      await expect(
        call(mcp, "photoshop.layer.rename", { name: "x", unexpected: true }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    });
  });

  it("Phase 3 완료 기준 시나리오: 복제 → 이름 변경 → 불투명도 50%", async () => {
    const mcp = setup();

    const copy = await call<Layer>(mcp, "photoshop.layer.duplicate");
    const renamed = await call<Layer>(mcp, "photoshop.layer.rename", {
      layerId: copy.id,
      name: "MCP Test",
    });
    const final = await call<Layer>(mcp, "photoshop.layer.set_opacity", {
      layerId: renamed.id,
      opacity: 50,
    });

    expect(final).toMatchObject({ id: copy.id, name: "MCP Test", opacity: 50 });

    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers.find((layer) => layer.id === copy.id)).toMatchObject({
      name: "MCP Test",
      opacity: 50,
    });
  });
});

describe("Command Engine 파라미터 검증", () => {
  it("Extension 이 Engine 을 직접 호출해도 검증한다", async () => {
    // Extension 은 Tool 을 거치지 않는다. (ARCHITECTURE §3.2)
    const mcp = setup();

    await expect(
      mcp.engine.execute({ type: "LAYER_OPACITY", params: { opacity: 500 } }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));

    await expect(
      mcp.engine.execute({ type: "LAYER_RENAME", params: { layerId: "열" } }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("검증을 통과한 파라미터는 그대로 전달된다", async () => {
    const mcp = setup();

    await expect(
      mcp.engine.execute({ type: "LAYER_OPACITY", params: { layerId: 11, opacity: 33 } }),
    ).resolves.toMatchObject({ id: 11, opacity: 33 });
  });

  it("파라미터 없는 Command 는 스키마 없이도 동작한다", async () => {
    const mcp = setup();
    await expect(mcp.engine.execute({ type: "LAYER_LIST", params: {} })).resolves.toHaveLength(3);
  });
});

describe("Phase 3 그룹 Tool", () => {
  it("그룹 Tool 2개를 등록한다", () => {
    const { tools, commands } = setup();

    expect(tools.list().map((tool) => tool.name)).toContain("photoshop.group.create");
    expect(tools.list().map((tool) => tool.name)).toContain("photoshop.group.move_layer");
    expect(commands.list()).toContain("GROUP_CREATE");
    expect(commands.list()).toContain("GROUP_MOVE_LAYER");
  });

  it("빈 그룹을 만든다", async () => {
    const mcp = setup();

    const group = await call<Layer>(mcp, "photoshop.group.create", { name: "My Group" });

    expect(group).toMatchObject({ name: "My Group", type: "group", parentId: null });
    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers[0]?.id).toBe(group.id);
  });

  it("레이어를 넣어 그룹을 만들면 parentId 가 설정된다", async () => {
    const mcp = setup();

    const group = await call<Layer>(mcp, "photoshop.group.create", {
      name: "Sky",
      layerIds: [10, 11],
    });

    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers.find((layer) => layer.id === 10)?.parentId).toBe(group.id);
    expect(layers.find((layer) => layer.id === 11)?.parentId).toBe(group.id);
    // 넣지 않은 레이어는 그대로다.
    expect(layers.find((layer) => layer.id === 12)?.parentId).toBeNull();
  });

  it("없는 레이어를 넣으려 하면 그룹을 만들지 않는다", async () => {
    const mcp = setup();

    await expect(
      call(mcp, "photoshop.group.create", { name: "x", layerIds: [10, 999] }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND }));

    // 부분 적용되지 않았다.
    const { layers } = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(layers).toHaveLength(3);
    expect(layers.find((layer) => layer.id === 10)?.parentId).toBeNull();
  });

  it("레이어를 그룹으로 옮기고 다시 꺼낸다", async () => {
    const mcp = setup();
    const group = await call<Layer>(mcp, "photoshop.group.create", { name: "G" });

    const moved = await call<Layer>(mcp, "photoshop.group.move_layer", {
      layerId: 12,
      groupId: group.id,
    });
    expect(moved).toMatchObject({ id: 12, parentId: group.id });

    const out = await call<Layer>(mcp, "photoshop.group.move_layer", {
      layerId: 12,
      groupId: null,
    });
    expect(out).toMatchObject({ id: 12, parentId: null });
  });

  it("자기 자신 안으로 옮길 수 없다", async () => {
    const mcp = setup();
    const group = await call<Layer>(mcp, "photoshop.group.create", { name: "G" });

    await expect(
      call(mcp, "photoshop.group.move_layer", { layerId: group.id, groupId: group.id }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("없는 그룹으로 옮기면 LAYER_NOT_FOUND 를 던진다", async () => {
    const mcp = setup();
    await expect(
      call(mcp, "photoshop.group.move_layer", { layerId: 10, groupId: 999 }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.LAYER_NOT_FOUND }));
  });

  it("groupId 는 필수다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.group.move_layer", { layerId: 10 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});

describe("Phase 3 History", () => {
  it("history.undo Tool 을 등록한다", () => {
    const { tools, commands } = setup();
    expect(tools.list().map((tool) => tool.name)).toContain("photoshop.history.undo");
    expect(commands.list()).toContain("HISTORY_UNDO");
  });

  it("직전 편집을 되돌린다", async () => {
    const mcp = setup();

    await call(mcp, "photoshop.layer.rename", { layerId: 10, name: "바뀐 이름" });
    const before = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(before.layers.find((layer) => layer.id === 10)?.name).toBe("바뀐 이름");

    await expect(call(mcp, "photoshop.history.undo")).resolves.toMatchObject({
      currentState: "Rename layer",
    });

    const after = await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list");
    expect(after.layers.find((layer) => layer.id === 10)?.name).toBe("Background");
  });

  it("여러 단계를 차례로 되돌린다", async () => {
    const mcp = setup();

    await call(mcp, "photoshop.layer.create", { name: "A" });
    await call(mcp, "photoshop.layer.create", { name: "B" });
    expect((await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).layers).toHaveLength(5);

    await call(mcp, "photoshop.history.undo");
    expect((await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).layers).toHaveLength(4);

    await call(mcp, "photoshop.history.undo");
    expect((await call<{ layers: Layer[] }>(mcp, "photoshop.layer.list")).layers).toHaveLength(3);
  });

  it("되돌릴 것이 없으면 HISTORY_EMPTY 를 던진다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.history.undo")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.HISTORY_EMPTY, recoverable: true }),
    );
  });

  it("인자를 받지 않는다", async () => {
    const mcp = setup();
    await expect(call(mcp, "photoshop.history.undo", { steps: 3 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});
