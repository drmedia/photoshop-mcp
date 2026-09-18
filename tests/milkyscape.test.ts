import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  type LayerInfo,
  type ProviderConfig,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * MilkyScape Extension. (ROADMAP §10)
 *
 * 기존 MilkyScape 패널의 원칙을 지키는지 검증한다.
 *
 * - 매번 새 결과 레이어를 만든다. 기존 것을 덮어쓰거나 지우지 않는다.
 * - 결과 이름에 도구·기능·실행 번호를 넣는다.
 * - 자동 연쇄 처리하지 않는다.
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "milky-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/** 입력을 읽어 두 출력을 만드는 가짜 StarNet2. */
async function fakeStarNet(): Promise<string> {
  const script = join(workspace, "starnet.cjs");
  const lines = [
    "const fs = require('node:fs');",
    "const a = process.argv.slice(2);",
    "const get = (f) => a[a.indexOf(f) + 1];",
    "fs.writeFileSync(get('--output'), 'starless');",
    "fs.writeFileSync(get('--unscreen'), 'stars');",
  ];
  await writeFile(script, lines.join("\n"), "utf8");
  return script;
}

async function fakeBxt(): Promise<string> {
  const script = join(workspace, "bxt.cjs");
  const lines = [
    "const fs = require('node:fs');",
    "const a = process.argv.slice(2);",
    "fs.writeFileSync(a[a.indexOf('--output') + 1], 'sharp');",
  ];
  await writeFile(script, lines.join("\n"), "utf8");
  return script;
}

/**
 * 가짜 GraXpert.
 *
 * 진짜와 같은 버릇을 흉내낸다 — 요청한 이름에 `.fits` 를 덧붙인 파일을 만든다.
 * 이 버릇을 흉내내지 않으면 Provider 의 `outputSuffix` · `convert` 가 검증되지 않는다.
 */
async function fakeGraXpert(): Promise<string> {
  const script = join(workspace, "graxpert.cjs");
  const lines = [
    "const fs = require('node:fs');",
    "const a = process.argv.slice(2);",
    "const cards = ['SIMPLE  =                    T','BITPIX  =                  -32',",
    "  'NAXIS   =                    2','NAXIS1  =                    2',",
    "  'NAXIS2  =                    1','END'].map((t) => t.padEnd(80)).join('');",
    "const header = Buffer.alloc(2880, 0x20);",
    "header.write(cards, 0, 'ascii');",
    "const data = Buffer.alloc(2880);",
    "data.writeFloatBE(0.5, 0);",
    "data.writeFloatBE(0.25, 4);",
    "fs.writeFileSync(a[a.indexOf('-output') + 1] + '.fits', Buffer.concat([header, data]));",
  ];
  await writeFile(script, lines.join("\n"), "utf8");
  return script;
}

interface Setup {
  mcp: ReturnType<typeof createPhotoshopMcp>;
  bridge: MockPhotoshopBridge;
}

async function setup(options: { providers?: boolean; approved?: boolean } = {}): Promise<Setup> {
  const bridge = new MockPhotoshopBridge({
    workspacePath: options.approved === false ? null : workspace,
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
    policy: new PermissionPolicy(["read", "edit", "external"]),
  });

  if (options.providers !== false) {
    const starnet: ProviderConfig = {
      id: "starnet2",
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
      ],
      outputs: { stars: {} },
    };
    const bxt: ProviderConfig = {
      id: "bxt",
      capability: "deconvolution",
      executable: process.execPath,
      args: [await fakeBxt(), "{{input}}", "--output", "{{output}}", "--ns", "{{nonstellar}}"],
      params: { nonstellar: { type: "number", min: 0, max: 1, default: 0.5 } },
    };
    const graxpert: ProviderConfig = {
      id: "graxpert",
      capability: "gradientRemoval",
      executable: process.execPath,
      args: [
        await fakeGraXpert(),
        "-cmd",
        "background-extraction",
        "{{input}}",
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
      },
      outputSuffix: ".fits",
      convert: "fitsToTiff",
    };
    mcp.capabilities.register(starnet);
    mcp.capabilities.register(bxt);
    mcp.capabilities.register(graxpert);
  }

  const directory = join(workspace, "milkyscape");
  await mkdir(directory, { recursive: true });
  const source = fileURLToPath(new URL("../extensions/milkyscape/src/index.ts", import.meta.url));
  await writeFile(
    join(directory, "extension.json"),
    JSON.stringify({
      id: "com.drmedia.milkyscape",
      name: "MilkyScape Tools",
      version: "0.1.0",
      namespace: "milky",
      main: source,
      permissions: ["photoshop.read", "photoshop.edit", "photoshop.external"],
    }),
    "utf8",
  );
  await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });

  return { mcp, bridge };
}

const call = async <T>(s: Setup, name: string, input: unknown = {}): Promise<T> =>
  s.mcp.tools.invoke<T>(name, input, { requestId: "milky" });

/**
 * Job 이 끝날 때까지 기다린다.
 *
 * `remove_stars` 는 즉시 jobId 를 돌려준다. MCP 요청 안에서 끝낼 수 없기 때문이다.
 * 테스트는 그 뒤를 확인해야 하므로 여기서 기다린다.
 */
async function awaitJob<T>(s: Setup, jobId: string, timeoutMs = 20000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const record = s.mcp.jobs.get(jobId);
    if (record === null) {
      throw new Error(`Job 이 사라졌습니다: ${jobId}`);
    }
    if (record.state === "completed") {
      return record.result as T;
    }
    if (record.state === "failed") {
      const error = record.error;
      throw Object.assign(new Error(error?.message ?? "Job 실패"), {
        code: error?.code,
        details: error?.details,
      });
    }
    if (record.state === "cancelled") {
      throw new Error("Job 이 취소되었습니다");
    }
    if (Date.now() > deadline) {
      throw new Error(`Job 이 끝나지 않았습니다: ${record.state}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 별 분리를 시작하고 결과까지 기다린다. */
async function removeStars<T>(s: Setup): Promise<T> {
  const { jobId } = await call<{ jobId: string }>(s, "milky.remove_stars");
  return awaitJob<T>(s, jobId);
}

describe("적재", () => {
  it("Tool 5개를 등록한다", async () => {
    const s = await setup();
    for (const name of [
      "milky.get_state",
      "milky.remove_stars",
      "milky.restore_stars",
      "milky.remove_gradient",
      "milky.enhance",
    ]) {
      expect(s.mcp.tools.has(name), name).toBe(true);
    }
  });

  it("Core Tool 을 덮어쓰지 않는다", async () => {
    const s = await setup();
    expect(s.mcp.tools.get("photoshop.layer.list")?.permission).toBe("read");
  });
});

describe("get_state", () => {
  it("문서·폴더·처리기·결과를 함께 보고한다", async () => {
    const s = await setup();
    const state = await call<{
      document: { name: string; layerCount: number };
      workspace: { approved: boolean };
      capabilities: { available: string[] };
      results: { starless: unknown; stars: unknown };
    }>(s, "milky.get_state");

    expect(state.document.name).toBe("test.psd");
    expect(state.workspace.approved).toBe(true);
    expect(state.capabilities.available).toEqual([
      "deconvolution",
      "gradientRemoval",
      "starRemoval",
    ]);
    expect(state.results.starless).toBeNull();
  });

  it("막힌 이유를 알려준다", async () => {
    // 무엇이 왜 안 되는지 말해주지 않으면 사용자가 고칠 수 없다.
    const s = await setup({ providers: false, approved: false });
    const state = await call<{ blocked: string[] }>(s, "milky.get_state");

    expect(state.blocked.some((r) => r.includes("작업 폴더"))).toBe(true);
    expect(state.blocked.some((r) => r.includes("StarNet2"))).toBe(true);
    expect(state.blocked.some((r) => r.includes("GraXpert"))).toBe(true);
  });

  it("read 권한만으로도 동작한다", async () => {
    // 무엇이 막혔는지 알아내는 경로까지 막으면 원인을 알 수 없다.
    const s = await setup();
    expect(s.mcp.tools.get("milky.get_state")?.permission).toBe("read");
  });
});

describe("remove_stars", () => {
  it("별 제거본과 별 레이어를 만든다", async () => {
    const s = await setup();
    const result = await removeStars<{
      starless: { id: number; name: string };
      stars: { id: number; name: string; blendMode: string };
      provider: string;
    }>(s);

    expect(result.starless.name).toBe("StarNet2_별제거_01");
    expect(result.stars.name).toBe("StarNet2_별_01");
    // 별은 스크린으로 겹쳐야 원래 밝기가 복원된다.
    expect(result.stars.blendMode).toBe("screen");
    expect(result.provider).toBe("starnet2");
  });

  it("기존 레이어를 지우지 않는다", async () => {
    const s = await setup();
    const before = (await call<{ layers: LayerInfo[] }>(s, "photoshop.layer.list")).layers;

    await removeStars(s);

    const after = (await call<{ layers: LayerInfo[] }>(s, "photoshop.layer.list")).layers;
    expect(after.length).toBe(before.length + 2);
    for (const layer of before) {
      expect(
        after.some((entry) => entry.id === layer.id),
        `${layer.name} 이 사라졌습니다`,
      ).toBe(true);
    }
  });

  it("여러 번 실행하면 번호가 올라간다", async () => {
    // 매번 새 결과를 만든다. 기존 결과를 덮어쓰지 않는다.
    const s = await setup();
    const first = await removeStars<{ starless: { name: string } }>(s);
    const second = await removeStars<{ starless: { name: string } }>(s);

    expect(first.starless.name).toBe("StarNet2_별제거_01");
    expect(second.starless.name).toBe("StarNet2_별제거_02");
  });

  it("실패한 실행이 다음 시도를 막지 않는다", async () => {
    // 실기에서 나온 문제다. 내보내기는 성공했는데 처리기에서 실패하면 파일은 남고
    // 레이어는 안 만들어져 번호가 그대로다. 임시 파일 이름을 레이어 번호에서
    // 파생하면 재시도가 FILE_ALREADY_EXISTS 로 영구히 막힌다.
    const s = await setup({ providers: false });
    await expect(removeStars(s)).rejects.toThrow();

    // 처리기를 붙이고 다시 시도하면 성공해야 한다.
    const script = await fakeStarNet();
    s.mcp.capabilities.register({
      id: "starnet2",
      capability: "starRemoval",
      executable: process.execPath,
      args: [
        script,
        "--input",
        "{{input}}",
        "--output",
        "{{output}}",
        "--unscreen",
        "{{output.stars}}",
      ],
      outputs: { stars: {} },
    });

    await expect(removeStars<{ starless: { name: string } }>(s)).resolves.toMatchObject({
      starless: { name: "StarNet2_별제거_01" },
    });
  });

  it("작업 폴더가 없으면 막힌다", async () => {
    const s = await setup({ approved: false });
    await expect(removeStars(s)).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_APPROVED }),
    );
  });

  it("처리기가 없으면 COMMAND_NOT_SUPPORTED", async () => {
    const s = await setup({ providers: false });
    await expect(removeStars(s)).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
  });

  it("external 권한이 필요하다", async () => {
    const s = await setup();
    expect(s.mcp.tools.get("milky.remove_stars")?.permission).toBe("external");
  });
});

describe("restore_stars", () => {
  it("가장 최근 별 레이어를 스크린으로 만든다", async () => {
    const s = await setup();
    await removeStars(s);
    await call(s, "photoshop.layer.set_blend_mode", { blendMode: "normal" });

    const restored = await call<{ name: string; blendMode: string }>(s, "milky.restore_stars");
    expect(restored.name).toBe("StarNet2_별_01");
    expect(restored.blendMode).toBe("screen");
  });

  it("불투명도를 함께 조절할 수 있다", async () => {
    const s = await setup();
    await removeStars(s);

    await expect(
      call<{ opacity: number; blendMode: string }>(s, "milky.restore_stars", { opacity: 60 }),
    ).resolves.toMatchObject({ opacity: 60, blendMode: "screen" });
  });

  it("별 레이어가 없으면 안내한다", async () => {
    const s = await setup();
    await expect(call(s, "milky.restore_stars")).rejects.toThrow(/remove_stars/u);
  });

  it("Photoshop 밖에 닿지 않으므로 edit 권한이면 된다", async () => {
    const s = await setup();
    expect(s.mcp.tools.get("milky.restore_stars")?.permission).toBe("edit");
  });
});

describe("remove_gradient", () => {
  /** 그래디언트 제거를 시작하고 결과까지 기다린다. */
  async function removeGradient<T>(s: Setup, input?: Record<string, unknown>): Promise<T> {
    const { jobId } = await call<{ jobId: string }>(s, "milky.remove_gradient", input);
    return awaitJob<T>(s, jobId);
  }

  it("FITS 만 내놓는 처리기의 결과를 TIFF 레이어로 가져온다", async () => {
    // GraXpert 는 `.fits` 를 덧붙이고 Photoshop 은 FITS 를 못 읽는다.
    // 그 보정이 Provider 설정에 있어서 Extension 이 몰라도 되는지 본다.
    const s = await setup();
    const result = await removeGradient<{
      layer: { name: string };
      provider: string;
      converted?: Record<string, string>;
    }>(s);

    expect(result.layer.name).toBe("GraXpert_그래디언트제거_01");
    expect(result.provider).toBe("graxpert");
    expect(result.converted?.["output"]).toContain("2x1");
  });

  it("여러 번 실행하면 번호가 올라간 새 레이어가 쌓인다", async () => {
    const s = await setup();
    await removeGradient(s);
    const second = await removeGradient<{ layer: { name: string } }>(s);
    expect(second.layer.name).toBe("GraXpert_그래디언트제거_02");
  });

  it("선언되지 않은 보정 값을 거부한다", async () => {
    const s = await setup();
    await expect(call(s, "milky.remove_gradient", { correction: "Whatever" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("Photoshop 밖으로 나가므로 external 권한이 필요하다", async () => {
    const s = await setup();
    expect(s.mcp.tools.get("milky.remove_gradient")?.permission).toBe("external");
  });

  it("처리기가 없으면 막힌 이유로 알려준다", async () => {
    const s = await setup({ providers: false });
    const state = await call<{ blocked: string[] }>(s, "milky.get_state");
    expect(state.blocked.join(" ")).toMatch(/GraXpert/u);
  });
});

describe("enhance", () => {
  it("선명화 결과를 새 레이어로 가져온다", async () => {
    const s = await setup();
    const result = await call<{ layer: { name: string }; provider: string }>(s, "milky.enhance");
    expect(result.layer.name).toBe("BXT_선명화_01");
    expect(result.provider).toBe("bxt");
  });

  it("강도 범위를 검증한다", async () => {
    const s = await setup();
    await expect(call(s, "milky.enhance", { nonstellar: 1.5 })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });
});

describe("자동 연쇄 처리하지 않는다", () => {
  it("enhance 가 remove_stars 결과를 자동으로 먹지 않는다", async () => {
    // 한 기능의 결과를 다음 기능이 알아서 입력으로 삼지 않는다. (개발계획서 §5.2)
    const s = await setup();
    await removeStars(s);

    const result = await call<{ layer: { name: string } }>(s, "milky.enhance");
    // 별 제거본이 아니라 문서 전체를 대상으로 한다.
    expect(result.layer.name).toBe("BXT_선명화_01");

    const layers = (await call<{ layers: LayerInfo[] }>(s, "photoshop.layer.list")).layers;
    expect(layers.filter((entry) => entry.name.startsWith("StarNet2_")).length).toBe(2);
  });
});

describe("실제 MCP 클라이언트", () => {
  /**
   * Extension 의 긴 Tool 을 **서버 내부 API 가 아니라 MCP 로** 부른다.
   *
   * `tools.invoke` 에는 타임아웃이 없다. 그래서 실기에서 StarNet2 가 67초 걸렸을 때
   * 내부 호출로는 멀쩡해 보였고 실제 클라이언트에서만 `-32001` 이 났다.
   * 긴 Tool 을 추가할 때마다 이 경로로 확인해야 한다. (ROADMAP §14)
   */
  async function connect(s: Setup): Promise<{ client: Client; close: () => Promise<void> }> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "milky-test", version: "0.0.0" });
    await Promise.all([s.mcp.server.start(serverTransport), client.connect(clientTransport)]);
    return {
      client,
      close: async () => {
        s.mcp.jobs.cancelAll();
        await client.close();
        await s.mcp.server.stop();
      },
    };
  }

  function body(result: unknown): Record<string, unknown> {
    const content = (result as { content?: { type: string; text: string }[] }).content;
    const first = content?.[0];
    if (first === undefined || first.type !== "text") {
      throw new Error("텍스트 content 가 없습니다.");
    }
    return JSON.parse(first.text) as Record<string, unknown>;
  }

  it("긴 Tool 이 짧은 요청 타임아웃 안에 jobId 를 돌려준다", async () => {
    const s = await setup();
    const { client, close } = await connect(s);
    try {
      // 실제 처리 시간보다 짧은 타임아웃. 기다리는 구현이면 여기서 깨진다.
      for (const name of ["milky.remove_stars", "milky.remove_gradient"]) {
        const result = await client.callTool({ name, arguments: {} }, undefined, {
          timeout: 500,
        });
        expect(body(result)["jobId"], `${name} 이 jobId 를 돌려주지 않았습니다`).toEqual(
          expect.any(String),
        );
      }
    } finally {
      await close();
    }
  });

  it("tools/list 에 milky Tool 5개가 스키마와 함께 나온다", async () => {
    const s = await setup();
    const { client, close } = await connect(s);
    try {
      const { tools } = await client.listTools();
      const milky = tools.filter((tool) => tool.name.startsWith("milky."));
      expect(milky.map((tool) => tool.name).sort()).toEqual([
        "milky.enhance",
        "milky.get_state",
        "milky.remove_gradient",
        "milky.remove_stars",
        "milky.restore_stars",
      ]);
      for (const tool of milky) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    } finally {
      await close();
    }
  });
});
