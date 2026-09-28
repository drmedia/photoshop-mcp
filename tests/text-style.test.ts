import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import {
  TextSetLeadingParamsSchema,
  TextSetParagraphParamsSchema,
  TextSetTrackingParamsSchema,
  TextWarpParamsSchema,
} from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 텍스트 세부 — 자간 · 행간 · 단락 · 워프 · 변환. (ROADMAP §60)
 *
 * `text.create` · `text.set` 이 **워터마크·서명 범위**였고(§17.33) 나머지는
 * `CORE_API.md` §5.12 에 "실제 요구가 확인된 뒤에 연다" 로 남아 있었다.
 *
 * **전부 DOM 이다** — `TextItem`(24.1+) 의 세 스타일 객체와 변환 메서드 셋.
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

const makeText = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<number> => {
  const created = (await invoke(mcp, "photoshop.text.create", {
    contents: "서명",
    x: 10,
    y: 20,
  })) as { layer: { id: number } };
  return created.layer.id;
};

describe("text — 자간 · 행간 · 단락 · 워프 · 변환", () => {
  /** 글자를 벡터로 굳히는 것만 되돌릴 수 없다. */
  it("**convert_to_shape 만 destructive 다**", () => {
    const mcp = setup();
    expect(mcp.commands.permissionOf("TEXT_GET")).toBe("read");
    for (const type of [
      "TEXT_SET_TRACKING",
      "TEXT_SET_LEADING",
      "TEXT_SET_PARAGRAPH",
      "TEXT_WARP",
      "TEXT_CONVERT_TO_POINT",
      "TEXT_CONVERT_TO_PARAGRAPH",
    ]) {
      expect(mcp.commands.permissionOf(type)).toBe("edit");
    }
    expect(mcp.commands.permissionOf("TEXT_CONVERT_TO_SHAPE")).toBe("destructive");
  });

  it("**텍스트가 아닌 레이어는 거절한다**", async () => {
    const mcp = setup();
    const layer = (await invoke(mcp, "photoshop.layer.create", { name: "P" })) as { id: number };
    await expect(invoke(mcp, "photoshop.text.get", { layerId: layer.id })).rejects.toThrow(
      /텍스트가 아닙니다/u,
    );
  });

  /** 결과는 요청값이 아니라 건 뒤 다시 읽은 전체 상태다. */
  it("**자간이 들어가고 읽힌다**", async () => {
    const mcp = setup();
    const id = await makeText(mcp);
    const result = (await invoke(mcp, "photoshop.text.set_tracking", {
      layerId: id,
      tracking: 200,
    })) as { character: { tracking: number } };
    expect(result.character.tracking).toBe(200);
  });

  /**
   * **자동 행간이 켜져 있으면 `leading` 을 넣어도 화면이 안 바뀐다.**
   * 그래서 `leading` 만 주면 플러그인이 먼저 끈다 — "넣었는데 아무 일도 없는"
   * 상태를 만들지 않는다.
   */
  it("**leading 만 주면 자동 행간을 먼저 끈다**", async () => {
    const mcp = setup();
    const id = await makeText(mcp);

    const before = (await invoke(mcp, "photoshop.text.get", { layerId: id })) as {
      character: { useAutoLeading: boolean };
    };
    expect(before.character.useAutoLeading).toBe(true);

    const after = (await invoke(mcp, "photoshop.text.set_leading", {
      layerId: id,
      leading: 36,
    })) as { character: { leading: number; useAutoLeading: boolean } };
    expect(after.character.leading).toBe(36);
    expect(after.character.useAutoLeading).toBe(false);

    /* auto 를 켜 달라고 하면 켠다. */
    const auto = (await invoke(mcp, "photoshop.text.set_leading", {
      layerId: id,
      auto: true,
    })) as { character: { useAutoLeading: boolean } };
    expect(auto.character.useAutoLeading).toBe(true);
  });

  it("**leading 과 auto 중 최소 하나는 있어야 한다**", () => {
    expect(TextSetLeadingParamsSchema.safeParse({}).success).toBe(false);
    expect(TextSetLeadingParamsSchema.safeParse({ leading: 20 }).success).toBe(true);
    expect(TextSetLeadingParamsSchema.safeParse({ auto: true }).success).toBe(true);
  });

  it("**단락은 바꿀 항목을 최소 하나 받는다**", () => {
    expect(TextSetParagraphParamsSchema.safeParse({}).success).toBe(false);
    expect(TextSetParagraphParamsSchema.safeParse({ layerId: 1 }).success).toBe(false);
    expect(TextSetParagraphParamsSchema.safeParse({ justification: "center" }).success).toBe(true);
  });

  it("**단락 설정이 들어가고 읽힌다**", async () => {
    const mcp = setup();
    const id = await makeText(mcp);
    const result = (await invoke(mcp, "photoshop.text.set_paragraph", {
      layerId: id,
      justification: "fullyJustified",
      spaceBefore: 12,
      hyphenation: true,
    })) as {
      paragraph: { justification: string; spaceBefore: number; hyphenation: boolean };
    };
    expect(result.paragraph).toMatchObject({
      justification: "fullyJustified",
      spaceBefore: 12,
      hyphenation: true,
    });
  });

  /** `none` 은 워프를 푸는 값이라 style 이 필수다. */
  it("**워프는 style 이 필수이고 none 으로 푼다**", async () => {
    expect(TextWarpParamsSchema.safeParse({ bend: 30 }).success).toBe(false);
    expect(TextWarpParamsSchema.safeParse({ style: "wobble" }).success).toBe(false);

    const mcp = setup();
    const id = await makeText(mcp);
    const bent = (await invoke(mcp, "photoshop.text.warp", {
      layerId: id,
      style: "arc",
      bend: 40,
    })) as { warp: { style: string; bend: number } };
    expect(bent.warp).toMatchObject({ style: "arc", bend: 40 });

    const flat = (await invoke(mcp, "photoshop.text.warp", { layerId: id, style: "none" })) as {
      warp: { style: string };
    };
    expect(flat.warp.style).toBe("none");
  });

  it("**단위 범위를 벗어나면 거절한다**", () => {
    /* tracking 은 1/1000 em, 레퍼런스 범위 −1000~1000. */
    expect(TextSetTrackingParamsSchema.safeParse({ tracking: 1001 }).success).toBe(false);
    expect(TextSetTrackingParamsSchema.safeParse({ tracking: -1000 }).success).toBe(true);
    /* leading 은 0~4999.99. */
    expect(TextSetLeadingParamsSchema.safeParse({ leading: -1 }).success).toBe(false);
    /* bend 는 −100~100. */
    expect(TextWarpParamsSchema.safeParse({ style: "arc", bend: 101 }).success).toBe(false);
  });

  it("**점 텍스트와 단락 텍스트를 오간다**", async () => {
    const mcp = setup();
    const id = await makeText(mcp);
    const toParagraph = (await invoke(mcp, "photoshop.text.convert_to_paragraph", {
      layerId: id,
    })) as { isPointText: boolean; isParagraphText: boolean };
    expect(toParagraph).toMatchObject({ isPointText: false, isParagraphText: true });

    const toPoint = (await invoke(mcp, "photoshop.text.convert_to_point", { layerId: id })) as {
      isPointText: boolean;
    };
    expect(toPoint.isPointText).toBe(true);
  });

  /**
   * **모양으로 굳히면 더는 텍스트가 아니다.** 그 뒤 `text.get` 이 거절하는
   * 것까지가 계약이라 Mock 도 흉내낸다.
   */
  it("**convert_to_shape 뒤에는 텍스트가 아니다**", async () => {
    const mcp = setup();
    const id = await makeText(mcp);
    const shaped = (await invoke(mcp, "photoshop.text.convert_to_shape", { layerId: id })) as {
      layer: { type: string };
      previousType: string;
    };
    expect(shaped.layer.type).toBe("shape");
    expect(shaped.previousType).toBe("text");

    await expect(invoke(mcp, "photoshop.text.get", { layerId: id })).rejects.toThrow(
      /텍스트가 아닙니다/u,
    );
  });

  it("**기본 권한으로는 convert_to_shape 가 막힌다**", async () => {
    const mcp = setup(["read", "edit"]);
    const id = await makeText(mcp);
    await expect(
      invoke(mcp, "photoshop.text.warp", { layerId: id, style: "arc" }),
    ).resolves.toBeTruthy();
    await expect(invoke(mcp, "photoshop.text.convert_to_shape", { layerId: id })).rejects.toThrow();
  });

  /** Mock 은 렌더링을 모른다 — 지어내지 않는다. */
  it("**Mock 은 배치와 폰트를 지어내지 않는다**", async () => {
    const mcp = setup();
    const id = await makeText(mcp);
    const result = (await invoke(mcp, "photoshop.text.get", { layerId: id })) as {
      clickPoint: unknown;
      character: { font: unknown; size: unknown };
    };
    expect(result.clickPoint).toBeNull();
    expect(result.character.font).toBeNull();
    expect(result.character.size).toBeNull();
  });
});
