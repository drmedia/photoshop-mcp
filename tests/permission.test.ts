import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandEngine, CommandRegistry } from "@photoshop-mcp/command-engine";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import {
  DEFAULT_ALLOWED_LEVELS,
  ErrorCode,
  MockPhotoshopBridge,
  PermissionPolicy,
  ToolRegistry,
  parsePermissionLevels,
  permissionToLevel,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
// CLI 전용 부트스트랩이라 public API 가 아니다. 테스트하려고 표면을 넓히지 않는다.
import { readOptionsFromEnv } from "../packages/mcp-server/src/run.js";

/**
 * Phase 9 — Permission / Safety. (ROADMAP §13, ARCHITECTURE §22)
 *
 * 가장 중요한 성질은 **Command Engine 이 강제 지점**이라는 것이다.
 * Extension 은 Tool 을 거치지 않고 Command 를 직접 호출할 수 있으므로
 * (ARCHITECTURE §3.2), Tool 에서만 막으면 우회로가 생긴다.
 */

const denied = expect.objectContaining({ code: ErrorCode.PERMISSION_DENIED });

describe("PermissionPolicy", () => {
  it("기본값은 read 와 edit 만 허용한다", () => {
    const policy = new PermissionPolicy();
    expect(policy.allowed).toEqual([...DEFAULT_ALLOWED_LEVELS]);
    expect(policy.isAllowed("read")).toBe(true);
    expect(policy.isAllowed("edit")).toBe(true);
    expect(policy.isAllowed("external")).toBe(false);
    expect(policy.isAllowed("destructive")).toBe(false);
  });

  it("허용 목록은 위험도 오름차순으로 정규화된다", () => {
    const policy = new PermissionPolicy(["destructive", "read", "edit"]);
    expect(policy.allowed).toEqual(["read", "edit", "destructive"]);
  });

  it("거부 메시지에 요구 권한과 현재 허용을 함께 담는다", () => {
    const policy = new PermissionPolicy(["read"]);
    try {
      policy.assert("destructive", { kind: "tool", name: "photoshop.layer.delete" });
      expect.unreachable("거부되지 않았습니다");
    } catch (error) {
      expect(error).toEqual(denied);
      expect((error as { details: unknown }).details).toEqual({
        required: "destructive",
        allowed: ["read"],
        kind: "tool",
        name: "photoshop.layer.delete",
      });
    }
  });

  it("restrictTo 는 좁히기만 한다", () => {
    const policy = new PermissionPolicy(["read", "edit"]);
    // 가진 적 없는 destructive 를 달라고 해도 얻을 수 없다.
    expect(policy.restrictTo(["read", "destructive"]).allowed).toEqual(["read"]);
    expect(policy.restrictTo([]).allowed).toEqual([]);
  });
});

describe("parsePermissionLevels", () => {
  it("값이 없으면 기본값", () => {
    expect(parsePermissionLevels(undefined).levels).toEqual([...DEFAULT_ALLOWED_LEVELS]);
    expect(parsePermissionLevels("   ").levels).toEqual([...DEFAULT_ALLOWED_LEVELS]);
  });

  it("주어진 값이 전체 목록이다. 기본값에 더하지 않는다", () => {
    // 읽기 전용 서버를 만들 수 있어야 하므로 덧셈이 아니라 대체다.
    expect(parsePermissionLevels("read").levels).toEqual(["read"]);
    expect(parsePermissionLevels("destructive").levels).toEqual(["destructive"]);
  });

  it("all 과 none 을 지원한다", () => {
    expect(parsePermissionLevels("all").levels).toEqual([
      "read",
      "edit",
      "external",
      "destructive",
    ]);
    expect(parsePermissionLevels("none").levels).toEqual([]);
  });

  it("알 수 없는 값을 조용히 버리지 않고 돌려준다", () => {
    const { levels, unknown } = parsePermissionLevels("read, destrcutive, EDIT");
    expect(levels).toEqual(["read", "edit"]);
    expect(unknown).toEqual(["destrcutive"]);
  });
});

describe("permissionToLevel", () => {
  it("manifest 표기를 Level 로 바꾼다", () => {
    expect(permissionToLevel("photoshop.read")).toBe("read");
    expect(permissionToLevel("photoshop.destructive")).toBe("destructive");
  });

  it("접두사가 없거나 모르는 값은 null", () => {
    expect(permissionToLevel("read")).toBeNull();
    expect(permissionToLevel("photoshop.admin")).toBeNull();
    expect(permissionToLevel("other.read")).toBeNull();
  });
});

describe("CommandEngine 강제", () => {
  function engineWith(policy: PermissionPolicy): CommandEngine {
    const registry = new CommandRegistry();
    registry.register("READ_OP", async () => "읽음", { permission: "read" });
    registry.register("WIPE", async () => "지웠음", { permission: "destructive" });
    return new CommandEngine({ registry, bridge: new MockPhotoshopBridge(), policy });
  }

  it("허용된 레벨은 실행한다", async () => {
    const engine = engineWith(new PermissionPolicy());
    await expect(engine.execute({ type: "READ_OP", params: {} })).resolves.toBe("읽음");
  });

  it("허용되지 않은 레벨은 PERMISSION_DENIED", async () => {
    const engine = engineWith(new PermissionPolicy());
    await expect(engine.execute({ type: "WIPE", params: {} })).rejects.toThrow(denied);
  });

  it("명시적으로 켜면 실행된다", async () => {
    const engine = engineWith(new PermissionPolicy(["read", "destructive"]));
    await expect(engine.execute({ type: "WIPE", params: {} })).resolves.toBe("지웠음");
  });

  it("호출별 정책은 좁히기만 한다", async () => {
    const engine = engineWith(new PermissionPolicy(["read", "destructive"]));
    // 엔진은 허용하지만 호출별 정책이 막는다.
    await expect(
      engine.execute({ type: "WIPE", params: {} }, { policy: new PermissionPolicy(["read"]) }),
    ).rejects.toThrow(denied);
    // 반대로 엔진이 막으면 호출별 정책이 넓힐 수 없다.
    const narrow = engineWith(new PermissionPolicy(["read"]));
    await expect(
      narrow.execute(
        { type: "WIPE", params: {} },
        { policy: new PermissionPolicy(["read", "destructive"]) },
      ),
    ).rejects.toThrow(denied);
  });

  it("거부는 파라미터 검증보다 먼저 일어난다", async () => {
    // 거부될 호출에 스키마 오류까지 겹쳐도 PERMISSION_DENIED 가 나와야 한다.
    // 그래야 권한 없는 호출자가 스키마를 탐색하지 못한다.
    const registry = new CommandRegistry();
    registry.register("WIPE", async () => null, {
      permission: "destructive",
      schema: z.object({ id: z.number() }).strict(),
    });
    const engine = new CommandEngine({
      registry,
      bridge: new MockPhotoshopBridge(),
      policy: new PermissionPolicy(),
    });

    await expect(engine.execute({ type: "WIPE", params: { 엉뚱: true } })).rejects.toThrow(denied);
  });
});

describe("ToolRegistry 빠른 실패", () => {
  const makeTool = (permission: "read" | "destructive") => ({
    name: "photoshop.test",
    description: "테스트용",
    permission,
    inputSchema: z.object({}).strict(),
    handler: async () => ({ ok: true }),
  });

  it("허용되지 않은 Tool 은 호출 전에 막는다", async () => {
    const registry = new ToolRegistry(new PermissionPolicy());
    registry.register(makeTool("destructive"));
    await expect(registry.invoke("photoshop.test", {}, { requestId: "r" })).rejects.toThrow(denied);
  });

  it("Tool 이 레벨을 낮게 선언해도 Command Engine 이 막는다", async () => {
    // 이것이 Tool 검사를 '빠른 실패' 로만 두는 이유다.
    // Tool 의 선언은 메타데이터이고, 실제 차단은 Command 에서 일어난다.
    const commands = new CommandRegistry();
    commands.register("WIPE", async () => null, { permission: "destructive" });
    const policy = new PermissionPolicy();
    const engine = new CommandEngine({
      registry: commands,
      bridge: new MockPhotoshopBridge(),
      policy,
    });

    const tools = new ToolRegistry(policy);
    tools.register({
      name: "photoshop.거짓말",
      description: "read 라고 주장하지만 destructive Command 를 부른다",
      permission: "read",
      inputSchema: z.object({}).strict(),
      handler: async (_input, context) =>
        engine.execute({ type: "WIPE", params: {} }, { requestId: context.requestId }),
    });

    // Tool 검사는 통과한다. 그래도 Command 에서 막힌다.
    await expect(tools.invoke("photoshop.거짓말", {}, { requestId: "r" })).rejects.toThrow(denied);
  });
});

describe("Core Tool 분류", () => {
  it("조회 Tool 은 read, 편집 Tool 은 edit", () => {
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    const levelOf = (name: string): string | undefined => mcp.tools.get(name)?.permission;

    expect(levelOf("photoshop.ping")).toBe("read");
    expect(levelOf("photoshop.document.get")).toBe("read");
    expect(levelOf("photoshop.layer.list")).toBe("read");
    expect(levelOf("photoshop.layer.create")).toBe("edit");
    expect(levelOf("photoshop.adjustment.curves")).toBe("edit");
    expect(levelOf("photoshop.history.undo")).toBe("edit");
  });

  it("모든 Core Tool 과 Command 가 레벨을 선언한다", () => {
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });

    for (const tool of mcp.tools.list()) {
      expect(tool.permission, `${tool.name} 에 permission 이 없습니다`).toBeDefined();
    }
    for (const type of mcp.commands.list()) {
      expect(mcp.commands.permissionOf(type), `${type} 에 permission 이 없습니다`).toBeDefined();
    }
  });

  it("위험 등급 Command 목록을 고정한다", () => {
    // 여기에 무언가 늘어난다는 것은 Photoshop 밖에 쓰거나 되돌릴 수 없는 일을
    // 하는 통로가 생겼다는 뜻이다. 의도한 변경이어야 한다.
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    const byLevel = (level: string): string[] =>
      mcp.commands.list().filter((type) => mcp.commands.permissionOf(type) === level);

    expect(byLevel("external")).toEqual(["DOCUMENT_SAVE_AS", "DOCUMENT_EXPORT"]);
    expect(byLevel("destructive")).toEqual(["DOCUMENT_SAVE"]);
  });

  it("Photoshop 문서 편집 Command 는 전부 edit 이하다", () => {
    // 레이어·조정·마스크·선택·필터는 전부 비파괴라는 주장을 검증한다.
    const mcp = createPhotoshopMcp({ bridge: new MockPhotoshopBridge() });
    const editing = mcp.commands
      .list()
      .filter((type) => !type.startsWith("DOCUMENT_SAVE") && type !== "DOCUMENT_EXPORT");

    for (const type of editing) {
      expect(["read", "edit"], `${type} 이 위험 등급입니다`).toContain(
        mcp.commands.permissionOf(type),
      );
    }
  });

  it("읽기 전용 정책이면 편집 Tool 이 전부 막힌다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      policy: new PermissionPolicy(["read"]),
    });

    await expect(
      mcp.tools.invoke("photoshop.layer.list", {}, { requestId: "r" }),
    ).resolves.toBeDefined();
    await expect(
      mcp.tools.invoke("photoshop.layer.create", { name: "x" }, { requestId: "r" }),
    ).rejects.toThrow(denied);
  });
});

describe("Extension Permission", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "photoshop-mcp-perm-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function fixture(
    name: string,
    permissions: string[] | undefined,
    source: string,
  ): Promise<string> {
    const directory = join(root, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "extension.json"),
      JSON.stringify({
        id: `com.test.${name}`,
        name,
        version: "1.0.0",
        namespace: name,
        main: "main.mjs",
        ...(permissions === undefined ? {} : { permissions }),
      }),
      "utf8",
    );
    await writeFile(join(directory, "main.mjs"), source, "utf8");
    return directory;
  }

  const SCHEMA_STUB = "{ parse: (v) => v, safeParse: (v) => ({ success: true, data: v }) }";

  const toolSource = (name: string, permission: string): string =>
    [
      "export function activate(context) {",
      "  context.tools.register({",
      `    name: ${JSON.stringify(name)},`,
      '    description: "테스트용",',
      `    permission: ${JSON.stringify(permission)},`,
      `    inputSchema: ${SCHEMA_STUB},`,
      "    handler: async () => ({ ok: true }),",
      "  });",
      "}",
    ].join("\n");

  function setup(): ReturnType<typeof createPhotoshopMcp> {
    return createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      // Extension 상한을 보려면 서버 자체는 넉넉해야 한다.
      policy: new PermissionPolicy(["read", "edit", "external", "destructive"]),
    });
  }

  it("manifest 에 선언한 권한의 Tool 은 등록된다", async () => {
    const mcp = setup();
    const directory = await fixture("ok", ["photoshop.edit"], toolSource("ok.tool", "edit"));
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });
    expect(mcp.tools.has("ok.tool")).toBe(true);
  });

  it("선언하지 않은 권한의 Tool 은 등록 자체를 막는다", async () => {
    // 호출 시점에 막으면 Tool 목록에는 떠 있는데 항상 실패하는 상태가 된다.
    const mcp = setup();
    const directory = await fixture(
      "greedy",
      ["photoshop.read"],
      toolSource("greedy.wipe", "destructive"),
    );

    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));
    expect(mcp.tools.has("greedy.wipe")).toBe(false);
  });

  it("permissions 를 선언하지 않으면 아무 Tool 도 등록할 수 없다", async () => {
    // 최소 권한 원칙. 기본값을 주면 권한을 적지 않은 Extension 이 조용히 편집 권한을 얻는다.
    const mcp = setup();
    const directory = await fixture("silent", undefined, toolSource("silent.tool", "read"));

    await expect(
      mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.EXTENSION_LOAD_FAILED }));
  });

  it("Command 호출도 manifest 선언으로 가둔다", async () => {
    // Tool 을 거치지 않는 경로가 진짜 우회로다. (ARCHITECTURE §3.2)
    const mcp = setup();
    const directory = await fixture(
      "reader",
      ["photoshop.read"],
      [
        "export function activate(context) {",
        "  context.tools.register({",
        '    name: "reader.probe",',
        '    description: "선언 밖의 Command 를 호출한다",',
        '    permission: "read",',
        `    inputSchema: ${SCHEMA_STUB},`,
        "    handler: async (_input, toolContext) =>",
        '      context.commands.execute({ type: "LAYER_CREATE", params: { name: "몰래" } },',
        "        { requestId: toolContext.requestId }),",
        "  });",
        "}",
      ].join("\n"),
    );
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });

    // 서버 정책은 edit 을 허용한다. 그런데도 Extension 선언이 read 뿐이라 막힌다.
    expect(mcp.policy.isAllowed("edit")).toBe(true);
    await expect(mcp.tools.invoke("reader.probe", {}, { requestId: "r" })).rejects.toThrow(denied);
  });

  it("선언한 범위 안의 Command 는 호출된다", async () => {
    const mcp = setup();
    const directory = await fixture(
      "editor",
      ["photoshop.read", "photoshop.edit"],
      [
        "export function activate(context) {",
        "  context.tools.register({",
        '    name: "editor.make",',
        '    description: "레이어를 만든다",',
        '    permission: "edit",',
        `    inputSchema: ${SCHEMA_STUB},`,
        "    handler: async (_input, toolContext) =>",
        '      context.commands.execute({ type: "LAYER_CREATE", params: { name: "떳떳" } },',
        "        { requestId: toolContext.requestId }),",
        "  });",
        "}",
      ].join("\n"),
    );
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });

    await expect(mcp.tools.invoke("editor.make", {}, { requestId: "r" })).resolves.toMatchObject({
      name: "떳떳",
    });
  });

  it("서버 정책이 좁으면 Extension 선언이 넓어도 막힌다", async () => {
    const mcp = createPhotoshopMcp({
      bridge: new MockPhotoshopBridge(),
      logger: createSilentLogger(),
      policy: new PermissionPolicy(["read"]),
    });
    const directory = await fixture(
      "bold",
      ["photoshop.read", "photoshop.edit"],
      toolSource("bold.tool", "edit"),
    );

    // Tool 등록 자체는 manifest 기준으로 통과한다.
    await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });
    // 호출은 서버 정책에서 막힌다.
    await expect(mcp.tools.invoke("bold.tool", {}, { requestId: "r" })).rejects.toThrow(denied);
  });
});

describe("readOptionsFromEnv", () => {
  it("기본 허용은 read, edit", () => {
    expect(readOptionsFromEnv({}).policy.allowed).toEqual(["read", "edit"]);
  });

  it("PHOTOSHOP_MCP_ALLOW 가 전체 목록을 결정한다", () => {
    expect(readOptionsFromEnv({ PHOTOSHOP_MCP_ALLOW: "read" }).policy.allowed).toEqual(["read"]);
    expect(readOptionsFromEnv({ PHOTOSHOP_MCP_ALLOW: "all" }).policy.allowed).toEqual([
      "read",
      "edit",
      "external",
      "destructive",
    ]);
  });
});
