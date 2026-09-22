import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor, runInit } from "photoshop-mcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `photoshop-mcp doctor` · `init`. (ROADMAP §18)
 *
 * 설치 중에 막히면 MCP 클라이언트가 아직 없어 `photoshop.diagnostics` 를 부를
 * 수 없다. 그 자리를 메우는 것들이다.
 */

let workspace: string;

/** 이 셸의 환경 변수가 새어 들어오지 않게 필요한 것만 준다. */
function env(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    PHOTOSHOP_MCP_CAPABILITIES: join(workspace, "capabilities.json"),
    PHOTOSHOP_MCP_EXTENSIONS: join(workspace, "extensions"),
    PHOTOSHOP_MCP_WORKFLOWS: join(workspace, "workflows.json"),
    // 기본 8765 를 쓰면 진짜 서버가 떠 있을 때 결과가 달라진다.
    PHOTOSHOP_MCP_PORT: "51733",
    ...overrides,
  };
}

/**
 * 검색 뿌리도 작업 폴더 안으로 가둔다.
 *
 * 진짜 `C:/Program Files` 를 보면 **이 기계에 무엇이 깔려 있느냐에 따라
 * 결과가 달라진다.** 처음에 홈만 가짜로 주었다가 StarNet2·BXT 가 함께
 * 잡혀서 알았다.
 */
const roots = () => ({ home: join(workspace, "홈"), programFiles: join(workspace, "프로그램") });

const find = (checks: { name: string; level: string; detail: string }[], name: string) =>
  checks.find((check) => check.name === name);

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "doctor-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("doctor", () => {
  it("**설정이 없어도 fail 하지 않는다**", async () => {
    // 외부 처리기가 없는 것은 정상이다. 없는 것을 실패로 부르면
    // 진짜 실패가 묻힌다.
    const report = await runDoctor(env());
    expect(report.healthy).toBe(true);
    expect(find(report.checks, "외부 처리기")?.level).toBe("warn");
  });

  it("**실행 파일이 없으면 fail 이다**", async () => {
    // 선언만 보면 경로가 틀린 설정을 통과시킨다. 그러면 쓸 때가 되어서야
    // 드러난다 — 그게 init 과 doctor 를 만든 이유다.
    await writeFile(
      join(workspace, "capabilities.json"),
      JSON.stringify({
        providers: [{ id: "ghost", capability: "x", executable: join(workspace, "없는것.exe") }],
      }),
      "utf8",
    );
    const report = await runDoctor(env());
    expect(report.healthy).toBe(false);
    const check = find(report.checks, "외부 처리기");
    expect(check?.level).toBe("fail");
    expect(check?.detail).toMatch(/찾을 수 없습니다/u);
  });

  it("깨진 설정 파일은 fail 이다", async () => {
    await writeFile(join(workspace, "capabilities.json"), "{ 깨진", "utf8");
    const report = await runDoctor(env());
    expect(report.healthy).toBe(false);
    expect(find(report.checks, "외부 처리기")?.level).toBe("fail");
  });

  it("**권한은 참고용이라고 말한다**", async () => {
    /* 터미널에서 돌린 doctor 는 MCP 클라이언트가 넘길 env 를 모른다.
     * 이 구분을 흐리면 "doctor 가 통과했으니 됐다" 고 믿게 된다. */
    const report = await runDoctor(env());
    expect(find(report.checks, "권한")?.detail).toMatch(/참고용/u);
  });

  it("**권한 항목이 두 번 나오지 않는다**", async () => {
    // 처음에 코드 접두사로 걸러 `no_providers` 까지 잡혔고,
    // "외부 처리기 미설정" 이 두 줄로 나왔다.
    const report = await runDoctor(env());
    const providerLines = report.checks.filter((check) =>
      check.detail.includes("외부 처리기가 설정되지 않았습니다"),
    );
    expect(providerLines).toHaveLength(0);
  });

  it("**external 이 없으면 설정 조각을 준다**", async () => {
    const report = await runDoctor(env());
    expect(report.snippet).not.toBeNull();
    const parsed = JSON.parse(report.snippet ?? "{}") as {
      mcpServers: { photoshop: { args: string[]; env: Record<string, string> } };
    };
    expect(parsed.mcpServers.photoshop.env["PHOTOSHOP_MCP_ALLOW"]).toBe("read,edit,external");
    // 경로는 문서에 적어 두지 않고 실제 설치 위치에서 만든다.
    expect(parsed.mcpServers.photoshop.args[0]).toMatch(/photoshop-mcp\.js$/u);
    // JSON 에 역슬래시가 들어가면 손으로 고칠 때 틀린다.
    expect(parsed.mcpServers.photoshop.args[0]).not.toMatch(/\\/u);
  });

  it("**destructive 는 권하지 않는다**", async () => {
    // 덮어쓰기 · 평탄화 · 액션 실행이 거기 있다. 기본으로 열 것이 아니다.
    const report = await runDoctor(env());
    expect(report.snippet).not.toMatch(/destructive/u);
  });

  it("**권한이 이미 맞으면 조각을 내지 않는다**", async () => {
    // 늘 나오는 것은 읽히지 않는다. 기동 로그를 줄인 것과 같은 이유다.
    const report = await runDoctor(env({ PHOTOSHOP_MCP_ALLOW: "read,edit,external" }));
    expect(report.snippet).toBeNull();
  });

  it("포트가 비어 있으면 ok 다", async () => {
    const report = await runDoctor(env());
    expect(find(report.checks, "Bridge 포트")?.level).toBe("ok");
  });

  it("**Extension 을 실제로 적재해 본다**", async () => {
    // 선언만 보면 import 실패를 놓친다.
    const directory = join(workspace, "extensions", "broken");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "extension.json"),
      JSON.stringify({
        id: "x",
        name: "깨진 것",
        version: "0.0.0",
        namespace: "broken",
        main: join(directory, "없는파일.js"),
        permissions: [],
      }),
      "utf8",
    );
    const report = await runDoctor(env());
    // 하나가 실패해도 서버는 뜬다. doctor 도 그것을 따라 fail 로 부르지 않는다 —
    // 다만 적재된 목록에 없는 것으로 드러난다.
    expect(find(report.checks, "Extension")?.detail).not.toMatch(/broken/u);
  });
});

describe("init", () => {
  it("**이미 있으면 덮어쓰지 않는다**", async () => {
    // 사용자가 손으로 고친 경로가 들어 있을 수 있다.
    const path = join(workspace, "capabilities.json");
    await writeFile(path, '{"providers":[]}', "utf8");
    const result = await runInit(env());
    expect(result.written).toBe(false);
    expect(result.reason).toMatch(/덮어쓰지 않습니다/u);
    expect(readFileSync(path, "utf8")).toBe('{"providers":[]}');
  });

  it("**하나도 못 찾으면 만들지 않는다**", async () => {
    // 없는 처리기를 example 에서 가져다 넣으면 capability.list 에 이름만
    // 올라가고 쓸 때 실패한다.
    const result = await runInit(env(), roots());
    expect(result.written).toBe(false);
    expect(result.found).toHaveLength(0);
    expect(existsSync(join(workspace, "capabilities.json"))).toBe(false);
  });

  it("**찾은 것만 쓴다**", async () => {
    // GraXpert 만 있는 가짜 홈을 만든다.
    const found = roots();
    const dir = join(found.home, "AppData/Local/Programs/GraXpert");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "GraXpert.exe"), "", "utf8");

    const result = await runInit(env(), found);
    expect(result.written).toBe(true);
    expect(result.found.map((item) => item.id)).toEqual(["graxpert"]);

    const written = JSON.parse(readFileSync(result.path, "utf8")) as {
      providers: { id: string; executable: string }[];
    };
    expect(written.providers).toHaveLength(1);
    // 경로 구분자를 통일한다 — JSON 에 역슬래시가 들어가면 손으로 고칠 때 틀린다.
    expect(written.providers[0]?.executable).not.toMatch(/\\/u);
  });

  it("**만든 설정이 doctor 를 통과한다**", async () => {
    // init 과 doctor 가 서로를 검증한다. 한쪽이 틀리면 여기서 드러난다.
    const found = roots();
    const dir = join(found.home, "AppData/Local/Programs/GraXpert");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "GraXpert.exe"), "", "utf8");

    await runInit(env(), found);
    const report = await runDoctor(env());
    expect(find(report.checks, "외부 처리기")?.level).toBe("ok");
    expect(report.healthy).toBe(true);
  });
});
