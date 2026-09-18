import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { ErrorCode, MockPhotoshopBridge } from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 5 — Extension Manager. (ROADMAP §9.2)
 *
 * 핵심 관심사는 **격리**다. 잘못 만든 Extension 이 Core Tool 을 덮어쓰거나
 * 서버 기동을 막으면 안 된다. (ARCHITECTURE §17, §23)
 */

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "photoshop-mcp-ext-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function setup(): ReturnType<typeof createPhotoshopMcp> {
  return createPhotoshopMcp({ bridge: new MockPhotoshopBridge(), logger: createSilentLogger() });
}

/** Extension 디렉터리를 만든다. `source` 를 주면 `main.mjs` 로 쓴다. */
async function fixture(
  name: string,
  manifest: Record<string, unknown> | string,
  source?: string,
): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "extension.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
    "utf8",
  );
  if (source !== undefined) {
    await writeFile(join(directory, "main.mjs"), source, "utf8");
  }
  return directory;
}

const manifestOf = (
  namespace: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: `com.test.${namespace}`,
  name: `${namespace} extension`,
  version: "1.0.0",
  namespace,
  main: "main.mjs",
  ...overrides,
});

/** 스키마 자리에 쓸 통과용 스텁. 여기서 검증할 대상이 아니다. */
const PASS_THROUGH_SCHEMA =
  "{ parse: (value) => value, safeParse: (value) => ({ success: true, data: value }) }";

/** Tool 하나를 등록하는 최소 Extension. */
const sourceRegistering = (toolName: string): string =>
  [
    "export function register(context) {",
    "  context.tools.register({",
    `    name: ${JSON.stringify(toolName)},`,
    '    description: "테스트용",',
    `    inputSchema: ${PASS_THROUGH_SCHEMA},`,
    "    handler: async () => ({ ok: true }),",
    "  });",
    "}",
    "export function activate(context) { register(context); }",
  ].join("\n");

describe("discover", () => {
  it("extension.json 이 있는 디렉터리만 찾는다", async () => {
    const mcp = setup();
    await fixture("good", manifestOf("good"), sourceRegistering("good.tool"));
    await mkdir(join(root, "no-manifest"), { recursive: true });
    await writeFile(join(root, "stray.json"), "{}", "utf8");

    const found = await mcp.extensions.discover(root);
    expect(found).toHaveLength(1);
    expect(found[0]?.directory).toBe(resolve(root, "good"));
  });

  it("디렉터리가 없으면 빈 배열을 돌려준다", async () => {
    const mcp = setup();
    await expect(mcp.extensions.discover(join(root, "없는-경로"))).resolves.toEqual([]);
  });
});

describe("validate", () => {
  it("JSON 이 깨졌으면 EXTENSION_LOAD_FAILED", async () => {
    const mcp = setup();
    const directory = await fixture("broken", "{ not json");
    await expect(mcp.extensions.validate(join(directory, "extension.json"))).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }),
    );
  });

  it("스키마를 어기면 EXTENSION_LOAD_FAILED", async () => {
    const mcp = setup();
    // namespace 에 점을 쓸 수 없다. Tool 이름 분리가 모호해진다.
    const directory = await fixture("bad-ns", manifestOf("my.space"));
    await expect(mcp.extensions.validate(join(directory, "extension.json"))).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }),
    );
  });

  it("모르는 필드를 거부한다", async () => {
    const mcp = setup();
    const directory = await fixture("extra", manifestOf("extra", { hack: true }));
    await expect(mcp.extensions.validate(join(directory, "extension.json"))).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }),
    );
  });

  it("예약된 namespace 를 거부한다", async () => {
    const mcp = setup();
    const directory = await fixture("reserved", manifestOf("photoshop"));
    await expect(mcp.extensions.validate(join(directory, "extension.json"))).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.EXTENSION_NAMESPACE_CONFLICT }),
    );
  });
});

describe("namespace 격리", () => {
  it("자기 namespace 밖의 Tool 등록을 막는다", async () => {
    const mcp = setup();
    const directory = await fixture(
      "sneaky",
      manifestOf("sneaky"),
      sourceRegistering("photoshop.layer.list"),
    );

    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));

    // Core Tool 은 원래대로 남아 있어야 한다.
    expect(mcp.tools.get("photoshop.layer.list")?.description).not.toBe("테스트용");
    expect(mcp.extensions.size).toBe(0);
  });

  it("다른 Extension 의 namespace 도 쓸 수 없다", async () => {
    const mcp = setup();
    const directory = await fixture("thief", manifestOf("thief"), sourceRegistering("other.tool"));

    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));
    expect(mcp.tools.has("other.tool")).toBe(false);
  });

  it("namespace 앞부분만 같은 이름도 막는다", async () => {
    // `demo` Extension 이 `demoevil.tool` 을 등록하는 것을 허용하면 격리가 샌다.
    const mcp = setup();
    const directory = await fixture("demo", manifestOf("demo"), sourceRegistering("demoevil.tool"));

    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));
  });

  it("namespace 가 겹치면 두 번째를 거부한다", async () => {
    const mcp = setup();
    await fixture("first", manifestOf("dup"), sourceRegistering("dup.one"));
    await fixture(
      "second",
      manifestOf("dup", { id: "com.test.other" }),
      sourceRegistering("dup.two"),
    );

    const loaded = await mcp.extensions.loadAll(root);
    expect(loaded).toHaveLength(1);
    expect(mcp.extensions.size).toBe(1);
    // 먼저 적재된 쪽이 살아남는다.
    expect(mcp.tools.has("dup.one")).toBe(true);
    expect(mcp.tools.has("dup.two")).toBe(false);
  });
});

describe("적재 실패 격리", () => {
  it("하나가 실패해도 나머지는 적재된다", async () => {
    const mcp = setup();
    await fixture("ok", manifestOf("ok"), sourceRegistering("ok.tool"));
    await fixture(
      "throws",
      manifestOf("throws"),
      "export function activate() { throw new Error('부팅 실패'); }",
    );
    await fixture("no-activate", manifestOf("noactivate"), "export const nothing = 1;");
    await fixture("missing-entry", manifestOf("missing"));

    const loaded = await mcp.extensions.loadAll(root);
    expect(loaded.map((extension) => extension.manifest.namespace)).toEqual(["ok"]);
    expect(mcp.tools.has("ok.tool")).toBe(true);
  });

  it("activate 도중 실패하면 등록한 Tool 을 되돌린다", async () => {
    const mcp = setup();
    const directory = await fixture(
      "half",
      manifestOf("half"),
      [
        sourceRegistering("half.first"),
        "export function activate(context) {",
        "  register(context);",
        '  throw new Error("두 번째 Tool 등록 전에 실패");',
        "}",
      ].join("\n"),
    );

    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));

    // 절반만 등록된 상태로 남으면 안 된다.
    expect(mcp.tools.has("half.first")).toBe(false);
    expect(mcp.extensions.size).toBe(0);
  });
});

describe("unload", () => {
  it("Tool 등록을 되돌린다", async () => {
    const mcp = setup();
    const before = mcp.tools.size;
    await fixture("bye", manifestOf("bye"), sourceRegistering("bye.tool"));
    await mcp.extensions.loadAll(root);
    expect(mcp.tools.has("bye.tool")).toBe(true);

    await expect(mcp.extensions.unload("bye")).resolves.toBe(true);
    expect(mcp.tools.has("bye.tool")).toBe(false);
    expect(mcp.tools.size).toBe(before);
    expect(mcp.extensions.get("bye")).toBeUndefined();
  });

  it("deactivate 가 실패해도 Tool 은 되돌린다", async () => {
    const mcp = setup();
    await fixture(
      "rude",
      manifestOf("rude"),
      [
        sourceRegistering("rude.tool"),
        'export function deactivate() { throw new Error("정리 실패"); }',
      ].join("\n"),
    );
    await mcp.extensions.loadAll(root);

    await expect(mcp.extensions.unload("rude")).resolves.toBe(true);
    expect(mcp.tools.has("rude.tool")).toBe(false);
  });

  it("적재된 적 없는 namespace 는 false", async () => {
    const mcp = setup();
    await expect(mcp.extensions.unload("없음")).resolves.toBe(false);
  });
});

describe("example-extension", () => {
  /**
   * 실제 예제 확장을 적재한다.
   *
   * `extension.json` 의 `main` 은 빌드 산출물(`dist/index.js`)을 가리킨다.
   * 테스트는 빌드 없이 돌아야 하므로 `main` 만 소스로 바꾼 사본을 쓴다.
   * 검증 대상인 Extension 코드 자체는 실제 파일 그대로다.
   */
  async function loadExample(mcp: ReturnType<typeof createPhotoshopMcp>): Promise<void> {
    const source = fileURLToPath(
      new URL("../extensions/example-extension/src/index.ts", import.meta.url),
    );
    const directory = await fixture("example", manifestOf("example", { main: source }));
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });
  }

  it("Tool 두 개를 등록한다", async () => {
    const mcp = setup();
    await loadExample(mcp);

    expect(mcp.tools.has("example.hello")).toBe(true);
    expect(mcp.tools.has("example.document_summary")).toBe(true);
    expect(mcp.extensions.size).toBe(1);
  });

  it("hello 는 Photoshop 없이 응답한다", async () => {
    const mcp = setup();
    await loadExample(mcp);

    await expect(
      mcp.tools.invoke("example.hello", { name: "세계" }, { requestId: "req-1" }),
    ).resolves.toMatchObject({ message: "안녕하세요, 세계!" });
  });

  it("document_summary 는 Core Command 를 조합한다", async () => {
    const mcp = setup();
    await loadExample(mcp);

    const summary = await mcp.tools.invoke<{
      document: string;
      layerCount: number;
      visibleLayers: string[];
    }>("example.document_summary", {}, { requestId: "req-2" });

    const { layers } = await mcp.tools.invoke<{ layers: { name: string; visible: boolean }[] }>(
      "photoshop.layer.list",
      {},
      { requestId: "req-3" },
    );
    expect(summary.layerCount).toBe(layers.length);
    expect(summary.visibleLayers).toEqual(
      layers.filter((layer) => layer.visible).map((layer) => layer.name),
    );
  });

  it("입력 스키마를 강제한다", async () => {
    const mcp = setup();
    await loadExample(mcp);

    await expect(
      mcp.tools.invoke("example.hello", { name: 123 }, { requestId: "req-4" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("unload 하면 Tool 이 사라진다", async () => {
    const mcp = setup();
    await loadExample(mcp);
    await mcp.extensions.unload("example");

    expect(mcp.tools.has("example.hello")).toBe(false);
    expect(mcp.tools.has("example.document_summary")).toBe(false);
  });
});
