import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { describeCaptureFailure, parseCaptureOutput } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * Photoshop 창 캡처. (ROADMAP §17.11)
 *
 * 실제 캡처는 Windows 와 실행 중인 Photoshop 이 있어야 하므로 여기서 부르지 않는다.
 * 대신 **부르기 전후**를 고정한다 — 권한 경계와 출력 해석이다. 둘 다 틀리면
 * 조용히 잘못된 결과가 나가는 자리다.
 */

describe("창 캡처", () => {
  it("문서 캡처와 권한이 다르다", () => {
    // 찍는 것이 문서가 아니라 사용자의 화면이다. 파일 경로 · 최근 문서 · 계정
    // 이름이 함께 찍힌다. read 로 두면 기본 설정에서 그냥 열린다.
    const { tools } = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit", "external"]),
    });
    expect(tools.get("photoshop.window.capture")?.permission).toBe("external");
    expect(tools.get("photoshop.document.capture")?.permission).toBe("read");
  });

  it("기본 권한에서는 막힌다", async () => {
    // 기본은 read · edit 뿐이다. 사용자가 PHOTOSHOP_MCP_ALLOW 로 켜야 한다.
    const { tools } = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });
    await expect(tools.invoke("photoshop.window.capture", {}, { requestId: "r" })).rejects.toThrow(
      /권한|permission/iu,
    );
  });

  it("지원하지 않는 곳에서도 목록에는 있다", () => {
    // 없는 것처럼 숨기면 왜 안 되는지 물어볼 수도 없다. 파일 저장 Tool 을 막힌
    // 채로 노출하는 것과 같은 이유다.
    const { tools } = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
    });
    expect(tools.list().map((tool) => tool.name)).toContain("photoshop.window.capture");
  });

  it("longEdge 범위를 강제한다", async () => {
    const { tools } = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit", "external"]),
    });
    for (const longEdge of [32, 4096]) {
      await expect(
        tools.invoke("photoshop.window.capture", { longEdge }, { requestId: "r" }),
      ).rejects.toThrow(/longEdge/u);
    }
  });

  describe("출력 해석", () => {
    it("표식 뒤의 크기와 base64 를 읽는다", () => {
      const parsed = parseCaptureOutput("##PSMCP##1024x556\nAAECAwQF\n");
      expect(parsed).toEqual({ width: 1024, height: 556, base64: "AAECAwQF" });
    });

    it("앞에 섞인 출력을 건너뛴다", () => {
      // PowerShell 이 경고를 함께 낼 수 있다. 앞줄을 그냥 버리면 엉뚱한 줄을
      // base64 로 읽는다.
      const parsed = parseCaptureOutput("WARNING: 무언가\n##PSMCP##800x600\nQUJD\n");
      expect(parsed?.base64).toBe("QUJD");
      expect(parsed?.width).toBe(800);
    });

    it("표식이 없으면 null 이다", () => {
      // 실패를 성공으로 읽지 않는다.
      expect(parseCaptureOutput("무언가 잘못됐다")).toBeNull();
    });

    it("크기만 있고 이미지가 없으면 null 이다", () => {
      expect(parseCaptureOutput("##PSMCP##1024x556\n\n")).toBeNull();
    });
  });

  describe("실패 해석", () => {
    it("고칠 방법을 함께 말한다", () => {
      // "실패했습니다" 만 돌려주면 호출자가 할 수 있는 일이 없다.
      expect(describeCaptureFailure("NOT_RUNNING").message).toMatch(/Photoshop 을 띄우고/u);
      expect(describeCaptureFailure("MINIMIZED").message).toMatch(/복원/u);
      expect(describeCaptureFailure("PRINTWINDOW_FAILED").message).toMatch(/원격 데스크톱/u);
    });

    it("모르는 실패는 지어내지 않고 원문을 담는다", () => {
      const described = describeCaptureFailure("Some unexpected failure\n두 번째 줄");
      expect(described.message).toContain("Some unexpected failure");
      expect(described.message).not.toContain("두 번째 줄");
    });

    it("전부 다시 시도할 수 있는 실패다", () => {
      for (const stderr of ["NOT_RUNNING", "MINIMIZED", "PRINTWINDOW_FAILED", "???"]) {
        expect(describeCaptureFailure(stderr).recoverable, stderr).toBe(true);
      }
    });
  });
});
