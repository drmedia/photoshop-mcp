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
 * RC-Astro CLI Extension.
 *
 * 고정하는 것은 셋이다.
 *
 * 1. **BXT 의 파라미터가 실제로 CLI 까지 간다** — 이름이 어긋나면 값이 조용히
 *    빠지고 레이어는 생기므로 성공으로 보인다
 * 2. **불리언은 `=` 형식으로 간다** — 실제 CLI 에서 `--lunar-planetary true` 는
 *    "true" 를 입력 파일로 읽는다. 값 옵션(`--sharpen-stars`)은 공백도 받지만
 *    전부 `=` 로 통일해 두었다
 * 3. **준비가 안 됐으면 부르는 자리에서 이유를 말한다** — Job 을 띄운 뒤
 *    실패하면 호출자가 status 를 한 번 더 불러야 이유를 안다
 */

let workspace: string;

const EXTENSION = fileURLToPath(new URL("../extensions/rcastro/", import.meta.url));

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "rcastro-"));
  process.env["RCASTRO_ARGV_LOG"] = join(workspace, "argv.json");
});

afterEach(async () => {
  delete process.env["RCASTRO_ARGV_LOG"];
  await rm(workspace, { recursive: true, force: true });
});

/**
 * 가짜 `rc-astro`.
 *
 * 받은 argv 를 남기고 출력 파일을 만든다. **argv 를 남기지 않으면 파라미터가
 * 빠진 것을 잡을 수 없다** — 결과 파일은 어느 쪽이든 생긴다.
 */
async function fakeRcAstro(): Promise<string> {
  const script = join(workspace, "rc-astro.cjs");
  const lines = [
    "const fs = require('node:fs');",
    "const a = process.argv.slice(2);",
    "fs.writeFileSync(process.env.RCASTRO_ARGV_LOG, JSON.stringify(a));",
    "const out = a[a.indexOf('--output') + 1];",
    "fs.writeFileSync(out, 'processed');",
    // **진짜와 같은 버릇을 흉내낸다** — sxt 는 별 이미지를 `--output` 옆에
    // `<stem>-stars.<ext>` 로 쓴다. 흉내내지 않으면 그 경로가 검증되지 않는다.
    "if (a[0] === 'sxt') { fs.writeFileSync(out.slice(0, -4) + '-stars.tif', 'stars'); }",
  ];
  await writeFile(script, lines.join("\n"), "utf8");
  return script;
}

/** 가짜 CLI 가 받은 argv. */
function argv(): string[] {
  return JSON.parse(readFileSync(process.env["RCASTRO_ARGV_LOG"] as string, "utf8")) as string[];
}

interface Setup {
  mcp: ReturnType<typeof createPhotoshopMcp>;
}

/**
 * @param options.provider `false` 면 처리기를 등록하지 않는다.
 *   `"other"` 면 `deconvolution` 은 있지만 `bxt` 가 아니다.
 */
async function setup(
  options: { provider?: false | "other"; allow?: string[] } = {},
): Promise<Setup> {
  const bridge = new MockPhotoshopBridge({
    workspacePath: workspace,
    // 외부 처리기는 진짜 파일을 읽고 쓴다. 메모리 기록만으로는
    // 내보낸 입력을 처리기가 못 찾고, 처리기가 만든 결과를 Mock 이 모른다.
    files: {
      write: (path) => writeFileSync(path, "내보낸 픽셀", "utf8"),
      exists: (path) => existsSync(path),
    },
  });

  const mcp = createPhotoshopMcp({
    bridge,
    logger: createSilentLogger(),
    policy: new PermissionPolicy((options.allow ?? ["read", "edit", "external"]) as never),
  });

  if (options.provider !== false) {
    /* **실제 `capabilities.example.json` 과 같은 모양으로 선언한다.**
     * 테스트만 다른 이름을 쓰면 Extension 과 설정이 갈라진 것을 못 잡는다. */
    const bxt: ProviderConfig = {
      id: options.provider === "other" ? "somethingelse" : "bxt",
      capability: "deconvolution",
      executable: process.execPath,
      args: [
        await fakeRcAstro(),
        "bxt",
        "{{input}}",
        "--sharpen-stars={{sharpenStars}}",
        "--sharpen-nonstellar={{sharpenNonstellar}}",
        "--adjust-star-halos={{starHalos}}",
        "--lunar-planetary={{lunarPlanetary}}",
        "--correct-only={{correctOnly}}",
        "--output",
        "{{output}}",
        "--overwrite",
      ],
      params: {
        sharpenStars: { type: "number", min: 0, max: 0.7, default: 0.5 },
        sharpenNonstellar: { type: "number", min: 0, max: 1, default: 0.5 },
        starHalos: { type: "number", min: -0.5, max: 0.5, default: 0 },
        lunarPlanetary: { type: "boolean", default: false },
        correctOnly: { type: "boolean", default: false },
      },
    };
    await mcp.capabilities.register(bxt);

    /* **겹치는 강도 옵션을 선언하지 않는다.** 실제 CLI 가 거절한다 —
     * "Conflicting denoise options: Denoise and Denoise Intensity both
     * control the intensity, high-frequency noise band."
     *
     * `buildArgs` 는 선언한 것을 항상 전부 보내므로 상위 `--denoise` 를 함께
     * 두면 모든 호출이 실패한다. 서로 겹치지 않는 intensity + color 쌍만 둔다. */
    const nxt: ProviderConfig = {
      id: options.provider === "other" ? "somethingelse-nxt" : "nxt",
      capability: "noiseReduction",
      executable: process.execPath,
      args: [
        await fakeRcAstro(),
        "nxt",
        "{{input}}",
        "--denoise-intensity={{denoiseIntensity}}",
        "--denoise-color={{denoiseColor}}",
        "--iterations={{iterations}}",
        "--output",
        "{{output}}",
        "--overwrite",
      ],
      params: {
        denoiseIntensity: { type: "number", min: 0, max: 1, default: 0.9 },
        denoiseColor: { type: "number", min: 0, max: 1, default: 0.9 },
        iterations: { type: "number", min: 1, max: 5, default: 2 },
      },
    };
    await mcp.capabilities.register(nxt);

    const sxt: ProviderConfig = {
      id: options.provider === "other" ? "somethingelse-sxt" : "sxt",
      capability: "starRemoval",
      executable: process.execPath,
      args: [
        await fakeRcAstro(),
        "sxt",
        "{{input}}",
        // `--unscreen` 이 요구하므로 고정으로 켠다. 파라미터로 두면 조합에 따라 실패한다.
        "--output-stars=true",
        "--unscreen={{unscreen}}",
        "--output",
        "{{output}}",
        "--overwrite",
      ],
      params: { unscreen: { type: "boolean", default: false } },
    };
    await mcp.capabilities.register(sxt);
  }

  await mcp.extensions.load({
    directory: EXTENSION,
    manifestPath: join(EXTENSION, "extension.json"),
  });

  return { mcp };
}

const call = async <T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> =>
  (await s.mcp.tools.invoke("rcastro.bxt", input, { requestId: "r" })) as T;

/** Job 이 끝날 때까지 기다려 결과를 돌려준다. */
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
    throw new Error(`Job ${record.state}: ${JSON.stringify(record.error) ?? "(이유 없음)"}`);
  }
  return record.result as T;
}

/** 선명화를 시작하고 결과까지 기다린다. */
async function sharpen<T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> {
  const { jobId } = await call<{ jobId: string }>(s, input);
  return awaitJob<T>(s, jobId);
}

const callDenoise = async <T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> =>
  (await s.mcp.tools.invoke("rcastro.nxt", input, { requestId: "r" })) as T;

/** 노이즈 감소를 시작하고 결과까지 기다린다. */
async function denoise<T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> {
  const { jobId } = await callDenoise<{ jobId: string }>(s, input);
  return awaitJob<T>(s, jobId);
}

describe("등록", () => {
  it("제품마다 Tool 하나씩", async () => {
    // rc-astro.exe 하나가 bxt · nxt 를 다 가진다. 한 설치 · 한 등록이다.
    const s = await setup();
    const names = s.mcp.tools
      .list()
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("rcastro."));

    expect(names).toEqual(["rcastro.bxt", "rcastro.nxt", "rcastro.sxt"]);
  });

  it("**external 이다** — 파일을 쓰고 외부 프로그램을 돈다", async () => {
    const s = await setup();
    expect(s.mcp.tools.get("rcastro.bxt")?.permission).toBe("external");
  });

  it("**읽기 전용 서버에서는 목록에 있고 호출이 막힌다**", async () => {
    /* 두 상한이 다른 지점에서 걸린다. manifest 는 **등록**을 막고,
     * 서버 정책(`PHOTOSHOP_MCP_ALLOW`)은 **호출**을 막는다.
     *
     * 등록까지 막힐 것으로 짐작했는데 아니었다. `tools/list` 는 정책으로
     * 걸러지지 않으므로, 쓸 수 없는 Tool 이 보이는 것이 정상 동작이다 —
     * 어느 권한을 켜야 하는지 알 수 있어야 하기 때문이다. */
    const s = await setup({ allow: ["read"] });

    expect(s.mcp.tools.get("rcastro.bxt")?.permission).toBe("external");
    await expect(call(s)).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED }),
    );
  });
});

describe("파라미터가 CLI 까지 간다", () => {
  it("**`=` 형식으로 간다**", async () => {
    /* 실기에서 확인했다. **불리언 플래그는 공백 형식이 안 된다** —
     * `--lunar-planetary true` 는 "true" 를 입력 파일로 읽고
     * "no files matched 'true'" 경고를 낸다.
     *
     * 값 옵션(`--sharpen-stars` · `--adjust-star-halos` ·
     * `--sharpen-nonstellar`)은 공백도 받는다. 그래도 전부 `=` 로 통일한다 —
     * 어느 것이 플래그인지 설정 파일을 보는 사람이 구분할 이유가 없다. */
    const s = await setup();
    await sharpen(s, { sharpenStars: 0.3 });

    expect(argv()).toContain("--sharpen-stars=0.3");
    expect(argv()).not.toContain("--sharpen-stars");
  });

  it("다섯 파라미터가 모두 전달된다", async () => {
    const s = await setup();
    await sharpen(s, {
      sharpenStars: 0.1,
      sharpenNonstellar: 0.9,
      starHalos: -0.4,
      lunarPlanetary: true,
      correctOnly: true,
    });

    const args = argv();
    expect(args).toContain("--sharpen-stars=0.1");
    expect(args).toContain("--sharpen-nonstellar=0.9");
    expect(args).toContain("--adjust-star-halos=-0.4");
    expect(args).toContain("--lunar-planetary=true");
    expect(args).toContain("--correct-only=true");
  });

  it("생략하면 Provider 기본값이 쓰인다", async () => {
    // Extension 에 기본값을 겹쳐 두지 않는다 — 두 곳이 갈라진다.
    const s = await setup();
    await sharpen(s);

    const args = argv();
    expect(args).toContain("--sharpen-stars=0.5");
    expect(args).toContain("--lunar-planetary=false");
  });

  it("`--overwrite` 를 넘긴다 — 없으면 CLI 가 거부한다", async () => {
    // 재시도할 때마다 출력이 이미 있으면 실패한다.
    const s = await setup();
    await sharpen(s);

    expect(argv()).toContain("--overwrite");
  });

  it("**16비트로 내보낸다** — BXT 의 depth 기본값이 입력과 같음이다", async () => {
    // 8비트로 넣으면 8비트로 나온다. 천체사진의 계조가 무너진다.
    const s = await setup();
    await sharpen(s);

    const written = (s.mcp.bridge as MockPhotoshopBridge).writtenFiles;
    expect(written.some((name) => name.endsWith(".tif"))).toBe(true);
  });
});

describe("범위 검증", () => {
  it("sharpenStars 상한은 0.7 이다", async () => {
    // CLI 가 [0, 0.7] 이다. 1 을 넣으면 CLI 가 거부하는데 그때는 Job 안이다.
    const s = await setup();
    await expect(call(s, { sharpenStars: 0.8 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("starHalos 는 음수를 받는다", async () => {
    // 헤일로를 줄이는 쪽이 음수다. 0 하한으로 두면 그 기능이 사라진다.
    const s = await setup();
    await expect(sharpen(s, { starHalos: -0.5 })).resolves.toBeDefined();
  });

  it("모르는 파라미터를 거절한다", async () => {
    // 오타를 조용히 무시하면 호출자가 값이 들어간 줄 안다.
    const s = await setup();
    await expect(call(s, { nonstellar: 0.5 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});

describe("결과", () => {
  it("새 레이어로 가져오고 기존 레이어를 바꾸지 않는다", async () => {
    const s = await setup();
    const result = await sharpen<{ layer: { name: string }; provider: string }>(s);

    expect(result.layer.name).toBe("BXT 01");
    expect(result.provider).toBe("bxt");
  });

  it("**픽셀 레이어로 가져온다** — 스마트 오브젝트를 만들지 않는다", async () => {
    /* 구워 돌려받은 결과라 스마트 오브젝트가 얻는 것이 없다. 그리고 나중에
     * 굽는 길이 마땅치 않다 — `stamp_visible` 로 우회하면 중간 SO 가 남고
     * 보이는 레이어가 1장이면 거절당한다. 실기에서 둘 다 겪었다. */
    const s = await setup();
    const result = await sharpen<{ layer: { id: number } }>(s);

    const layers = await s.mcp.engine.execute<{ id: number; type: string }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    const placed = layers.find((layer) => layer.id === result.layer.id);

    expect(placed?.type).toBe("pixel");
  });

  it("중간 파일을 알려준다", async () => {
    // 한 번에 큰 TIFF 가 둘 생긴다. 어느 것을 지울지 알아야 한다.
    const s = await setup();
    const result = await sharpen<{ files: string[] }>(s);

    expect(result.files.length).toBeGreaterThan(0);
  });

  it("**즉시 jobId 를 반환한다**", async () => {
    /* 실기에서 BXT 는 10초였지만 처리 시간은 이미지 크기에 따라 변한다.
     * StarNet2 가 4032×6048 에서 67초로 MCP 기본 타임아웃 60초를 넘겼다. */
    const s = await setup();
    const started = await call<{ jobId?: string }>(s);

    expect(started.jobId).toEqual(expect.any(String));
    expect(s.mcp.tools.get("rcastro.bxt")?.description).toMatch(/jobId/u);
  });
});

describe("준비되지 않았을 때", () => {
  it("**처리기가 없으면 Job 을 띄우지 않고 거절한다**", async () => {
    /* Job 을 띄운 뒤 실패하면 호출자가 jobId 를 받아 들고 status 를 한 번 더
     * 불러야 이유를 안다. 준비 문제는 부르는 자리에서 말한다. */
    const s = await setup({ provider: false });

    await expect(call(s)).rejects.toThrow(/capabilities/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });

  it("고치는 방법을 함께 준다", async () => {
    const s = await setup({ provider: false });

    const message = await call(s).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/capabilities\.json/u);
    expect(message).toMatch(/rc-astro/u);
    expect(message).not.toMatch(/NaN|undefined|\[object/u);
  });

  it("**bxt 가 아닌 처리기면 거절한다** — 파라미터 이름이 다르다", async () => {
    /* 이 Tool 은 BXT 의 옵션 이름을 그대로 넘긴다. 다른 처리기에 보내면
     * `buildArgs` 가 거부하는데, 그때는 Job 안이라 이유가 묻힌다. */
    const s = await setup({ provider: "other" });

    const message = await call(s).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/bxt/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });
});

describe("노이즈 감소 (NXT)", () => {
  it("**`denoise` 하나로 두 파라미터를 채운다**", async () => {
    /* CLI 가 상위 `--denoise` 와 하위 `--denoise-intensity` 를 **함께 주면
     * 거절한다** — 겹치는 대역을 둘이 제어하기 때문이다. Provider 는 겹치지
     * 않는 쌍만 선언하고, 편의 입력은 Extension 이 푼다. */
    const s = await setup();
    await denoise(s, { denoise: 0.4 });

    const args = argv();
    expect(args).toContain("--denoise-intensity=0.4");
    expect(args).toContain("--denoise-color=0.4");
    // 상위 옵션은 나가지 않는다. 나가면 실제 CLI 가 거절한다.
    expect(args.some((arg) => arg.startsWith("--denoise="))).toBe(false);
  });

  it("휘도와 색을 따로 줄 수 있다", async () => {
    // 천체사진은 색 노이즈를 휘도보다 세게 잡는 일이 흔하다.
    const s = await setup();
    await denoise(s, { denoiseIntensity: 0.3, denoiseColor: 0.95 });

    const args = argv();
    expect(args).toContain("--denoise-intensity=0.3");
    expect(args).toContain("--denoise-color=0.95");
  });

  it("**따로 준 값이 `denoise` 보다 우선한다**", async () => {
    // 둘 다 주면 세밀한 쪽이 이긴다. 규칙이 반대면 세밀한 지정이 무의미해진다.
    const s = await setup();
    await denoise(s, { denoise: 0.4, denoiseColor: 0.95 });

    const args = argv();
    expect(args).toContain("--denoise-intensity=0.4");
    expect(args).toContain("--denoise-color=0.95");
  });

  it("생략하면 Provider 기본값이 쓰인다", async () => {
    const s = await setup();
    await denoise(s);

    const args = argv();
    expect(args).toContain("--denoise-intensity=0.9");
    expect(args).toContain("--iterations=2");
  });

  it("nxt 서브커맨드로 간다 — bxt 와 섞이지 않는다", async () => {
    const s = await setup();
    await denoise(s);

    const args = argv();
    expect(args).toContain("nxt");
    expect(args).not.toContain("bxt");
  });

  it("픽셀 레이어로 가져오고 번호가 따로 매겨진다", async () => {
    // BXT 와 NXT 가 같은 카운터를 쓰면 어느 것이 무엇인지 알 수 없다.
    const s = await setup();
    const result = await denoise<{ layer: { id: number; name: string } }>(s);

    expect(result.layer.name).toBe("NXT 01");

    const layers = await s.mcp.engine.execute<{ id: number; type: string }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    expect(layers.find((layer) => layer.id === result.layer.id)?.type).toBe("pixel");
  });

  it("범위를 검증한다", async () => {
    const s = await setup();
    await expect(callDenoise(s, { iterations: 6 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("처리기가 없으면 Job 을 띄우지 않고 이유를 준다", async () => {
    const s = await setup({ provider: false });

    const message = await callDenoise(s).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/NoiseXTerminator/u);
    expect(message).toMatch(/capabilities\.json/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });
});

describe("별 분리 (SXT)", () => {
  const callSxt = async <T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> =>
    (await s.mcp.tools.invoke("rcastro.sxt", input, { requestId: "r" })) as T;

  async function removeStars<T>(s: Setup, input: Record<string, unknown> = {}): Promise<T> {
    const { jobId } = await callSxt<{ jobId: string }>(s, input);
    return awaitJob<T>(s, jobId);
  }

  it("**레이어 두 장을 만든다** — 별 없는 것과 별", async () => {
    const s = await setup();
    const result = await removeStars<{ layers: { id: number; name: string }[] }>(s);

    expect(result.layers.map((layer) => layer.name)).toEqual(["SXT 01", "SXT 01 별"]);
  });

  it("**별 레이어에 Screen 을 건다**", async () => {
    /* 걸지 않으면 별 이미지가 검은 배경째 위를 덮어 문서가 온통 검게 보인다 —
     * 무엇이 잘못됐는지 알 수 없다. unscreen 과 함께 쓰면 원본이 복원된다. */
    const s = await setup();
    const result = await removeStars<{ layers: { id: number }[] }>(s);

    const layers = await s.mcp.engine.execute<{ id: number; blendMode: string }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    const stars = layers.find((layer) => layer.id === result.layers[1]?.id);

    expect(stars?.blendMode).toBe("screen");
  });

  it("둘 다 픽셀 레이어다", async () => {
    const s = await setup();
    const result = await removeStars<{ layers: { id: number }[] }>(s);

    const layers = await s.mcp.engine.execute<{ id: number; type: string }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    for (const made of result.layers) {
      expect(layers.find((layer) => layer.id === made.id)?.type).toBe("pixel");
    }
  });

  it("**`--output-stars` 를 항상 켠다** — unscreen 이 요구한다", async () => {
    /* 실제 CLI 가 거절한다 —
     * "Conflicting options: Unscreen Stars (unscreen) must ..."
     * 파라미터로 두면 `buildArgs` 가 항상 보내므로 조합에 따라 실패한다. */
    const s = await setup();
    await removeStars(s, { unscreen: true });

    const args = argv();
    expect(args).toContain("--output-stars=true");
    expect(args).toContain("--unscreen=true");
  });

  it("`outputStars` 를 입력으로 받지 않는다", async () => {
    // 끌 수 있으면 되돌릴 수 없는 결과가 나온다.
    const s = await setup();
    await expect(callSxt(s, { outputStars: false })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("중간 파일에 별 이미지도 담긴다", async () => {
    // 한 번에 큰 TIFF 가 셋 생긴다. 어느 것을 지울지 알아야 한다.
    const s = await setup();
    const result = await removeStars<{ files: string[] }>(s);

    expect(result.files.some((file) => file.includes("-stars"))).toBe(true);
  });
});
