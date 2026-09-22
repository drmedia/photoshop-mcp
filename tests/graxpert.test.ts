import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  type JobRecord,
  type ProviderConfig,
} from "@photoshop-mcp/photoshop-bridge";
import { tiffHeader } from "../packages/mcp-core/src/capabilities/fits.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * GraXpert Extension — **CLI 경로.**
 *
 * 예전에는 GraXpert 의 Photoshop CEP 패널을 명령 파일로 구동했고, 이 파일도
 * 그 IPC 를 쟀다. 패널을 뗐으므로 **그 테스트들은 대상이 사라졌다** — 통과시키려고
 * 지운 것이 아니라 재던 코드가 없어졌다.
 *
 * 패널을 뗀 이유는 실기 측정이다. 전제가 둘이었고 둘 다 사람만 할 수 있었는데,
 * **패널을 여는 것은 Photoshop 알림을 하나도 남기지 않아** 자동화할 방법이
 * 없었다.
 *
 * 고정하는 것은 넷이다.
 *
 * 1. **Tool 두 개가 각자 Provider 를 못 박는다** — `noiseReduction` 은
 *    `rcastro.nxt` 도 제공한다
 * 2. **하늘 격리를 하지 않는다** — 그 판단은 호출자가 한다
 * 3. **준 값만 넘긴다** — 기본값을 겹쳐 두면 Provider 와 두 곳이 갈라진다
 * 4. **설정이 없으면 Job 을 띄우지 않는다** — 띄운 뒤 실패하면 이유가 묻힌다
 */

let workspace: string;

const EXTENSION = fileURLToPath(new URL("../extensions/graxpert/", import.meta.url));

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "graxpert-"));
  process.env["GRAXPERT_ARGV_LOG"] = join(workspace, "argv.json");
});

afterEach(async () => {
  delete process.env["GRAXPERT_ARGV_LOG"];
  await rm(workspace, { recursive: true, force: true });
});

/**
 * 가짜 GraXpert.
 *
 * 받은 argv 를 남기고 출력을 만든다. **`outputSuffix`·`convert` 는 선언하지
 * 않는다** — 실제 설정은 `out.tif.fits` 를 찾아 변환하지만 그 경로는
 * `fits.test.ts` 가 따로 재고, 여기서 재는 것은 Extension 의 흐름이다.
 */
async function fakeGraXpert(): Promise<string> {
  const script = join(workspace, "graxpert.cjs");
  const lines = [
    "const fs = require('node:fs');",
    "const a = process.argv.slice(2);",
    "fs.writeFileSync(process.env.GRAXPERT_ARGV_LOG, JSON.stringify(a));",
    // `-cmd <모드> <입력>` 이라 입력은 `-cmd` 에서 두 칸 뒤다.
    "const buf = fs.readFileSync(a[a.indexOf('-cmd') + 2]);",
    `for (let i = ${String(HEAD)}; i + 1 < buf.length; i += 2) {`,
    "  buf.writeUInt16LE(Math.max(0, buf.readUInt16LE(i) - 500), i);",
    "}",
    "fs.writeFileSync(a[a.indexOf('-output') + 1], buf);",
  ];
  await writeFile(script, lines.join("\n"), "utf8");
  return script;
}

/**
 * `tiffHeader` 의 길이는 이미지 크기와 무관하게 일정하다. 픽셀은 그 뒤부터다.
 *
 * 가짜 CLI 는 입력을 그대로 베끼면서 샘플을 500 낮춘다 — **"처리했다" 를 값으로
 * 확인할 수 있어야** 합성이 어느 쪽 픽셀을 골랐는지 가려진다.
 */
const HEAD = tiffHeader(1, 1).length;

/** 우리가 쓴 TIFF 에서 한 픽셀의 적색 값을 읽는다. */
function redAt(path: string, x: number, y: number): number {
  return readFileSync(path).readUInt16LE(HEAD + (y * W + x) * 6);
}

/** 가짜 CLI 가 받은 argv. */
function argv(): string[] {
  return JSON.parse(readFileSync(process.env["GRAXPERT_ARGV_LOG"] as string, "utf8")) as string[];
}

/**
 * Mock 이 쓰는 파일을 **진짜 16비트 TIFF** 로 만든다.
 *
 * 하늘 경로는 서버에서 `sky-fill` 을 실제로 돌린다 — 내용이 텍스트면 TIFF
 * 파싱에서 막힌다. 파일 이름에 `_mask` 가 있으면 마스크(위 20행 흰색)로,
 * 아니면 장면(위는 기울기, 아래는 어둠)으로 쓴다.
 */
const W = 32;
const H = 32;
const HORIZON = 20;

function writeTiffFile(path: string): void {
  const isMask = path.includes("_mask");
  const header = tiffHeader(W, H);
  const body = Buffer.alloc(W * H * 6);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const at = (y * W + x) * 6;
      let v: number;
      if (isMask) {
        v = y < HORIZON ? 65535 : 0;
      } else {
        v = y < HORIZON ? 4000 + y * 100 + x * 10 : 800;
      }
      body.writeUInt16LE(v, at);
      body.writeUInt16LE(v, at + 2);
      body.writeUInt16LE(v, at + 4);
    }
  }
  writeFileSync(path, Buffer.concat([header, body]));
}

interface Setup {
  mcp: ReturnType<typeof createPhotoshopMcp>;
}

interface Options {
  /** `false` 면 Provider 를 등록하지 않는다. */
  gradient?: false;
  denoise?: false;
  /** 다른 id 로 등록해 "Provider 가 다르다" 를 만든다. */
  gradientId?: string;
}

async function setup(options: Options = {}): Promise<Setup> {
  const bridge = new MockPhotoshopBridge({
    workspacePath: workspace,
    files: {
      write: (path) => {
        writeTiffFile(path);
      },
      exists: (path) => existsSync(path),
    },
  });

  const mcp = createPhotoshopMcp({
    bridge,
    logger: createSilentLogger(),
    policy: new PermissionPolicy(["read", "edit", "external"] as never),
  });

  const script = await fakeGraXpert();

  if (options.gradient !== false) {
    const gradient: ProviderConfig = {
      id: options.gradientId ?? "graxpert",
      capability: "gradientRemoval",
      executable: process.execPath,
      args: [
        script,
        "-cmd",
        "background-extraction",
        "{{input}}",
        "-cli",
        "-gpu",
        "{{gpu}}",
        "-correction",
        "{{correction}}",
        "-smoothing",
        "{{smoothing}}",
        "-output",
        "{{output}}",
      ],
      params: {
        correction: { type: "enum", values: ["Subtraction", "Division"], default: "Subtraction" },
        smoothing: { type: "number", min: 0, max: 1, default: 0.5 },
        gpu: { type: "boolean", default: true },
      },
    };
    await mcp.capabilities.register(gradient);
  }

  if (options.denoise !== false) {
    const denoise: ProviderConfig = {
      id: "graxpert-denoise",
      capability: "noiseReduction",
      executable: process.execPath,
      // `-cmd denoising` 이 그래디언트 제거와 다른 유일한 지점이다.
      args: [
        script,
        "-cmd",
        "denoising",
        "{{input}}",
        "-cli",
        "-gpu",
        "{{gpu}}",
        "-output",
        "{{output}}",
      ],
      params: { gpu: { type: "boolean", default: true } },
    };
    await mcp.capabilities.register(denoise);
  }

  await mcp.extensions.load({
    directory: EXTENSION,
    manifestPath: join(EXTENSION, "extension.json"),
  });

  return { mcp };
}

const call = async <T>(s: Setup, tool: string, input: Record<string, unknown> = {}): Promise<T> =>
  (await s.mcp.tools.invoke(tool, input, { requestId: "r" })) as T;

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
    throw new Error(`Job ${record.state}: ${JSON.stringify(record.error)}`);
  }
  return record.result as T;
}

async function run<T>(s: Setup, tool: string, input: Record<string, unknown> = {}): Promise<T> {
  const { jobId } = await call<{ jobId: string }>(s, tool, input);
  return awaitJob<T>(s, jobId);
}

describe("등록", () => {
  it("**Tool 은 둘이다** — 패널 상태 조회는 사라졌다", async () => {
    /* `gx.status` 는 패널이 살아 있는지 보는 것이었다. 패널을 떼면 볼 것이
     * 없고, Capability 사용 가능 여부는 photoshop.capability.list 가 답한다. */
    const s = await setup();
    const names = s.mcp.tools
      .list()
      .map((tool) => tool.name)
      .filter((name) => name.startsWith("gx."));

    expect(names.sort()).toEqual(["gx.run_denoise", "gx.run_gradient"]);
  });

  it("둘 다 external 이다", async () => {
    const s = await setup();
    for (const name of ["gx.run_gradient", "gx.run_denoise"]) {
      expect(s.mcp.tools.get(name)?.permission, name).toBe("external");
    }
  });

  it("**즉시 jobId 를 반환한다**", async () => {
    const s = await setup();
    const started = await call<{ jobId?: string }>(s, "gx.run_gradient");

    expect(started.jobId).toEqual(expect.any(String));
    expect(s.mcp.tools.get("gx.run_gradient")?.description).toMatch(/jobId/u);
  });
});

describe("결과", () => {
  it("**픽셀 레이어 한 장을 만든다**", async () => {
    const s = await setup();
    const result = await run<{ layer: { id: number; name: string } }>(s, "gx.run_gradient");

    expect(result.layer.name).toBe("GraXpert 01");

    const layers = await s.mcp.engine.execute<{ id: number; type: string }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    expect(layers.find((layer) => layer.id === result.layer.id)?.type).toBe("pixel");
  });

  it("노이즈 감소는 이름이 다르다", async () => {
    // 한 카운터를 쓰면 어느 것이 무엇인지 알 수 없다.
    const s = await setup();
    const result = await run<{ layer: { name: string } }>(s, "gx.run_denoise");

    expect(result.layer.name).toBe("GraXpert NR 01");
  });

  it("중간 파일을 알려준다", async () => {
    // 한 번 돌 때마다 140MB 가 둘 생긴다. 알려주지 않으면 쌓인 줄 모른다.
    const s = await setup();
    const result = await run<{ files: string[] }>(s, "gx.run_gradient");

    expect(result.files).toHaveLength(2);
  });

  it("**어느 Provider 로 돌았는지 담는다**", async () => {
    /* `noiseReduction` 은 rcastro.nxt 도 제공한다. 결과만 보고 구분되지
     * 않으면 설정에 따라 다른 것이 돌면서 호출자는 모른다. */
    const s = await setup();
    const result = await run<{ provider: string }>(s, "gx.run_denoise");

    expect(result.provider).toBe("graxpert-denoise");
  });
});

describe("인자", () => {
  it("**준 값을 그대로 넘긴다**", async () => {
    const s = await setup();
    await run(s, "gx.run_gradient", { correction: "Division", smoothing: 0.2, gpu: false });

    const a = argv();
    expect(a).toContain("Division");
    expect(a).toContain("0.2");
    expect(a).toContain("false");
  });

  it("생략하면 Provider 기본값이 쓰인다", async () => {
    // Extension 에 기본값을 겹쳐 두면 설정과 두 곳이 갈라진다.
    const s = await setup();
    await run(s, "gx.run_gradient");

    const a = argv();
    expect(a).toContain("Subtraction");
    expect(a).toContain("0.5");
  });

  it("**노이즈 감소는 다른 명령이다**", async () => {
    const s = await setup();
    await run(s, "gx.run_denoise");

    const a = argv();
    expect(a).toContain("denoising");
    expect(a).not.toContain("background-extraction");
  });
});

describe("하늘 격리", () => {
  it("**선택이 없으면 전체를 처리한다**", async () => {
    const s = await setup();
    const result = await run<{ selectionAtStart: boolean; skyApplied: boolean; files: string[] }>(
      s,
      "gx.run_gradient",
    );

    expect(result.selectionAtStart).toBe(false);
    expect(result.skyApplied).toBe(false);
    // 내보내기와 출력 둘뿐이다. 마스크도 준비 파일도 없다.
    expect(result.files).toHaveLength(2);
  });

  it("**선택이 있으면 마스크를 내보내고 하늘에만 건다**", async () => {
    /* 지상부를 하늘의 연장 평면으로 덮어서 넣는다. 그러지 않으면 산·나무가
     * 배경 모델을 끌어당겨 하늘에서 뺄 것을 거의 못 찾는다(ROADMAP §19). */
    const s = await setup();
    await s.mcp.engine.execute(
      { type: "SELECTION_SET", params: { shape: "canvas" } },
      { requestId: "sel" },
    );

    const result = await run<{
      selectionAtStart: boolean;
      skyApplied: boolean;
      files: string[];
      layer: { id: number };
    }>(s, "gx.run_gradient");

    expect(result.selectionAtStart).toBe(true);
    expect(result.skyApplied).toBe(true);
    // 내보내기 · 출력 · 마스크 · 준비 파일 넷이다.
    expect(result.files).toHaveLength(4);
    expect(result.files.some((name) => name.includes("_mask"))).toBe(true);
  });

  it("**결과는 통짜 한 장이다 — 하늘은 처리본, 지상은 원본**", async () => {
    /* 예전에는 결과를 그대로 놓고 Photoshop 마스크를 씌웠다. 화면은 같지만
     * **그 레이어 하나는 지상이 투명하다.** 투명은 뒤따르는 작업마다 걸린다 —
     * `document.statistics` 는 알파를 안 보고 RGB 만 읽어 투명한 곳이 0 으로
     * 섞인다. 실기에서 첫 측정이 바로 그것에 걸렸다. (ROADMAP §19)
     *
     * 그래서 재는 것은 **파일의 픽셀**이다. 마스크가 있는지 없는지가 아니라
     * 어느 쪽 픽셀이 들어갔는지가 이 설계의 내용이다. */
    const s = await setup();
    await s.mcp.engine.execute(
      { type: "SELECTION_SET", params: { shape: "canvas" } },
      { requestId: "sel" },
    );

    const result = await run<{ files: string[]; layer: { id: number } }>(s, "gx.run_gradient");
    const output = join(workspace, result.files[1] as string);

    /* 하늘(y < HORIZON)은 처리본이다. 가짜 CLI 가 500 을 뺐다. */
    expect(redAt(output, 5, 5)).toBe(4000 + 5 * 100 + 5 * 10 - 500);

    /* 지상(y >= HORIZON)은 **원본 그대로**다. 덮어 넣은 가짜 평면도 아니고
     * 거기서 500 을 뺀 값도 아니다 — 원본 800 이어야 한다. */
    expect(redAt(output, 5, HORIZON + 5)).toBe(800);

    // 그리고 마스크를 남기지 않는다. 투명한 곳이 없어야 하기 때문이다.
    const layers = await s.mcp.engine.execute<{ id: number; hasMask?: boolean }[]>(
      { type: "LAYER_LIST", params: {} },
      { requestId: "r" },
    );
    expect(layers.find((layer) => layer.id === result.layer.id)?.hasMask).not.toBe(true);
  });

  it("**노이즈 감소는 선택을 보지 않는다**", async () => {
    /* 하늘 격리는 배경 추출의 문제다. 노이즈 감소는 전체에 거는 것이
     * 맞고, 선택이 있다고 다르게 굴면 호출자가 예측할 수 없다. */
    const s = await setup();
    await s.mcp.engine.execute(
      { type: "SELECTION_SET", params: { shape: "canvas" } },
      { requestId: "sel" },
    );

    const result = await run<{ selectionAtStart: boolean; skyApplied: boolean }>(
      s,
      "gx.run_denoise",
    );

    expect(result.selectionAtStart).toBe(false);
    expect(result.skyApplied).toBe(false);
  });

  it("**설명이 어느 쪽으로 가는지 말한다**", async () => {
    const s = await setup();
    const text = s.mcp.tools.get("gx.run_gradient")?.description ?? "";

    expect(text).toMatch(/selection\.sky/u);
    expect(text).toMatch(/skyApplied/u);
  });
});

describe("준비되지 않았을 때", () => {
  it("**Job 을 띄우지 않고 이유를 준다**", async () => {
    const s = await setup({ gradient: false });

    const message = await call(s, "gx.run_gradient").then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/GraXpert/u);
    expect(message).toMatch(/capabilities\.json/u);
    expect(message).not.toMatch(/NaN|undefined|\[object/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });

  it("**다른 Provider 면 거절한다**", async () => {
    /* `gradientRemoval` 을 다른 처리기가 제공할 수 있다. 인자 모양이 달라
     * 그대로 보내면 실패하는데, 그때는 Job 안이라 이유가 묻힌다. */
    const s = await setup({ gradientId: "somethingelse" });

    const message = await call(s, "gx.run_gradient").then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/graxpert/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });

  it("노이즈 감소도 따로 본다", async () => {
    // 그래디언트 제거만 설정해 둔 사람이 노이즈 감소를 부를 수 있다.
    const s = await setup({ denoise: false });

    const message = await call(s, "gx.run_denoise").then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );

    expect(message).toMatch(/graxpert-denoise/u);
    expect(s.mcp.jobs.list()).toHaveLength(0);
  });
});

describe("스키마", () => {
  it("**강도를 받지 않는다** — CLI 에 플래그가 없다", async () => {
    /* 없는 파라미터를 스키마에 두고 조용히 무시하면 호출자는 걸렸다고 믿는다.
     * GraXpert CLI 에 `-cmd denoising` 용 플래그가 하나도 없다. */
    const s = await setup();
    await expect(call(s, "gx.run_denoise", { strength: 0.5 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("0–1 밖을 거절한다", async () => {
    const s = await setup();
    await expect(call(s, "gx.run_gradient", { smoothing: 1.5 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("모르는 필드를 거절한다", async () => {
    const s = await setup();
    await expect(call(s, "gx.run_gradient", { mergeSky: true })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});
