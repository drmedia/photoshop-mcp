import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  type ProviderConfig,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Production Hardening. (ROADMAP §17)
 *
 * 두 가지를 다룬다.
 *
 * - **진단** — 무엇이 왜 안 되는지 한 번에. 상태만 나열하면 사용자가 스스로
 *   조합해야 한다.
 * - **임시 파일** — 외부 처리기가 한 번 돌 때마다 16비트 TIFF 가 여러 개 생긴다.
 *   실기 검증만으로 1GB 가 넘게 쌓였는데 알 방법이 없었다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "hard-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

interface Diagnostics {
  bridge: { connected: boolean; state: string; kind: "uxp" | "mock" | null };
  permissions: { allowed: string[] };
  registry: { tools: number; commands: number; profile: string; hiddenTools: number };
  capabilities: { id: string; available: boolean; reason: string | null }[];
  extensions: unknown[];
  workflows: unknown[];
  jobs: Record<string, number>;
  events: { recorded: number };
  blocked: string[];
}

function setup(
  options: {
    connected?: boolean;
    allow?: ("read" | "edit" | "external" | "destructive")[];
    profile?: "full" | "retouch" | "readonly";
  } = {},
): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({
    bridge: new MockPhotoshopBridge({
      connected: options.connected ?? true,
      workspacePath: workspace,
    }),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(options.allow ?? ["read", "edit", "external", "destructive"]),
    ...(options.profile === undefined ? {} : { profile: options.profile }),
  });
}

const diagnose = async (mcp: ReturnType<typeof createPhotoshopMcp>): Promise<Diagnostics> =>
  mcp.tools.invoke<Diagnostics>("photoshop.diagnostics", {}, { requestId: "d" });

describe("진단", () => {
  it("상태를 한 번에 보고한다", async () => {
    const mcp = setup();
    const report = await diagnose(mcp);

    expect(report.bridge.connected).toBe(true);
    expect(report.permissions.allowed).toEqual(["read", "edit", "external", "destructive"]);
    expect(report.registry.tools).toBeGreaterThan(30);
    expect(report.registry.commands).toBeGreaterThan(25);
    expect(report.events.recorded).toBeGreaterThanOrEqual(0);
  });

  it("**mock 인지 말한다** — 한 클라이언트에 둘을 붙이면 이름이 전부 겹친다", async () => {
    /* uxp 서버와 mock 서버를 함께 붙이면 Core Tool 78개가 양쪽에 똑같이 있다.
     * 결과만 보고는 어느 쪽이 답했는지 알 수 없는데, mock 은 가짜 문서에
     * 성공을 돌려주므로 **했다고 말하고 아무것도 안 하는** 상태가 된다.
     * 실기에서 `starnet.remove_stars` 가 mock 으로 떨어져 한참 헤맸다. */
    const report = await diagnose(setup());

    expect(report.bridge.kind).toBe("mock");
  });

  it("Photoshop 이 없으면 고치는 방법을 알려준다", async () => {
    // 상태만 주면 사용자는 여전히 무엇을 해야 할지 모른다.
    const mcp = setup({ connected: false });
    const report = await diagnose(mcp);

    expect(report.bridge.connected).toBe(false);
    expect(report.blocked.some((reason) => reason.includes("UXP Developer Tool"))).toBe(true);
  });

  it("권한이 없으면 환경변수를 알려준다", async () => {
    const mcp = setup({ allow: ["read", "edit"] });
    const report = await diagnose(mcp);

    expect(
      report.blocked.some((r) => r.includes("PHOTOSHOP_MCP_ALLOW") && r.includes("external")),
    ).toBe(true);
    expect(
      report.blocked.some((r) => r.includes("PHOTOSHOP_MCP_ALLOW") && r.includes("destructive")),
    ).toBe(true);
  });

  it("외부 처리기가 없으면 설정 파일을 알려준다", async () => {
    const mcp = setup();
    const report = await diagnose(mcp);

    expect(report.capabilities).toEqual([]);
    expect(report.blocked.some((r) => r.includes("capabilities.example.json"))).toBe(true);
  });

  it("쓸 수 없는 처리기는 이유를 함께 준다", async () => {
    const mcp = setup();
    const broken: ProviderConfig = {
      id: "missing",
      capability: "starRemoval",
      executable: join(workspace, "없는프로그램.exe"),
      args: ["{{input}}", "{{output}}"],
    };
    mcp.capabilities.register(broken);

    const report = await diagnose(mcp);
    expect(report.capabilities[0]).toMatchObject({ id: "missing", available: false });
    expect(report.blocked.some((r) => r.includes("missing") && r.includes("찾을 수 없"))).toBe(
      true,
    );
  });

  it("Job 상태를 집계한다", async () => {
    const mcp = setup();
    const id = mcp.jobs.start("테스트", async () => Promise.resolve(1));
    for (let i = 0; i < 50 && mcp.jobs.get(id)?.state !== "completed"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const report = await diagnose(mcp);
    expect(report.jobs["completed"]).toBe(1);
  });

  it("read 권한이면 된다", () => {
    // 무엇이 막혔는지 알아내는 경로까지 막으면 원인을 알 수 없다.
    const mcp = setup({ allow: ["read"] });
    expect(mcp.tools.get("photoshop.diagnostics")?.permission).toBe("read");
  });

  describe("Tool 프로필 (ROADMAP §102)", () => {
    /* 실기에서 모델이 감춘 Tool(`layer.flip`)을 요청받고 `diagnostics` 로 184개가 등록된 것을
     * 보고도 "그런 도구는 없다" 고 답했다. 감춘 것이 서버에 없는 것처럼 읽혔기 때문이다. */

    it("full 이면 감춘 것이 없고 막힘에도 안 오른다", async () => {
      const report = await diagnose(setup({ profile: "full" }));

      expect(report.registry.profile).toBe("full");
      expect(report.registry.hiddenTools).toBe(0);
      expect(report.blocked.some((line) => line.includes("PHOTOSHOP_MCP_PROFILE"))).toBe(false);
    });

    it("프로필을 주지 않으면 full 이다", async () => {
      const report = await diagnose(setup());

      expect(report.registry.profile).toBe("full");
      expect(report.registry.hiddenTools).toBe(0);
    });

    it("retouch 는 감춘 수를 세고 풀려면 어떻게 하는지 말한다", async () => {
      const mcp = setup({ profile: "retouch" });
      const report = await diagnose(mcp);

      expect(report.registry.profile).toBe("retouch");
      expect(report.registry.hiddenTools).toBeGreaterThan(0);
      expect(report.registry.hiddenTools).toBeLessThan(report.registry.tools);

      const line = report.blocked.find((entry) => entry.includes("PHOTOSHOP_MCP_PROFILE=full"));
      expect(line).toBeDefined();
      expect(line).toContain(String(report.registry.hiddenTools));
      expect(line).toContain("감춘 것");
    });

    it("readonly 도 감춘 수를 센다 — 권한으로 가른 것이다", async () => {
      const report = await diagnose(setup({ profile: "readonly" }));

      expect(report.registry.profile).toBe("readonly");
      expect(report.registry.hiddenTools).toBeGreaterThan(0);
      expect(report.blocked.some((line) => line.includes("PHOTOSHOP_MCP_PROFILE=full"))).toBe(true);
    });
  });
});

describe("임시 파일", () => {
  it("사용량을 사람이 읽을 크기로 함께 준다", async () => {
    // 바이트 숫자만 보면 1GB 가 넘은 것을 알아채지 못한다.
    const bridge = new MockPhotoshopBridge({ workspacePath: workspace });
    const mcp = createPhotoshopMcp({
      bridge,
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read", "edit", "external", "destructive"]),
    });

    const usage = await mcp.tools.invoke<{ totalSize: string; fileCount: number }>(
      "photoshop.workspace.usage",
      {},
      { requestId: "u" },
    );
    expect(usage.totalSize).toMatch(/KB|MB|GB/u);
  });

  it("삭제는 destructive 다", () => {
    const mcp = setup();
    expect(mcp.tools.get("photoshop.workspace.delete")?.permission).toBe("destructive");
    expect(mcp.tools.get("photoshop.workspace.usage")?.permission).toBe("read");
  });

  it("기본 정책에서는 삭제가 막힌다", async () => {
    const mcp = setup({ allow: ["read", "edit"] });
    await expect(
      mcp.tools.invoke("photoshop.workspace.delete", { filenames: ["a.tif"] }, { requestId: "d" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED }));
  });

  it("패턴을 받지 않는다", async () => {
    // 별표 한 줄이 사용자의 원본을 지울 수 있다. 승인된 폴더는 우리 폴더가 아니다.
    const mcp = setup();
    for (const bad of ["*.tif", "../x.tif", "폴더/파일.tif", ""]) {
      await expect(
        mcp.tools.invoke("photoshop.workspace.delete", { filenames: [bad] }, { requestId: "d" }),
        bad,
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });

  it("빈 목록을 거부한다", async () => {
    const mcp = setup();
    await expect(
      mcp.tools.invoke("photoshop.workspace.delete", { filenames: [] }, { requestId: "d" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });
});
