import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  type JobRecord,
  type ProviderConfig,
} from "@photoshop-mcp/photoshop-bridge";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * StarNet2 Extension.
 *
 * `milky.remove_stars` 에서 옮겨 왔다(`extensions/milkyscape`, 제거됨).
 * 고정하는 것은 셋이다.
 *
 * 1. **출력 경로를 둘 다 넘긴다** — StarNet2 는 별 이미지 이름을 받는다.
 *    StarXTerminator 와 다른 점이고, 그래서 `outputs` 로 선언할 수 있다
 * 2. **`=` 형식을 쓰지 않는다** — StarNet2 는 아예 안 받는다. RC-Astro 와 반대다
 * 3. **별 레이어에 Screen 을 건다** — 걸지 않으면 문서가 온통 검게 보인다
 */

let workspace: string;

const EXTENSION = fileURLToPath(new URL("../extensions/starnet/", import.meta.url));

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "starnet-"));
  process.env["STARNET_ARGV_LOG"] = join(workspace, "argv.json");
});

afterEach(async () => {
  delete process.env["STARNET_ARGV_LOG"];
  await rm(workspace, { recursive: true, force: true });
});

/**
 * 가짜 StarNet2.
 *
 * 받은 argv 를 남기고 출력 **둘 다** 만든다. 별 이미지를 안 만들면
 * Registry 가 "선언한 출력이 없다" 로 막는데, 그 검사가 도는 것도 확인 대상이다.
 */
async function fakeStarNet(): Promise<string> {
  const script = join(workspace, "starnet.cjs");
  const lines = [
    "const fs = require('node:fs');",
    "const a = process.argv.slice(2);",
    "fs.writeFileSync(process.env.STARNET_ARGV_LOG, JSON.stringify(a));",
    "const get = (flag) => a[a.indexOf(flag) + 1];",
    "fs.writeFileSync(get('--output'), 'starless');",
    "fs.writeFileSync(get('--unscreen'), 'stars');",
  ];
  await writeFile(script, lines.join("\n"), "utf8");
  return script;
}

/** 가짜 CLI 가 받은 argv. */
function argv(): string[] {
  return JSON.parse(readFileSync(process.env["STARNET_ARGV_LOG"] as string, "utf8")) as string[];
}

interface Setup {
  mcp: ReturnType<typeof createPhotoshopMcp>;
}

async function setup(options: { provider?: false | "other" } = {}): Promise<Setup> {
  const bridge = new MockPhotoshopBridge({
    workspacePath: workspace,
    files: {
      write: (path) => writeFileSync(path, "내보낸 픽셀", "utf8"),
      exists: (path) => existsSync(path),
    },
  });

  const mcp = createPhotoshopMcp({
    bridge,
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "external"] as never),
  });

  if (options.provider !== false) {
    /* **실제 `capabilities.example.json` 과 같은 모양으로 선언한다.**
     * 테스트만 다른 형식을 쓰면 Extension 과 설정이 갈라진 것을 못 잡는다. */
    const starnet: ProviderConfig = {
      id: options.provider === "other" ? "somethingelse" : "starnet2",
      capability: "starRemoval",
      executable: process.execPath,
      args: [
        await fakeStarNet(),
        "--input",
        "{{input}}",
        "--output",
        "{{output}}",
        "--unscreen",
        "{{output.stars}}",
        // StarNet2 는 `=` 형식을 아예 받지 않는다. 공백만 된다.
        "--stride",
        "{{stride}}",
        "--machine-progress",
      ],
      outputs: { stars: { description: "별만 남긴 이미지" } },
      // 기본값은 StarNet2 가 --machine-info 로 스스로 알려준 값이다.
      params: { stride: { type: "number", min: 2, max: 512, default: 256 } },
    };
    await mcp.capabilities.register(starnet);
  }

  await mcp.extensions.load({
    directory: EXTENSION,
    manifestPath: join(EXTENSION, "extension.json"),
  });

  return { mcp };
}

const call = async <T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> =>
  (await s.mcp.tools.invoke("starnet.remove_stars", input, { requestId: "r" })) as T;

async function awaitJob<T>(s: Setup, jobId: string): Promise<T> {
  const record = await new Promise<JobRecord>((resolve, reject) => {
    const timer = setInterval(() => {
      const job = s.mcp.jobs.get(jobId);
      if (job === null) {
        return;
      }
      if (job.state === "completed" || job.state === "failed" || job.state === "cancelled") {
        clearInterval(timer);
        resolve(job);
      }
    }, 10);
    setTimeout(() => {
      clearInterval(timer);
      reject(new Error("Job 이 끝나지 않았습니다"));
    }, 10_000);
  });

  if (record.state !== "completed") {
    // 객체를 문자열 보간하면 `[object Object]` 가 되어 원인을 못 본다.
    throw new Error(`Job ${record.state}: ${JSON.stringify(record.error)}`);
  }
  return record.result as T;
}

async function removeStars<T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> {
  const { jobId } = await call<{ jobId: string }>(s, input);
  return awaitJob<T>(s, jobId);
}

describe("등록", () => {
  it("Tool 하나만 노출한다", async () => {
    const s = await setup();
    const names = s.mcp.tools
      .list()
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("starnet."));

    expect(names).toEqual(["starnet.remove_stars"]);
  });

  it("**external 이다**", async () => {
    const s = await setup();
    expect(s.mcp.tools.get("starnet.remove_stars")?.permission).toBe("external");
  });

  it("**즉시 jobId 를 반환한다** — 실기에서 67초였다", async () => {
    /* 4032×6048 에서 67초가 나와 MCP 기본 타임아웃 60초를 넘겼다.
     * 실제 클라이언트에서 `-32001 Request timed out` 이 났던 그 경우다. */
    const s = await setup();
    const started = await call<{ jobId?: string }>(s);

    expect(started.jobId).toEqual(expect.any(String));
    expect(s.mcp.tools.get("starnet.remove_stars")?.description).toMatch(/jobId/u);
  });
});

describe("결과", () => {
  it("**레이어 두 장을 만든다** — 별 없는 것과 별", async () => {
    const s = await setup();
    const result = await removeStars<{
      starless: { name: string };
      stars: { name: string; blendMode: string };
    }>(s);

    expect(result.starless.name).toBe("StarNet 01");
    expect(result.stars.name).toBe("StarNet 01 별");
  });

  it("**별 레이어에 Screen 을 건다**", async () => {
    /* `--unscreen` 출력은 Screen 으로 얹어야 원래 밝기가 복원된다.
     * 걸지 않으면 검은 배경째 위를 덮어 문서가 온통 검게 보인다. */
    const s = await setup();
    const result = await removeStars<{ stars: { blendMode: string } }>(s);

    expect(result.stars.blendMode).toBe("screen");
  });

  it("둘 다 픽셀 레이어다", async () => {
    // 구워 돌려받은 결과라 스마트 오브젝트가 얻는 것이 없다.
    const s = await setup();
    const result = await removeStars<{ starless: { id: number }; stars: { id: number } }>(s);

    const layers = await s.mcp.engine.execute<{ id: number; type: string }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    for (const id of [result.starless.id, result.stars.id]) {
      expect(layers.find((layer) => layer.id === id)?.type).toBe("pixel");
    }
  });

  it("중간 파일 둘을 알려준다", async () => {
    const s = await setup();
    const result = await removeStars<{ files: string[] }>(s);

    expect(result.files).toHaveLength(2);
  });
});

describe("인자", () => {
  it("**출력 경로를 둘 다 넘긴다**", async () => {
    /* StarNet2 는 별 이미지 이름을 받는다 — StarXTerminator 와 다르다.
     * 그쪽은 스스로 이름을 정해 `outputs` 로 선언할 수 없다. */
    const args = argvAfter(await setup());
    const run = await args;

    expect(run).toContain("--unscreen");
    expect(run.some((arg) => arg.endsWith("_stars.tif"))).toBe(true);
  });

  it("**`=` 형식을 쓰지 않는다** — StarNet2 는 아예 안 받는다", async () => {
    /* 실기에서 확인했다. `--stride=128` 은
     * "PARSE ERROR: Couldn't find match for argument" 다. RC-Astro 와 반대다. */
    const s = await setup();
    await removeStars(s, { stride: 128 });

    const run = argv();
    expect(run).toContain("--stride");
    expect(run).toContain("128");
    expect(run.some((arg) => arg.includes("="))).toBe(false);
  });

  it("생략하면 Provider 기본값 256 이 쓰인다", async () => {
    // StarNet2 가 --machine-info 로 알려준 값이다. 짐작이 아니다.
    const s = await setup();
    await removeStars(s);

    expect(argv()).toContain("256");
  });
});

/** 한 번 돌리고 argv 를 돌려준다. */
async function argvAfter(s: Setup): Promise<string[]> {
  await removeStars(s);
  return argv();
}

describe("검증", () => {
  it("**홀수 stride 를 거절한다** — CLI 가 늦게 거절한다", async () => {
    /* CLI 는 "Stride should be even!" 으로 막지만 그때는 이미 내보내기가 끝난
     * 뒤다. 140MB 를 쓰고 나서 실패하지 않게 여기서 먼저 막는다. */
    const s = await setup();
    await expect(call(s, { stride: 127 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("범위를 검증한다", async () => {
    const s = await setup();
    await expect(call(s, { stride: 600 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});

describe("준비되지 않았을 때", () => {
  it("**Job 을 띄우지 않고 이유를 준다**", async () => {
    const s = await setup({ provider: false });

    const message = await call(s).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/StarNet2/u);
    expect(message).toMatch(/capabilities\.json/u);
    expect(message).not.toMatch(/NaN|undefined|\[object/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });

  it("**다른 starRemoval 처리기면 거절하고 대안을 말한다**", async () => {
    /* StarXTerminator 도 starRemoval 이다. 인자 모양이 달라 그대로 보내면
     * 실패하는데, 그때는 Job 안이라 이유가 묻힌다. */
    const s = await setup({ provider: "other" });

    const message = await call(s).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/rcastro\.sxt/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });
});
