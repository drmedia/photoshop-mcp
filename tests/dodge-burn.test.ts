import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  DEFAULT_MOCK_DOCUMENT,
  MockPhotoshopBridge,
  PermissionPolicy,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";
import { featherFor } from "../photoshop-uxp/src/dom/dodge-burn-geometry.js";

/**
 * 닷징 · 버닝. (ROADMAP §17.31)
 *
 * Mock 에는 픽셀이 없으므로 실제로 칠하는 경로는 여기서 검증되지 않는다.
 * 고정하는 것은 **무엇을 거절하는가** 와 페더 계산이다 — 이 Command 에서
 * 위험한 자리가 거기다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const dab = (x: number, y: number, radius: number, strength = 15): Record<string, number> => ({
  x,
  y,
  radius,
  strength,
});

const run = async (mcp: Mcp, args: Record<string, unknown>): Promise<unknown> =>
  mcp.tools.invoke("photoshop.dodge_burn.dab", args, { requestId: "r" });

/** 배경이 아닌 픽셀 레이어를 만들어 활성으로 둔다. */
async function paintable(mcp: Mcp): Promise<number> {
  const created = (await mcp.tools.invoke(
    "photoshop.layer.create",
    { name: "닷징" },
    { requestId: "r" },
  )) as { id: number };
  return created.id;
}

describe("permission", () => {
  it("edit 이다", () => {
    // 배경을 거절하므로 바뀌는 것은 사용자가 이 용도로 만든 레이어뿐이다.
    expect(setup().tools.get("photoshop.dodge_burn.dab")?.permission).toBe("edit");
  });

  it("읽기 전용 서버에서는 막힌다", async () => {
    const mcp = setup(["read"]);
    await expect(run(mcp, { dabs: [dab(100, 100, 50)], mode: "dodge" })).rejects.toThrow(
      /권한|permission/iu,
    );
  });
});

describe("페더 계산", () => {
  it("경도 0 이면 반지름만큼 부드럽다", () => {
    expect(featherFor(100, 0)).toBe(100);
  });

  it("경도가 오르면 좁아진다", () => {
    expect(featherFor(100, 50)).toBe(50);
    expect(featherFor(100, 80)).toBeCloseTo(20, 6);
  });

  it("**경도 100 이면 페더를 걸지 않는다**", () => {
    // Photoshop 은 반지름 0 의 페더를 거절한다. 0 을 돌려주면 호출자가 건너뛴다.
    expect(featherFor(100, 100)).toBe(0);
  });

  it("너무 작은 값도 0 으로 접는다", () => {
    // 0.1 미만은 Photoshop 이 받지 않는다. 경계에서 조용히 실패하지 않게 한다.
    expect(featherFor(1, 99.5)).toBe(0);
  });
});

describe("**대상 레이어를 가린다**", () => {
  it("배경 레이어를 거절한다", async () => {
    // 원본 픽셀을 직접 밝히거나 어둡게 하는 작업이라 되돌릴 수 없다.
    const mcp = setup();
    await expect(run(mcp, { dabs: [dab(100, 100, 50)], mode: "dodge" })).rejects.toThrow(
      /배경 레이어/u,
    );
  });

  it("무엇을 하라고 말한다", async () => {
    // "거절합니다" 만으로는 호출자가 할 수 있는 일이 없다.
    const mcp = setup();
    await expect(run(mcp, { dabs: [dab(100, 100, 50)], mode: "dodge" })).rejects.toThrow(
      /layer\.create|softLight/u,
    );
  });

  it("없는 레이어를 거절한다", async () => {
    await expect(
      run(setup(), { dabs: [dab(100, 100, 50)], mode: "dodge", layerId: 99999 }),
    ).rejects.toThrow(/찾을 수 없/u);
  });
});

describe("칠하기", () => {
  it("빈 픽셀 레이어에 찍힌다", async () => {
    const mcp = setup();
    const layerId = await paintable(mcp);
    const result = (await run(mcp, {
      dabs: [dab(100, 100, 50)],
      mode: "dodge",
      layerId,
    })) as { applied: number; layer: { id: number } };

    expect(result.applied).toBe(1);
    expect(result.layer.id).toBe(layerId);
  });

  it("여러 얼룩을 한 번에 받는다", async () => {
    // 하나씩 받으면 얼룩 스무 개에 호출이 스무 번이고 그 사이 활성 레이어가 바뀔 틈이 생긴다.
    const mcp = setup();
    const layerId = await paintable(mcp);
    const result = (await run(mcp, {
      dabs: [dab(100, 100, 50), dab(200, 200, 80), dab(300, 300, 30)],
      mode: "burn",
      layerId,
    })) as { applied: number };
    expect(result.applied).toBe(3);
  });

  it("**선택을 남기지 않는다**", async () => {
    // 남기면 다음 Command 가 조용히 그 범위에만 걸린다.
    const mcp = setup();
    const layerId = await paintable(mcp);
    await run(mcp, { dabs: [dab(100, 100, 50)], mode: "dodge", layerId });

    const state = (await mcp.tools.invoke("photoshop.document.get", {}, { requestId: "r" })) as {
      selection?: { hasSelection?: boolean };
    };
    expect(state.selection?.hasSelection ?? false).toBe(false);
  });
});

describe("문서 밖", () => {
  it("**범위를 벗어난 얼룩을 거절한다**", async () => {
    // 빈 선택에 채우기를 걸면 Photoshop 이 원인을 알 수 없는 메시지로 거절한다.
    const mcp = setup();
    const layerId = await paintable(mcp);
    const outside = DEFAULT_MOCK_DOCUMENT.width + 500;
    await expect(
      run(mcp, { dabs: [dab(outside, 100, 50)], mode: "dodge", layerId }),
    ).rejects.toThrow(/문서|밖/u);
  });

  it("문서 크기를 오류에 담는다", async () => {
    const mcp = setup();
    const layerId = await paintable(mcp);
    const outside = DEFAULT_MOCK_DOCUMENT.width + 500;
    await expect(
      run(mcp, { dabs: [dab(outside, 100, 50)], mode: "dodge", layerId }),
    ).rejects.toThrow(new RegExp(String(DEFAULT_MOCK_DOCUMENT.width), "u"));
  });
});

describe("스키마", () => {
  it("mode 를 요구한다", async () => {
    await expect(run(setup(), { dabs: [dab(100, 100, 50)] })).rejects.toThrow();
  });

  it("모르는 mode 를 거절한다", async () => {
    await expect(run(setup(), { dabs: [dab(100, 100, 50)], mode: "sponge" })).rejects.toThrow();
  });

  it("빈 목록을 거절한다", async () => {
    await expect(run(setup(), { dabs: [], mode: "dodge" })).rejects.toThrow();
  });

  it("강도 범위를 지킨다", async () => {
    const mcp = setup();
    const layerId = await paintable(mcp);
    await expect(
      run(mcp, { dabs: [dab(100, 100, 50, 0)], mode: "dodge", layerId }),
    ).rejects.toThrow();
    await expect(
      run(mcp, { dabs: [dab(100, 100, 50, 101)], mode: "dodge", layerId }),
    ).rejects.toThrow();
  });

  it("모르는 필드를 거절한다", async () => {
    // strict 스키마다. 오타가 조용히 무시되면 호출자가 안 걸린 줄 모른다.
    await expect(
      run(setup(), { dabs: [{ ...dab(100, 100, 50), softness: 10 }], mode: "dodge" }),
    ).rejects.toThrow();
  });
});
