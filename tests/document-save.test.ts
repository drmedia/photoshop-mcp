import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  withExtension,
  type SaveResult,
  type WorkspaceStatus,
} from "@photoshop-mcp/photoshop-bridge";
import { describe, expect, it } from "vitest";

/**
 * Phase 9 파일 저장. (ROADMAP §8.5, §13)
 *
 * 두 가지 성질을 고정한다.
 *
 * 1. 저장 위치를 LLM 이 고를 수 없다 — 승인된 폴더 안의 **파일 이름만** 받는다.
 * 2. `save_as` 와 `export` 는 **덮어쓰지 않는다** — 그래서 external 로 분류할 수 있다.
 *    덮어쓰기는 `save` 하나로 모아 destructive 로 분류한다.
 */

const denied = expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED });

/** 저장을 실제로 해보려면 external · destructive 를 켜야 한다. */
function setup(options: { workspace?: string | null; documentPath?: string | null } = {}): {
  mcp: ReturnType<typeof createPhotoshopMcp>;
  bridge: MockPhotoshopBridge;
} {
  const bridge = new MockPhotoshopBridge({
    workspacePath: options.workspace ?? null,
    documentPath: options.documentPath ?? null,
  });
  const mcp = createPhotoshopMcp({
    bridge,
    policy: new PermissionPolicy(["read", "edit", "external", "destructive"]),
  });
  return { mcp, bridge };
}

const call = async <T>(
  mcp: ReturnType<typeof createPhotoshopMcp>,
  name: string,
  input: unknown = {},
): Promise<T> => mcp.tools.invoke<T>(name, input, { requestId: "req-save" });

describe("withExtension", () => {
  // Plugin 과 Mock Bridge 가 같은 함수를 쓴다. 따로 두면 실기와 테스트가 어긋난다.
  it("없으면 붙이고 맞으면 그대로 둔다", () => {
    expect(withExtension("결과", "psd")).toBe("결과.psd");
    expect(withExtension("결과.psd", "psd")).toBe("결과.psd");
    expect(withExtension("결과.PSD", "psd")).toBe("결과.PSD");
  });

  it("tiff 는 .tif 로 쓰되 .tiff 도 인정한다", () => {
    expect(withExtension("가", "tiff")).toBe("가.tif");
    expect(withExtension("가.tif", "tiff")).toBe("가.tif");
    expect(withExtension("가.tiff", "tiff")).toBe("가.tiff");
  });

  it("다른 확장자는 바꾸지 않고 덧붙인다", () => {
    // 사용자가 고른 이름을 바꿔치기하지 않는다.
    expect(withExtension("보고서.txt", "psd")).toBe("보고서.txt.psd");
    expect(withExtension("사진.jpg", "png")).toBe("사진.jpg.png");
  });

  it("점이 여럿인 이름을 다룬다", () => {
    expect(withExtension("v1.2.최종", "psd")).toBe("v1.2.최종.psd");
    expect(withExtension("v1.2.최종.psd", "psd")).toBe("v1.2.최종.psd");
  });
});

describe("기본 정책에서는 저장이 막힌다", () => {
  it("save_as · export · save 는 기본값으로 거부된다", async () => {
    // 기본 정책은 read · edit 뿐이다. 저장을 쓰려면 명시적으로 켜야 한다.
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({ workspacePath: "C:/작업" }),
    });

    await expect(call(mcp, "photoshop.document.save_as", { filename: "a" })).rejects.toThrow(
      denied,
    );
    await expect(call(mcp, "photoshop.document.export", { filename: "a" })).rejects.toThrow(denied);
    await expect(call(mcp, "photoshop.document.save")).rejects.toThrow(denied);
  });

  it("workspace.status 는 read 라 기본값으로도 동작한다", async () => {
    // 무엇이 막혔는지 알아내는 경로까지 막으면 사용자가 원인을 알 수 없다.
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    await expect(call<WorkspaceStatus>(mcp, "photoshop.workspace.status")).resolves.toEqual({
      approved: false,
      path: null,
    });
  });

  it("막혀 있어도 Tool 목록에는 보인다", () => {
    // 무엇이 있고 왜 막혔는지 클라이언트가 알아야 한다.
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    expect(mcp.tools.has("photoshop.document.save_as")).toBe(true);
    expect(mcp.tools.get("photoshop.document.save")?.permission).toBe("destructive");
  });
});

describe("작업 폴더 승인", () => {
  it("승인 전에는 WORKSPACE_NOT_APPROVED", async () => {
    const { mcp } = setup({ workspace: null });
    await expect(call(mcp, "photoshop.document.save_as", { filename: "결과" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_APPROVED, recoverable: true }),
    );
  });

  it("승인 후에는 status 가 경로를 보고한다", async () => {
    const { mcp, bridge } = setup({ workspace: null });
    await expect(call<WorkspaceStatus>(mcp, "photoshop.workspace.status")).resolves.toEqual({
      approved: false,
      path: null,
    });

    bridge.approveWorkspace("C:/작업/출력");

    await expect(call<WorkspaceStatus>(mcp, "photoshop.workspace.status")).resolves.toEqual({
      approved: true,
      path: "C:/작업/출력",
    });
  });

  it("승인을 해제하면 다시 막힌다", async () => {
    const { mcp, bridge } = setup({ workspace: "C:/작업" });
    await expect(
      call(mcp, "photoshop.document.save_as", { filename: "가" }),
    ).resolves.toBeDefined();

    bridge.revokeWorkspace();

    await expect(call(mcp, "photoshop.document.save_as", { filename: "나" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_APPROVED }),
    );
  });
});

describe("파일 이름은 폴더 밖으로 나갈 수 없다", () => {
  const 밖으로 = [
    "../탈출",
    "..\\탈출",
    "C:/Windows/system32/악성",
    "/etc/passwd",
    "하위폴더/파일",
    "..",
    ".",
  ];

  it("경로 구분자와 상위 참조를 거부한다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    for (const filename of 밖으로) {
      await expect(
        call(mcp, "photoshop.document.save_as", { filename }),
        `${filename} 이 통과했습니다`,
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });

  it("빈 이름과 지나치게 긴 이름을 거부한다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    for (const filename of ["", "   ", "가".repeat(201)]) {
      await expect(call(mcp, "photoshop.document.save_as", { filename })).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    }
  });
});

describe("save_as", () => {
  it("확장자를 붙여 승인된 폴더에 저장한다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call<SaveResult>(mcp, "photoshop.document.save_as", { filename: "결과" }),
    ).resolves.toEqual({ path: "C:/작업/결과.psd", filename: "결과.psd", format: "psd" });
  });

  it("이미 붙은 확장자는 그대로 둔다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call<SaveResult>(mcp, "photoshop.document.save_as", { filename: "결과.psd" }),
    ).resolves.toMatchObject({ filename: "결과.psd" });
  });

  it("psb 와 tiff 를 지원한다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call<SaveResult>(mcp, "photoshop.document.save_as", { filename: "큰파일", format: "psb" }),
    ).resolves.toMatchObject({ filename: "큰파일.psb" });
    await expect(
      call<SaveResult>(mcp, "photoshop.document.save_as", { filename: "중간", format: "tiff" }),
    ).resolves.toMatchObject({ filename: "중간.tif" });
  });

  it("덮어쓰지 않는다", async () => {
    // 이 성질이 없으면 save_as 를 external 로 분류할 수 없다.
    const { mcp } = setup({ workspace: "C:/작업" });
    await call(mcp, "photoshop.document.save_as", { filename: "결과" });

    await expect(call(mcp, "photoshop.document.save_as", { filename: "결과" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.FILE_ALREADY_EXISTS, recoverable: true }),
    );
  });

  it("png 같은 합치기 형식은 받지 않는다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call(mcp, "photoshop.document.save_as", { filename: "가", format: "png" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("열린 문서가 없으면 실패한다", async () => {
    const bridge = new MockPhotoshopBridge({ document: null, workspacePath: "C:/작업" });
    const mcp = createPhotoshopMcp({
      bridge,
      policy: new PermissionPolicy(["read", "edit", "external", "destructive"]),
    });
    await expect(call(mcp, "photoshop.document.save_as", { filename: "가" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_FOUND }),
    );
  });
});

describe("export", () => {
  it("png 로 내보낸다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call<SaveResult>(mcp, "photoshop.document.export", { filename: "미리보기" }),
    ).resolves.toEqual({
      path: "C:/작업/미리보기.png",
      filename: "미리보기.png",
      format: "png",
    });
  });

  it("jpg 품질을 받는다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call<SaveResult>(mcp, "photoshop.document.export", {
        filename: "공유용",
        format: "jpg",
        quality: 12,
      }),
    ).resolves.toMatchObject({ filename: "공유용.jpg", format: "jpg" });
  });

  it("quality 는 jpg 에서만 쓸 수 있다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call(mcp, "photoshop.document.export", { filename: "가", format: "png", quality: 10 }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("quality 범위를 검증한다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    for (const quality of [0, 13, 1.5]) {
      await expect(
        call(mcp, "photoshop.document.export", { filename: "가", format: "jpg", quality }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });

  it("psd 같은 레이어 형식은 받지 않는다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await expect(
      call(mcp, "photoshop.document.export", { filename: "가", format: "psd" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("덮어쓰지 않는다", async () => {
    const { mcp } = setup({ workspace: "C:/작업" });
    await call(mcp, "photoshop.document.export", { filename: "가" });
    await expect(call(mcp, "photoshop.document.export", { filename: "가" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.FILE_ALREADY_EXISTS }),
    );
  });
});

describe("save — 원본 덮어쓰기", () => {
  it("저장된 적 있는 문서는 제 경로에 덮어쓴다", async () => {
    const { mcp } = setup({ documentPath: "D:/사진/test.psd" });
    await expect(call<SaveResult>(mcp, "photoshop.document.save")).resolves.toEqual({
      path: "D:/사진/test.psd",
      filename: "test.psd",
      format: "psd",
    });
  });

  it("작업 폴더 승인과 무관하다", async () => {
    // 문서 자신의 경로에만 쓰며, 그 경로는 사용자가 문서를 열 때 이미 승인한 것이다.
    const { mcp } = setup({ workspace: null, documentPath: "D:/사진/test.psd" });
    await expect(call(mcp, "photoshop.document.save")).resolves.toBeDefined();
  });

  it("한 번도 저장하지 않은 문서는 DOCUMENT_NOT_SAVED", async () => {
    const { mcp } = setup({ documentPath: null });
    await expect(call(mcp, "photoshop.document.save")).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.DOCUMENT_NOT_SAVED, recoverable: true }),
    );
  });

  it("인자를 받지 않는다", async () => {
    // 경로를 받으면 destructive 의 사정거리가 문서 밖으로 넓어진다.
    const { mcp } = setup({ documentPath: "D:/사진/test.psd" });
    await expect(
      call(mcp, "photoshop.document.save", { path: "C:/다른곳/덮어쓰기.psd" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });
});

describe("권한을 나눠 줄 수 있다", () => {
  it("external 만 켜면 save_as 는 되고 save 는 막힌다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge({
        workspacePath: "C:/작업",
        documentPath: "D:/사진/test.psd",
      }),
      policy: new PermissionPolicy(["read", "edit", "external"]),
    });

    await expect(
      call(mcp, "photoshop.document.save_as", { filename: "안전" }),
    ).resolves.toBeDefined();
    await expect(call(mcp, "photoshop.document.save")).rejects.toThrow(denied);
  });
});
