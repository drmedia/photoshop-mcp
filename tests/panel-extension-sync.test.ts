import {
  normalizeExtensionPath,
  planPanelExtensionSync,
} from "../packages/mcp-server/src/panel-extensions.js";
import { describe, expect, it } from "vitest";

/**
 * 패널 등록 목록과 적재 상태를 맞추는 규칙. (ROADMAP §18.3)
 *
 * 이 판단은 Bridge 없이 잴 수 있다. `start.ts` 안에 두면 **제거 경로가
 * 사용자가 패널에서 버튼을 누를 때 처음 실행된다.**
 */

const A = "C:\\ext\\alpha";
const SEP = "\\";
const B = "C:\\ext\\beta";

describe("적재할 것", () => {
  it("등록됐는데 안 붙어 있으면 적재한다", () => {
    expect(planPanelExtensionSync([A], new Map()).load).toEqual([A]);
  });

  it("**이미 붙어 있으면 다시 적재하지 않는다** — namespace 충돌로 거부된다", () => {
    const plan = planPanelExtensionSync([A], new Map([[A, "alpha"]]));
    expect(plan.load).toEqual([]);
    expect(plan.unload).toEqual([]);
  });
});

describe("해제할 것", () => {
  it("**등록 목록에서 빠지면 해제한다**", () => {
    const loaded = new Map([
      [A, "alpha"],
      [B, "beta"],
    ]);
    const plan = planPanelExtensionSync([A], loaded);
    expect(plan.unload).toEqual([{ path: B, namespace: "beta" }]);
    expect(plan.load).toEqual([]);
  });

  it("**패널을 거쳐 적재한 것만 해제 대상이다**", () => {
    /* `PHOTOSHOP_MCP_EXTENSIONS` 로 자동 적재한 것은 애초에 이 지도에 없다.
     * 목록에 없다고 해제하면 설정으로 켠 Extension 이 Photoshop 이 붙는
     * 순간 사라진다. */
    expect(planPanelExtensionSync([], new Map()).unload).toEqual([]);
  });

  it("전부 빼면 전부 해제한다", () => {
    const loaded = new Map([
      [A, "alpha"],
      [B, "beta"],
    ]);
    const plan = planPanelExtensionSync([], loaded);
    expect(plan.unload.map((entry) => entry.namespace).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("경로 비교", () => {
  it("**끝의 구분자는 무시한다** — 안 그러면 연결마다 해제·재적재를 왕복한다", () => {
    const plan = planPanelExtensionSync([A + SEP], new Map([[A, "alpha"]]));
    expect(plan.load).toEqual([]);
    expect(plan.unload).toEqual([]);
  });

  it("슬래시도 같이 본다", () => {
    expect(normalizeExtensionPath(A + "/")).toBe(A);
  });

  it("앞뒤 공백을 떼어낸다", () => {
    expect(normalizeExtensionPath("  " + A + "  ")).toBe(A);
  });

  it("**대소문자는 건드리지 않는다** — Windows 만 구분하지 않는다", () => {
    const mixed = "C:\\Ext\\Alpha";
    expect(normalizeExtensionPath(mixed)).toBe(mixed);
  });

  it("루트 경로의 구분자는 남긴다", () => {
    // `/` 하나를 빈 문자열로 만들면 서로 다른 경로가 같아진다.
    expect(normalizeExtensionPath("/")).toBe("/");
  });

  it("같은 것이 두 번 등록돼도 한 번만 적재한다", () => {
    expect(planPanelExtensionSync([A, A + "/"], new Map()).load).toEqual([A]);
  });
});
