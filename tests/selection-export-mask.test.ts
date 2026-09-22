import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  type SaveResult,
} from "@photoshop-mcp/photoshop-bridge";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `photoshop.selection.export_mask` — 선택 영역을 파일로. (ROADMAP §19)
 *
 * 외부 처리기가 **어디가 하늘인지** 를 알아야 하는 경우가 있다. GraXpert 는
 * 지상 풍경이 프레임에 있으면 산·나무가 배경 모델을 끌어당겨 하늘에서 뺄 것을
 * 거의 못 찾는다 — 실기에서 결과가 원본과 눈으로 구분되지 않았다.
 *
 * 있던 것으로는 안 됐다. `selection.capture` 는 축소본이고
 * `selection.save_channel` 은 문서 안에만 남는다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mask-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/**
 * Mock 은 선택을 생성자로 받지 않는다 — Command 로 만든다. 실기와 같은
 * 순서를 밟게 하려는 것이고, 그래서 "선택 없음" 경로도 진짜로 지나간다.
 */
async function setup(
  options: { selection?: boolean; allow?: ("read" | "edit" | "external" | "destructive")[] } = {},
): Promise<ReturnType<typeof createPhotoshopMcp>> {
  const bridge = new MockPhotoshopBridge({
    workspacePath: workspace,
    files: {
      write: (path) => writeFileSync(path, "마스크", "utf8"),
      exists: (path) => existsSync(path),
    },
  });
  const mcp = createPhotoshopMcp({
    bridge,
    logger: createSilentLogger(),
    policy: new PermissionPolicy(options.allow ?? ["read", "edit", "external"]),
  });
  if (options.selection !== false) {
    await mcp.engine.execute(
      { type: "SELECTION_SET", params: { shape: "canvas" } },
      { requestId: "setup" },
    );
  }
  return mcp;
}

const call = async (
  mcp: ReturnType<typeof createPhotoshopMcp>,
  input: Record<string, unknown>,
): Promise<SaveResult> =>
  mcp.tools.invoke<SaveResult>("photoshop.selection.export_mask", input, { requestId: "r" });

describe("권한", () => {
  it("**external 이다** — 파일을 만든다", async () => {
    expect((await setup()).tools.get("photoshop.selection.export_mask")?.permission).toBe(
      "external",
    );
  });

  it("기본 정책에서는 막힌다", async () => {
    const mcp = await setup({ allow: ["read", "edit"] });
    await expect(call(mcp, { filename: "sky" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED }),
    );
  });
});

describe("파일 이름", () => {
  it("**확장자를 붙여 준다** — 형식을 고르게 하지 않는다", async () => {
    /* 읽는 것이 사람이 아니라 외부 처리 코드이고 16비트 TIFF 하나만 지원한다.
     * 고를 수 있게 두면 png 로 내보낸 뒤 "왜 안 되지" 가 된다. */
    const result = await call(await setup(), { filename: "sky" });

    expect(result.filename).toBe("sky.tif");
    expect(result.format).toBe("tiff");
  });

  it("**경로를 거부한다** — 승인된 폴더 밖으로 못 나간다", async () => {
    const mcp = await setup();
    for (const bad of ["../sky", "sub/sky", "C:/sky"]) {
      await expect(call(mcp, { filename: bad }), bad).rejects.toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    }
  });

  it("모르는 필드를 거절한다", async () => {
    // 형식을 고를 수 있다고 오해하고 보내는 것을 막는다.
    await expect(call(await setup(), { filename: "sky", format: "png" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});

describe("선택이 없으면", () => {
  it("**실패한다** — 빈 마스크를 만들지 않는다", async () => {
    /* 전부 검정인 마스크를 돌려주면 외부 처리기가 "하늘이 하나도 없다" 로
     * 읽는다. 오류 없이 엉뚱한 결과가 나오는 쪽이 더 나쁘다. */
    const mcp = await setup({ selection: false });

    await expect(call(mcp, { filename: "sky" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});
