import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * 문서 열기. (ROADMAP §17.26)
 *
 * `document.close`(§17.25)를 만들고 실기에서 닫아 본 직후 **다시 열 방법이
 * 없었다.** 닫을 수는 있는데 열 수는 없는 것은 반쪽이다.
 *
 * Mock 에는 파일 시스템이 없어 실제로 여는 경로는 여기서 검증되지 않는다.
 * 고정하는 것은 **무엇을 거절하는가** 다 — 이 Command 에서 위험한 자리가 거기다.
 */

type Mcp = ReturnType<typeof createPhotoshopMcp>;

function setup(allow: string[] = ["read", "edit", "external"]): Mcp {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
}

const open = async (mcp: Mcp, filename: string): Promise<unknown> =>
  mcp.tools.invoke("photoshop.document.open", { filename }, { requestId: "r" });

describe("permission", () => {
  it("파일을 읽으므로 external 이다", () => {
    expect(setup().tools.get("photoshop.document.open")?.permission).toBe("external");
  });

  it("기본 권한에서는 막힌다", async () => {
    await expect(open(setup(["read", "edit"]), "a.psd")).rejects.toThrow(/권한|permission/iu);
  });
});

describe("형식", () => {
  it("열 수 있는 형식을 받는다", async () => {
    // Mock 은 파일이 없어 실패하지만 **스키마는 통과해야** 한다.
    for (const name of ["a.psd", "a.psb", "a.tif", "a.tiff", "a.png", "a.jpg", "a.jpeg"]) {
      await expect(open(setup(), name), name).rejects.toThrow(/파일을 읽지 않아/u);
    }
  });

  it("대소문자를 가리지 않는다", async () => {
    await expect(open(setup(), "A.PSD")).rejects.toThrow(/파일을 읽지 않아/u);
  });

  describe("**카메라 RAW 를 거절한다**", () => {
    it("열기 전에 막는다", async () => {
      // Camera Raw 대화상자가 뜨면 플러그인이 멈추고 Bridge 가 타임아웃한다.
      // §17.25 가 close 에서 막은 것과 같은 위험이다.
      for (const name of ["a.nef", "a.cr2", "a.arw", "a.dng", "a.raf", "a.orf"]) {
        await expect(open(setup(), name), name).rejects.toThrow(/Camera Raw/u);
      }
    });

    it("왜 막았는지 말한다", async () => {
      // "지원하지 않습니다" 만으로는 호출자가 할 수 있는 일이 없다.
      await expect(open(setup(), "a.nef")).rejects.toThrow(/직접 열어야/u);
    });
  });

  it("모르는 확장자를 거절한다", async () => {
    // 조용히 열어 보지 않는다. 무엇이 뜰지 모르는 파일을 여는 대가가 크다.
    await expect(open(setup(), "a.exe")).rejects.toThrow(/열 수 없습니다/u);
    await expect(open(setup(), "a.txt")).rejects.toThrow(/열 수 없습니다/u);
  });

  it("확장자가 없으면 거절한다", async () => {
    await expect(open(setup(), "noextension")).rejects.toThrow(/확장자가 없습니다/u);
  });

  it("열 수 있는 형식을 오류 메시지에 적는다", async () => {
    await expect(open(setup(), "a.gif")).rejects.toThrow(/psd/u);
  });
});

describe("경로", () => {
  it("**경로 구분자를 거절한다**", async () => {
    // 승인된 폴더 안으로 가둔다. 읽기라고 느슨하게 두지 않는다 — 임의 경로를
    // 열 수 있으면 사용자의 어느 파일이든 캡처로 볼 수 있다.
    for (const name of ["../a.psd", "sub/a.psd", "sub\\a.psd", "C:/a.psd"]) {
      await expect(open(setup(), name), name).rejects.toThrow();
    }
  });

  it("빈 이름을 거절한다", async () => {
    await expect(open(setup(), "")).rejects.toThrow();
  });
});

describe("Mock", () => {
  it("**문서를 지어내지 않는다**", async () => {
    // 그럴듯한 문서를 돌려주면 Mock 으로 돌린 워크플로가 존재하지 않는 파일을
    // 열었다고 믿는다. measure.tilt 가 각도를 지어내지 않는 것과 같다.
    await expect(open(setup(), "a.psd")).rejects.toThrow(/실제 Photoshop 연결이 필요/u);
  });
});
