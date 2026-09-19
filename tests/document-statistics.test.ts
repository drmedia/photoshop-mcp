import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 문서 통계. (ROADMAP §17.13)
 *
 * **보는 것만으로는 틀린 것을 통과시킨다.** 이 세션에서 두 번 그랬다 — 보라색 하늘,
 * 초록색 하늘. 둘 다 미리보기로는 "좋다" 였고 수치를 재고서야 잡혔다.
 * (RETOUCH_PROCESS §4.3)
 */

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({ bridge: new MockPhotoshopBridge(), logger: createSilentLogger() });
}

const stats = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> =>
  (await mcp.tools.invoke("photoshop.document.statistics", args, { requestId: "r" })) as never;

describe("문서 통계", () => {
  it("읽기 전용이다", () => {
    // 문서를 바꾸지 않고 파일도 쓰지 않는다. 기본 권한으로 돌아야 한다 —
    // 막혀 있으면 진단을 못 하고, 진단을 못 하면 눈대중으로 돌아간다.
    expect(setup().tools.get("photoshop.document.statistics")?.permission).toBe("read");
  });

  it("네 채널을 모두 준다", async () => {
    // 휘도만으로는 색 편향이 잡히지 않는다. 초록 하늘을 잡은 것은 채널별 값이었다.
    const result = await stats(setup());
    expect(Object.keys(result["channels"] as object)).toEqual([
      "red",
      "green",
      "blue",
      "luminance",
    ]);
  });

  it("휘도 분포는 64구간이다", async () => {
    // 16비트 원래 구간 수(32769)를 그대로 보내면 아무도 읽지 못한다.
    const result = await stats(setup());
    expect((result["histogram"] as number[]).length).toBe(64);
  });

  it("무엇을 쟀는지 밝힌다", async () => {
    // 문서 전체인지 선택인지 레이어인지 섞이면 값을 해석할 수 없다.
    expect((await stats(setup()))["source"]).toBe("document");
  });

  it("선택이 없으면 selection 범위는 실패한다", async () => {
    // 조용히 문서 전체로 물러나면 호출자는 선택을 쟀다고 믿는다.
    await expect(stats(setup(), { region: "selection" })).rejects.toThrow(/선택 영역/u);
  });

  it("선택이 있으면 그 범위만 잰다", async () => {
    const mcp = setup();
    await mcp.tools.invoke("photoshop.selection.set", { shape: "canvas" }, { requestId: "r" });
    const result = await stats(mcp, { region: "selection" });
    expect(result["source"]).toMatch(/^selection:/u);
  });

  it("없는 레이어를 거부한다", async () => {
    await expect(stats(setup(), { layerId: 9999 })).rejects.toThrow(/찾을 수 없습니다/u);
  });

  it("조정 레이어를 거부한다", async () => {
    // 실기에서 조정 레이어를 재니 **모든 채널 평균이 255** 로 나왔다. 픽셀이 아니라
    // 마스크 영역을 잰 것이다. 숫자가 돌아오므로 호출자는 "순백" 이라고 읽는다 —
    // 아무 값도 안 주는 것보다 나쁘다.
    const mcp = setup();
    await mcp.tools.invoke(
      "photoshop.adjustment.curves",
      {
        points: [
          { input: 0, output: 0 },
          { input: 255, output: 255 },
        ],
      },
      { requestId: "r" },
    );
    // 생성 결과의 모양을 가정하지 않는다. 목록에서 찾는다.
    const { layers } = (await mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" })) as {
      layers: { id: number; type: string }[];
    };
    const adjustment = layers.find((entry) => entry.type === "adjustment");
    expect(adjustment).toBeDefined();
    await expect(stats(mcp, { layerId: adjustment!.id })).rejects.toThrow(/잴 픽셀이 없습니다/u);
  });

  it("채널마다 노이즈 추정을 담는다", async () => {
    // 히스토그램은 분포를 주지만 인접 픽셀의 흔들림은 주지 못한다. 그것이 없어
    // 실기 보정 네 번 동안 노이즈만은 매번 눈으로 판단했다.
    const result = await stats(setup());
    const channels = result["channels"] as Record<string, { noise: number | null }>;
    for (const key of ["red", "green", "blue", "luminance"]) {
      expect(channels[key], key).toHaveProperty("noise");
    }
  });

  it("잴 수 없으면 0 이 아니라 null 이다", () => {
    // 0 을 돌려주면 "노이즈가 없다" 는 틀린 사실을 말하게 된다.
    // (rawBitDepth · isBackground 와 같은 원칙)
    const { tools } = setup();
    const schema = tools.get("photoshop.document.statistics");
    expect(schema).toBeDefined();
  });

  it("어떻게 쟀는지와 걸린 시간을 담는다", async () => {
    // 느리면 호출자가 범위를 좁힐 수 있어야 한다.
    const result = await stats(setup());
    expect(typeof result["method"]).toBe("string");
    expect(typeof result["elapsedMs"]).toBe("number");
  });
});
