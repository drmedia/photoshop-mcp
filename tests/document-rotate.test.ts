import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  DEFAULT_MOCK_DOCUMENT,
  MockPhotoshopBridge,
  PermissionPolicy,
} from "@photoshop-mcp/photoshop-bridge";
import { inscribedBounds } from "@photoshop-mcp/photoshop-tools";
import { describe, expect, it } from "vitest";

/**
 * 문서 회전. (ROADMAP §17.19)
 *
 * 실기에서 수평선이 −1.87° 기울어 있는 것을 **재 놓고 고치지 못했다.**
 * 자르기로는 절대 풀리지 않는 종류의 문제다.
 */

function setup(allow = ["read", "edit"]): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

// Mock 의 기본 문서 크기를 숫자로 박아 두지 않는다. Mock 을 고칠 때 관계없는
// 테스트가 같이 깨진다.
const BASE_WIDTH = DEFAULT_MOCK_DOCUMENT.width;
const BASE_HEIGHT = DEFAULT_MOCK_DOCUMENT.height;

const rotate = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  angle: number,
): Promise<Record<string, never>> =>
  (await mcp.tools.invoke("photoshop.document.rotate", { angle }, { requestId: "r" })) as never;

/** 점이 회전한 사각형 안에 있는가. `inscribedBounds` 의 약속을 직접 검산한다. */
function insideRotatedRect(
  x: number,
  y: number,
  width: number,
  height: number,
  angleDegrees: number,
): boolean {
  const radians = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  // 부동소수 여유 0.5px. 픽셀 하나보다 작다.
  return (
    Math.abs(x * cos + y * sin) <= width / 2 + 0.5 &&
    Math.abs(-x * sin + y * cos) <= height / 2 + 0.5
  );
}

describe("문서 회전", () => {
  describe("permission", () => {
    it("픽셀을 재보간하지만 edit 이다", () => {
      // destructive 로 올리면 기본 허용 밖이라 기본 설정에서 수평 교정이 막힌다.
      // History 로 되돌아가는 일을 막는 것은 과하다. (§17.12 와 같은 판단)
      expect(setup().tools.get("photoshop.document.rotate")?.permission).toBe("edit");
    });

    it("기본 권한으로 동작한다", async () => {
      const result = await rotate(setup(), 1.87);
      expect(result["previousWidth"]).toBe(BASE_WIDTH);
    });
  });

  describe("파라미터", () => {
    it("angle 0 을 거부한다", async () => {
      // 아무것도 하지 않으면서 재보간만 일어나는 호출이다.
      await expect(rotate(setup(), 0)).rejects.toThrow(/angle/u);
    });

    it("수평 교정 범위를 벗어나면 거부한다", async () => {
      // 세로/가로를 바꾸는 도구가 아니다. 그리고 이 범위 밖에서는 "정말 돌았는가"
      // 를 캔버스 크기로 확인할 수 없다.
      for (const angle of [-46, 46, 90, 180]) {
        await expect(rotate(setup(), angle)).rejects.toThrow();
      }
    });
  });

  describe("결과", () => {
    it("회전하면 캔버스가 커진다", async () => {
      // Mock 이 크기를 그대로 두면 이 경로가 영영 검증되지 않는다.
      const result = await rotate(setup(), 10);
      expect(result["width"] as unknown as number).toBeGreaterThan(BASE_WIDTH);
      expect(result["height"] as unknown as number).toBeGreaterThan(BASE_HEIGHT);
    });

    it("전후 크기와 실제 각도를 함께 돌려준다", async () => {
      const result = await rotate(setup(), -3.5);
      expect(result["previousWidth"]).toBe(BASE_WIDTH);
      expect(result["previousHeight"]).toBe(BASE_HEIGHT);
      expect(result["angle"]).toBe(-3.5);
    });

    it("어느 경로로 돌렸는지 알린다", async () => {
      // DOM 에 API 가 있는지 짐작하지 않고 재서 정한다. (§17.13 의 histogram)
      expect(typeof (await rotate(setup(), 2))["method"]).toBe("string");
    });

    it("**되돌릴 수 있다**", async () => {
      // 이 Command 를 edit 으로 분류한 근거가 바로 이것이다.
      const mcp = setup();
      await rotate(mcp, 12);
      await mcp.tools.invoke("photoshop.history.undo", {}, { requestId: "r" });
      const document = (await mcp.tools.invoke(
        "photoshop.document.get",
        {},
        { requestId: "r" },
      )) as Record<string, number>;
      expect(document["width"]).toBe(BASE_WIDTH);
      expect(document["height"]).toBe(BASE_HEIGHT);
    });
  });

  describe("safeBounds", () => {
    it("회전하지 않은 것과 같으면 문서 전체다", () => {
      // 0° 는 Tool 이 거부하지만 계산 자체는 성립해야 한다 — 경계를 고정한다.
      expect(inscribedBounds(6000, 4000, 0, 6000, 4000)).toEqual({
        left: 0,
        top: 0,
        right: 6000,
        bottom: 4000,
      });
    });

    it("**원본 종횡비를 유지한다**", () => {
      // 수평 교정의 목적은 사진을 바로 세우는 것이지 비율을 바꾸는 것이 아니다.
      const bounds = inscribedBounds(6000, 4000, 1.87, 6131, 4192);
      const ratio = (bounds.right - bounds.left) / (bounds.bottom - bounds.top);
      expect(ratio).toBeCloseTo(1.5, 2);
    });

    it("**빈 모서리가 한 픽셀도 들어오지 않는다**", () => {
      // 이 함수가 약속한 것이 이것 하나다. 네 꼭짓점을 회전 사각형에 직접 대본다.
      for (const angle of [0.5, 1.87, -1.87, 5, -12, 30, -45]) {
        const radians = (Math.abs(angle) * Math.PI) / 180;
        const canvasWidth = 6000 * Math.cos(radians) + 4000 * Math.sin(radians);
        const canvasHeight = 6000 * Math.sin(radians) + 4000 * Math.cos(radians);
        const bounds = inscribedBounds(
          6000,
          4000,
          angle,
          Math.round(canvasWidth),
          Math.round(canvasHeight),
        );

        // 캔버스 중심 기준 좌표로 옮겨 검산한다.
        const centerX = Math.round(canvasWidth) / 2;
        const centerY = Math.round(canvasHeight) / 2;
        const corners: [number, number][] = [
          [bounds.left, bounds.top],
          [bounds.right, bounds.top],
          [bounds.left, bounds.bottom],
          [bounds.right, bounds.bottom],
        ];
        for (const [x, y] of corners) {
          expect(
            insideRotatedRect(x - centerX, y - centerY, 6000, 4000, angle),
            `${angle}° 의 (${x}, ${y})`,
          ).toBe(true);
        }
      }
    });

    it("부호가 달라도 같은 크기다", () => {
      // 기울기의 방향은 남는 넓이와 상관이 없다.
      const positive = inscribedBounds(6000, 4000, 1.87, 6131, 4192);
      const negative = inscribedBounds(6000, 4000, -1.87, 6131, 4192);
      expect(negative).toEqual(positive);
    });

    it("각도가 클수록 적게 남는다", () => {
      let previousArea = Number.POSITIVE_INFINITY;
      for (const angle of [1, 5, 15, 30, 45]) {
        const radians = (angle * Math.PI) / 180;
        const canvasWidth = Math.round(6000 * Math.cos(radians) + 4000 * Math.sin(radians));
        const canvasHeight = Math.round(6000 * Math.sin(radians) + 4000 * Math.cos(radians));
        const bounds = inscribedBounds(6000, 4000, angle, canvasWidth, canvasHeight);
        const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);
        expect(area).toBeLessThan(previousArea);
        previousArea = area;
      }
    });

    it("**document.crop 이 그대로 받는다**", async () => {
      // 이 둘이 이어지지 않으면 safeBounds 를 돌려주는 의미가 없다.
      const mcp = setup();
      const rotated = await rotate(mcp, 6);
      const cropped = (await mcp.tools.invoke(
        "photoshop.document.crop",
        { bounds: rotated["safeBounds"] },
        { requestId: "r" },
      )) as Record<string, number>;
      expect(cropped["width"]).toBeGreaterThan(0);
      expect(cropped["height"]).toBeGreaterThan(0);
    });
  });
});
