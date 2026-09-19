import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { findEdge, theilSen, thin, type EdgeSample } from "../photoshop-uxp/src/dom/tilt.js";
import { describe, expect, it } from "vitest";

/**
 * 경계선 기울기 측정. (ROADMAP §17.21)
 *
 * `document.rotate` 를 만들어 놓고 그 입력을 만들 방법이 없어 세 번을 밖에서
 * 쟀다. 그중 **두 번은 돌리지 않는 것이 답이었고**, 그것을 가른 것은 각도가
 * 아니라 잔차였다. 그 판단이 여기에 고정된다.
 */

/** 기울기 `slope`, 절편 `intercept` 인 직선 위의 표본. */
function line(count: number, slope: number, intercept: number): EdgeSample[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    position: slope * index + intercept,
  }));
}

describe("경계 찾기", () => {
  it("밝음 → 어두움 경계를 서브픽셀로 집는다", () => {
    // 정수로 반올림하면 작은 각도가 픽셀 격자에 갇힌다.
    const profile = [100, 100, 100, 100, 100, 60, 20, 20, 20, 20, 20];
    const edge = findEdge(profile, 20, 3);
    // 중간값 60 은 인덱스 5 에 정확히 있다.
    expect(edge).toBeCloseTo(5, 5);
  });

  it("**어두움 → 밝음 경계도 찾는다**", () => {
    // 방향을 짐작하지 않고 양쪽 밝기를 재서 정한다. 역광 실루엣과 밝은 하늘은
    // 순서가 반대다.
    const profile = [20, 20, 20, 20, 20, 60, 100, 100, 100, 100, 100];
    expect(findEdge(profile, 20, 3)).toBeCloseTo(5, 5);
  });

  it("보간으로 정수가 아닌 위치를 낸다", () => {
    const profile = [100, 100, 100, 100, 80, 40, 20, 20, 20, 20, 20];
    const edge = findEdge(profile, 20, 3);
    expect(edge).not.toBeNull();
    // 중간값 60 은 80(index 4) 과 40(index 5) 사이 정확히 가운데다.
    expect(edge).toBeCloseTo(4.5, 5);
  });

  it("**대비가 없으면 null 이다**", () => {
    // 0 을 돌려주면 "맨 위에 경계가 있다" 는 틀린 사실을 말하게 된다.
    expect(findEdge([50, 50, 50, 50, 50, 50, 50, 50, 50, 50], 20, 3)).toBeNull();
  });

  it("너무 짧은 프로파일은 null 이다", () => {
    expect(findEdge([100, 20], 20, 3)).toBeNull();
  });
});

describe("Theil-Sen", () => {
  it("완전한 직선의 기울기를 정확히 낸다", () => {
    const result = theilSen(line(100, -0.0327, 3177), 5);
    expect(result).not.toBeNull();
    expect(result?.slope).toBeCloseTo(-0.0327, 6);
    expect(result?.angleDegrees).toBeCloseTo(-1.873, 3);
    expect(result?.residualIqr).toBeCloseTo(0, 6);
  });

  it("**이상치에 끌려가지 않는다**", () => {
    // 수평선을 재는 자리에는 섬·배·전봇대가 섞인다. 최소제곱이었다면
    // 이 표본들이 기울기를 끌어당겼을 것이다.
    const samples = line(100, -0.03, 3000);
    for (const at of [10, 11, 12, 40, 41, 70]) {
      (samples[at] as EdgeSample).position -= 200;
    }
    const result = theilSen(samples, 5);
    expect(result?.slope).toBeCloseTo(-0.03, 6);
  });

  it("**휜 선은 잔차로 드러난다**", () => {
    // 이것이 실기에서 두 번 오탐을 막은 신호다. 각도는 그럴듯하게 나오지만
    // 잔차가 크다.
    const straight = theilSen(line(200, -0.03, 3000), 10);
    const curved = theilSen(
      line(200, -0.03, 3000).map((sample) => ({
        ...sample,
        // 완만한 호. 각도는 여전히 그럴듯하다.
        position: sample.position + Math.sin((sample.index / 200) * Math.PI) * 40,
      })),
      10,
    );

    expect(straight?.residualIqr).toBeLessThan(0.01);
    expect(curved?.residualIqr).toBeGreaterThan(5);
    // 각도만 봐서는 구분되지 않는다는 것이 요점이다.
    expect(Math.abs(curved?.angleDegrees ?? 0)).toBeGreaterThan(0.5);
  });

  it("잔차를 높이와 함께 준다", () => {
    // 잔차 4px 는 900px 구간에서와 5000px 구간에서 뜻이 다르다. 그래서
    // reliable 같은 판정을 담지 않고 견줄 값을 함께 준다.
    const result = theilSen(line(100, -0.03, 3000), 5);
    expect(result?.spanPixels).toBe(99);
    expect(result?.risePixels).toBeCloseTo(-2.97, 5);
  });

  it("표본이 모자라면 null 이다", () => {
    expect(theilSen([], 1)).toBeNull();
    expect(theilSen([{ index: 0, position: 0 }], 1)).toBeNull();
    // 간격 제한을 넘는 쌍이 하나도 없는 경우.
    expect(theilSen(line(5, 1, 0), 100)).toBeNull();
  });

  it("부호 규약이 rotate 와 같다", () => {
    // 오른쪽이 위로 올라가면(y 가 작아지면) 기울기가 음수이고, 바로잡으려면
    // 시계 방향(양수)으로 돌린다.
    const risingRight = theilSen(line(100, -0.05, 2000), 5);
    expect(risingRight?.angleDegrees).toBeLessThan(0);
  });
});

describe("표본 솎기", () => {
  it("한도 이하면 그대로 둔다", () => {
    expect(thin([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("양 끝을 유지한 채 균등하게 고른다", () => {
    // 999 를 4등분하면 간격이 249.75 다. 반올림해서 749 가 나온다.
    const thinned = thin(
      Array.from({ length: 1000 }, (_, i) => i),
      5,
    );
    expect(thinned).toEqual([0, 250, 500, 749, 999]);
  });

  it("**같은 입력에 같은 답이 나온다**", () => {
    // 무작위로 고르면 같은 사진을 두 번 재서 다른 각도가 나온다.
    const input = Array.from({ length: 3000 }, (_, i) => i);
    expect(thin(input, 500)).toEqual(thin(input, 500));
  });

  it("솎아도 기울기가 유지된다", () => {
    const full = line(3000, -0.0327, 3177);
    const thinned = thin(full, 500);
    expect(theilSen(thinned, 50)?.slope).toBeCloseTo(-0.0327, 6);
  });
});

describe("Tool", () => {
  function setup(): ReturnType<typeof createPhotoshopMcp> {
    return createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read"]),
    });
  }

  it("픽셀을 읽을 뿐이므로 read 다", () => {
    expect(setup().tools.get("photoshop.measure.tilt")?.permission).toBe("read");
  });

  it("문서 밖 영역을 거절한다", async () => {
    await expect(
      setup().tools.invoke(
        "photoshop.measure.tilt",
        { bounds: { left: 0, top: 0, right: 99999, bottom: 100 } },
        { requestId: "r" },
      ),
    ).rejects.toThrow(/벗어납니다/u);
  });

  it("빈 사각형을 거절한다", async () => {
    await expect(
      setup().tools.invoke(
        "photoshop.measure.tilt",
        { bounds: { left: 100, top: 0, right: 100, bottom: 100 } },
        { requestId: "r" },
      ),
    ).rejects.toThrow(/right/u);
  });

  it("**Mock 은 각도를 지어내지 않는다**", async () => {
    // 그럴듯한 값을 돌려주면 Mock 으로 돌린 워크플로가 엉뚱한 회전을 하고
    // 그것이 성공으로 보인다.
    await expect(
      setup().tools.invoke(
        "photoshop.measure.tilt",
        { bounds: { left: 0, top: 0, right: 500, bottom: 200 } },
        { requestId: "r" },
      ),
    ).rejects.toThrow(/픽셀을 읽지 않아/u);
  });
});
