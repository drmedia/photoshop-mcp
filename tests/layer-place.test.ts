import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  type LayerInfo,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * `photoshop.layer.place` — 외부 처리 결과를 Photoshop 으로 되돌리는 길.
 *
 * Phase 8 에서 "내보내기 → 외부 처리" 까지는 이어졌지만 돌아오는 길이 없었다.
 * 이것이 있어야 Capability 가 쓸모를 갖는다.
 */

const denied = expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED });

function setup(options: { workspace?: string | null } = {}): {
  mcp: ReturnType<typeof createPhotoshopMcp>;
  bridge: MockPhotoshopBridge;
} {
  // `?? ` 를 쓰면 null 을 넘겨도 기본값이 들어가 승인 전 상태를 만들 수 없다.
  const bridge = new MockPhotoshopBridge({
    workspacePath: options.workspace === undefined ? "C:/작업" : options.workspace,
  });
  const mcp = createPhotoshopMcp({
    bridge,
    policy: new PermissionPolicy(["read", "edit", "external"]),
  });
  return { mcp, bridge };
}

const call = async <T>(
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  input: unknown = {},
): Promise<T> => mcp.tools.invoke<T>(name, input, { requestId: "req-place" });

describe("권한", () => {
  it("external 이므로 기본 정책에서는 막힌다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({ workspacePath: "C:/작업" }),
    });
    await expect(call(mcp, "photoshop.layer.place", { filename: "a.png" })).rejects.toThrow(denied);
  });

  it("export 와 같은 등급이다", () => {
    // 하나는 쓰기로, 하나는 읽기로 Photoshop 경계를 넘는다.
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    expect(mcp.tools.get("photoshop.layer.place")?.permission).toBe("external");
    expect(mcp.tools.get("photoshop.document.export")?.permission).toBe("external");
  });
});

describe("작업 폴더 제약", () => {
  it("승인 전에는 WORKSPACE_NOT_APPROVED", async () => {
    const { mcp } = setup({ workspace: null });
    await expect(call(mcp, "photoshop.layer.place", { filename: "a.png" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_APPROVED, recoverable: true }),
    );
  });

  it("폴더에 없는 파일은 FILE_NOT_FOUND", async () => {
    const { mcp } = setup();
    await expect(call(mcp, "photoshop.layer.place", { filename: "없음.png" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.FILE_NOT_FOUND, recoverable: true }),
    );
  });

  it("경로를 넣으면 거부한다", async () => {
    const { mcp, bridge } = setup();
    bridge.addExistingFile("결과.png");
    for (const bad of ["../결과.png", "C:/다른곳/결과.png", "하위/결과.png", ".."]) {
      await expect(
        call(mcp, "photoshop.layer.place", { filename: bad }),
        `${bad} 가 통과했습니다`,
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });
});

describe("가져오기", () => {
  it("스마트 오브젝트 레이어로 들어간다", async () => {
    // 원본 픽셀을 덮어쓰지 않는다. 비파괴 원칙과 맞는다.
    const { mcp, bridge } = setup();
    bridge.addExistingFile("처리결과.png");

    await expect(
      call<LayerInfo>(mcp, "photoshop.layer.place", { filename: "처리결과.png" }),
    ).resolves.toMatchObject({ name: "처리결과.png", type: "smartObject", visible: true });
  });

  it("이름을 지정할 수 있다", async () => {
    const { mcp, bridge } = setup();
    bridge.addExistingFile("out.tif");

    await expect(
      call<LayerInfo>(mcp, "photoshop.layer.place", { filename: "out.tif", name: "별 제거본" }),
    ).resolves.toMatchObject({ name: "별 제거본" });
  });

  it("활성 레이어 바로 위에 놓인다", async () => {
    // 문서 맨 위가 아니다. 처음에는 맨 위에 놓는 것으로 만들었다가 실기에서 어긋났다.
    const { mcp, bridge } = setup();
    bridge.addExistingFile("a.png");

    const { layers: before } = await call<{ layers: LayerInfo[] }>(mcp, "photoshop.layer.list");
    const anchor = before[1] as LayerInfo;
    await call(mcp, "photoshop.layer.select", { layerId: anchor.id });

    const placed = await call<LayerInfo>(mcp, "photoshop.layer.place", { filename: "a.png" });
    const { layers: after } = await call<{ layers: LayerInfo[] }>(mcp, "photoshop.layer.list");

    expect(after.findIndex((layer) => layer.id === placed.id)).toBe(1);
    expect(after[2]?.id).toBe(anchor.id);
  });

  it("활성 레이어가 되어 이후 편집의 대상이 된다", async () => {
    const { mcp, bridge } = setup();
    bridge.addExistingFile("a.png");

    const placed = await call<LayerInfo>(mcp, "photoshop.layer.place", { filename: "a.png" });
    await expect(
      call<LayerInfo>(mcp, "photoshop.layer.rename", { name: "확인" }),
    ).resolves.toMatchObject({ id: placed.id });
  });

  it("활성 레이어의 불투명도를 물려받는다", async () => {
    // 실기에서 확인했다. 기준 40 → 결과 40.
    const { mcp, bridge } = setup();
    bridge.addExistingFile("a.png");

    const base = await call<LayerInfo>(mcp, "photoshop.layer.create", { name: "기준" });
    await call(mcp, "photoshop.layer.set_opacity", { layerId: base.id, opacity: 40 });
    await call(mcp, "photoshop.layer.select", { layerId: base.id });

    await expect(
      call<LayerInfo>(mcp, "photoshop.layer.place", { filename: "a.png" }),
    ).resolves.toMatchObject({ opacity: 40 });
  });

  it("활성 레이어가 그룹 안이면 같은 그룹으로 들어간다", async () => {
    const { mcp, bridge } = setup();
    bridge.addExistingFile("a.png");

    const group = await call<LayerInfo>(mcp, "photoshop.group.create", { name: "묶음" });
    const target = await call<LayerInfo>(mcp, "photoshop.layer.create", { name: "안쪽" });
    await call(mcp, "photoshop.group.move_layer", { layerId: target.id, groupId: group.id });
    await call(mcp, "photoshop.layer.select", { layerId: target.id });

    await expect(
      call<LayerInfo>(mcp, "photoshop.layer.place", { filename: "a.png" }),
    ).resolves.toMatchObject({ parentId: group.id });
  });

  it("undo 로 되돌릴 수 있다", async () => {
    const { mcp, bridge } = setup();
    bridge.addExistingFile("a.png");
    const before = (await call<{ layers: LayerInfo[] }>(mcp, "photoshop.layer.list")).layers.length;

    await call(mcp, "photoshop.layer.place", { filename: "a.png" });
    await call(mcp, "photoshop.history.undo");

    const after = (await call<{ layers: LayerInfo[] }>(mcp, "photoshop.layer.list")).layers.length;
    expect(after).toBe(before);
  });
});

describe("Phase 8 과 이어지는 흐름", () => {
  it("내보내기 → (외부 처리) → 되돌리기", async () => {
    // 외부 처리기가 만든 파일을 다시 가져오는 왕복을 확인한다.
    const { mcp, bridge } = setup();

    const exported = await call<{ filename: string }>(mcp, "photoshop.document.export", {
      filename: "원본",
    });
    expect(exported.filename).toBe("원본.png");

    // 외부 처리기가 결과를 만들었다고 가정한다.
    bridge.addExistingFile("원본-처리됨.png");

    const placed = await call<LayerInfo>(mcp, "photoshop.layer.place", {
      filename: "원본-처리됨.png",
      name: "그래디언트 제거",
    });

    const { layers } = await call<{ layers: LayerInfo[] }>(mcp, "photoshop.layer.list");
    expect(layers[0]).toMatchObject({ id: placed.id, name: "그래디언트 제거" });
  });
});
