import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CapabilityRegistry,
  createSilentLogger,
  type ProcessOutcome,
} from "@photoshop-mcp/mcp-core";
import {
  ErrorCode,
  assertConfigConsistent,
  buildArgs,
  placeholdersIn,
  type ProviderConfig,
} from "@photoshop-mcp/photoshop-bridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Phase 8 — Capability System. (ROADMAP §12, ARCHITECTURE §19)
 *
 * 가장 중요한 성질은 **임의 실행이 불가능하다**는 것이다. (ARCHITECTURE §23.2 와 같은 원칙)
 *
 * - 실행 파일은 설정에서만 온다
 * - argv 는 선언된 파라미터로만 조립된다
 * - 입출력은 승인된 작업 폴더 안의 파일 이름뿐이다
 * - shell 을 거치지 않는다
 */

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "photoshop-mcp-cap-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

const base: ProviderConfig = {
  id: "fake",
  capability: "gradientRemoval",
  executable: process.execPath,
  args: ["{{input}}", "{{output}}"],
};

function setup(
  providers: ProviderConfig[] = [],
  runner?: (
    executable: string,
    args: readonly string[],
    options: { timeoutMs: number },
  ) => Promise<ProcessOutcome>,
  folder: string | null = null,
): CapabilityRegistry {
  const registry = new CapabilityRegistry({
    logger: createSilentLogger(),
    resolveWorkspace: async () => folder,
    ...(runner === undefined ? {} : { runner }),
  });
  for (const provider of providers) {
    registry.register(provider);
  }
  return registry;
}

describe("인자 조립", () => {
  it("자리표시자를 찾는다", () => {
    expect(placeholdersIn(["-o", "{{output}}", "{{ input }}", "고정"])).toEqual([
      "output",
      "input",
    ]);
  });

  it("선언된 값으로 치환한다", () => {
    const config: ProviderConfig = {
      ...base,
      args: ["-c", "{{mode}}", "-o", "{{output}}", "{{input}}"],
      params: { mode: { type: "enum", values: ["a", "b"], default: "a" } },
    };
    expect(
      buildArgs({ config, inputPath: "/w/in.tif", outputPaths: { output: "/w/out.tif" } }),
    ).toEqual(["-c", "a", "-o", "/w/out.tif", "/w/in.tif"]);
  });

  it("허용 목록 밖의 enum 값을 거부한다", () => {
    // 자유 문자열이 argv 에 닿으면 "임의 실행 금지" 가 무너진다.
    const config: ProviderConfig = {
      ...base,
      args: ["{{mode}}"],
      params: { mode: { type: "enum", values: ["a", "b"] } },
    };
    expect(() =>
      buildArgs({
        config,
        inputPath: "/w/i",
        outputPaths: { output: "/w/o" },
        params: { mode: "--악성" },
      }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("숫자 범위와 정수 조건을 강제한다", () => {
    const config: ProviderConfig = {
      ...base,
      args: ["{{n}}"],
      params: { n: { type: "number", min: 1, max: 10, integer: true } },
    };
    const call = (n: unknown): string[] =>
      buildArgs({
        config,
        inputPath: "/w/i",
        outputPaths: { output: "/w/o" },
        params: { n: n as number },
      });

    expect(call(5)).toEqual(["5"]);
    for (const bad of [0, 11, 1.5, "3", true]) {
      expect(() => call(bad)).toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    }
  });

  it("선언되지 않은 파라미터를 조용히 무시하지 않는다", () => {
    const config: ProviderConfig = { ...base, args: ["{{input}}"] };
    expect(() =>
      buildArgs({
        config,
        inputPath: "/w/i",
        outputPaths: { output: "/w/o" },
        params: { 오타: "값" },
      }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("기본값 없는 파라미터를 생략하면 실패한다", () => {
    const config: ProviderConfig = {
      ...base,
      args: ["{{mode}}"],
      params: { mode: { type: "enum", values: ["a"] } },
    };
    expect(() => buildArgs({ config, inputPath: "/w/i", outputPaths: { output: "/w/o" } })).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("값에 든 shell 문자는 한 인자의 내용일 뿐이다", () => {
    // shell 을 거치지 않으므로 && 나 따옴표가 명령을 나누지 못한다.
    const config: ProviderConfig = {
      ...base,
      args: ["{{mode}}"],
      params: { mode: { type: "enum", values: ['a" && del /f /q C:\\ && echo "'] } },
    };
    const args = buildArgs({
      config,
      inputPath: "/w/i",
      outputPaths: { output: "/w/o" },
      params: { mode: 'a" && del /f /q C:\\ && echo "' },
    });
    expect(args).toHaveLength(1);
    expect(args[0]).toBe('a" && del /f /q C:\\ && echo "');
  });
});

describe("다중 출력", () => {
  /**
   * StarNet2 는 별을 지운 이미지와 별만 남긴 이미지를 함께 만든다.
   *
   *     --input <in> --output <starless> --unscreen <stars>
   *
   * `restore_stars` 워크플로에 별 이미지가 필요하므로 출력 하나로는 부족하다.
   */
  const starnet: ProviderConfig = {
    id: "starnet2",
    capability: "starRemoval",
    executable: process.execPath,
    args: ["--input", "{{input}}", "--output", "{{output}}", "--unscreen", "{{output.stars}}"],
    outputs: { stars: { description: "별만 남긴 이미지" } },
  };

  it("추가 출력 자리표시자를 치환한다", () => {
    expect(
      buildArgs({
        config: starnet,
        inputPath: "/w/in.tif",
        outputPaths: { output: "/w/starless.tif", stars: "/w/stars.tif" },
      }),
    ).toEqual([
      "--input",
      "/w/in.tif",
      "--output",
      "/w/starless.tif",
      "--unscreen",
      "/w/stars.tif",
    ]);
  });

  it("추가 출력 이름을 빠뜨리면 실행 전에 막는다", () => {
    // 빠진 채로 실행하면 빈 문자열이 인자로 들어가 처리기가 엉뚱하게 동작한다.
    expect(() =>
      buildArgs({ config: starnet, inputPath: "/w/i", outputPaths: { output: "/w/o" } }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("선언했는데 args 에서 쓰지 않으면 설정 오류다", () => {
    // 선언만 하고 인자에 넣지 않으면 그 파일은 만들어지지 않는다.
    expect(() =>
      assertConfigConsistent({
        ...starnet,
        args: ["--input", "{{input}}", "--output", "{{output}}"],
      }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("Provider 가 만들지 않는 출력을 요청하면 거부한다", async () => {
    const registry = setup(
      [{ ...starnet, args: ["{{input}}", "{{output}}"], outputs: {} }],
      undefined,
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");

    await expect(
      registry.execute("starRemoval", {
        input: "in.tif",
        output: "out.tif",
        outputs: { 오타: "x.tif" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("추가 출력도 승인된 폴더를 벗어날 수 없다", async () => {
    const registry = setup([starnet], undefined, workspace);
    await writeFile(join(workspace, "in.tif"), "x", "utf8");

    await expect(
      registry.execute("starRemoval", {
        input: "in.tif",
        output: "out.tif",
        outputs: { stars: "../탈출.tif" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("추가 출력이 만들어지지 않으면 실패로 본다", async () => {
    // 주 출력만 만들고 끝나는 경우가 있다. 다음 단계가 없는 파일을 읽게 두지 않는다.
    const registry = setup(
      [starnet],
      async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");
    await writeFile(join(workspace, "starless.tif"), "x", "utf8");
    // stars.tif 는 만들지 않는다

    await expect(
      registry.execute("starRemoval", {
        input: "in.tif",
        output: "starless.tif",
        outputs: { stars: "stars.tif" },
      }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_FAILED }));
  });

  it("실제 프로세스로 두 파일을 만든다", async () => {
    // StarNet2 와 같은 인자 모양으로 실행 경로 전체를 확인한다.
    const script = join(workspace, "starnet흉내.cjs");
    await writeFile(
      script,
      [
        "const fs = require('node:fs');",
        "const a = process.argv.slice(2);",
        "const get = (flag) => a[a.indexOf(flag) + 1];",
        "const src = fs.readFileSync(get('--input'), 'utf8');",
        "fs.writeFileSync(get('--output'), 'starless:' + src);",
        "fs.writeFileSync(get('--unscreen'), 'stars:' + src);",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(workspace, "in.tif"), "원본", "utf8");

    const registry = setup(
      [
        {
          ...starnet,
          args: [
            script,
            "--input",
            "{{input}}",
            "--output",
            "{{output}}",
            "--unscreen",
            "{{output.stars}}",
          ],
        },
      ],
      undefined,
      workspace,
    );

    const result = await registry.execute("starRemoval", {
      input: "in.tif",
      output: "starless.tif",
      outputs: { stars: "stars.tif" },
    });

    expect(result.outputPaths).toEqual({
      output: join(workspace, "starless.tif"),
      stars: join(workspace, "stars.tif"),
    });
    await expect(readFile(join(workspace, "starless.tif"), "utf8")).resolves.toBe("starless:원본");
    await expect(readFile(join(workspace, "stars.tif"), "utf8")).resolves.toBe("stars:원본");
  });

  it("describe 가 추가 출력을 알려준다", () => {
    const registry = setup([starnet]);
    expect(registry.describe()[0]?.extraOutputs).toEqual(["stars"]);
  });
});

describe("설정 검증", () => {
  it("선언되지 않은 자리표시자를 등록 시점에 잡는다", () => {
    // 실행 시점에 빈 문자열로 바꾸면 프로그램이 엉뚱한 인자로 돈다.
    expect(() => assertConfigConsistent({ ...base, args: ["{{없는것}}"] })).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
  });

  it("ASCII 가 아닌 자리표시자도 잡는다", () => {
    // 이름을 ASCII 로 좁히면 `{{오타}}` 가 검사를 빠져나가 그대로 인자가 된다.
    for (const bad of ["{{오타}}", "{{ 공백 이름 }}", "{{}}"]) {
      expect(() => assertConfigConsistent({ ...base, args: [bad] }), bad).toThrow(
        expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
      );
    }
  });

  it("input 과 output 은 선언하지 않아도 된다", () => {
    expect(() =>
      assertConfigConsistent({ ...base, args: ["{{input}}", "{{output}}"] }),
    ).not.toThrow();
  });

  it("기본값도 선언을 만족해야 한다", () => {
    expect(() =>
      assertConfigConsistent({
        ...base,
        args: ["{{mode}}"],
        params: { mode: { type: "enum", values: ["a"], default: "z" } },
      }),
    ).toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
  });

  it("register 가 잘못된 설정을 막는다", () => {
    const registry = setup();
    expect(() => registry.register({ ...base, args: ["{{오타}}"] })).toThrow(
      expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }),
    );
    expect(registry.size).toBe(0);
  });

  it("같은 id 를 두 번 등록할 수 없다", () => {
    const registry = setup([base]);
    expect(() => registry.register(base)).toThrow(
      expect.objectContaining({ code: ErrorCode.DUPLICATE_COMMAND }),
    );
  });
});

describe("Provider 선택", () => {
  const a: ProviderConfig = { ...base, id: "low", capability: "starRemoval", priority: 1 };
  const b: ProviderConfig = { ...base, id: "high", capability: "starRemoval", priority: 5 };

  it("우선순위가 높은 것을 고른다", async () => {
    const seen: string[] = [];
    const registry = setup(
      [a, b],
      async (executable) => {
        seen.push(executable);
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");
    await writeFile(join(workspace, "out.tif"), "x", "utf8");

    const result = await registry.execute("starRemoval", { input: "in.tif", output: "out.tif" });
    expect(result.provider).toBe("high");
    expect(seen).toHaveLength(1);
  });

  it("Provider 를 지정할 수 있다", async () => {
    const registry = setup(
      [a, b],
      async () => ({
        code: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
      }),
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");
    await writeFile(join(workspace, "out.tif"), "x", "utf8");

    const result = await registry.execute("starRemoval", {
      input: "in.tif",
      output: "out.tif",
      provider: "low",
    });
    expect(result.provider).toBe("low");
  });

  it("없는 Capability 는 COMMAND_NOT_SUPPORTED", async () => {
    const registry = setup([a], undefined, workspace);
    await expect(registry.execute("없는기능", { input: "i", output: "o" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }),
    );
  });

  it("그 Capability 를 제공하지 않는 Provider 를 지정하면 거부한다", async () => {
    const registry = setup([a, { ...base, id: "other" }], undefined, workspace);
    await expect(
      registry.execute("starRemoval", { input: "i", output: "o", provider: "other" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }));
  });

  it("list 와 has 가 등록 내용을 반영한다", () => {
    const registry = setup([a, { ...base, id: "g" }]);
    expect(registry.list()).toEqual(["gradientRemoval", "starRemoval"]);
    expect(registry.has("starRemoval")).toBe(true);
    expect(registry.has("없음")).toBe(false);
  });
});

describe("입출력은 승인된 폴더를 벗어날 수 없다", () => {
  it("승인 전에는 WORKSPACE_NOT_APPROVED", async () => {
    const registry = setup([base], undefined, null);
    await expect(registry.execute("gradientRemoval", { input: "i", output: "o" })).rejects.toThrow(
      expect.objectContaining({ code: ErrorCode.WORKSPACE_NOT_APPROVED, recoverable: true }),
    );
  });

  it("경로를 넣으면 거부한다", async () => {
    // 경로를 받으면 external 권한이 임의 파일 읽기·쓰기로 넓어진다.
    const registry = setup([base], undefined, workspace);
    for (const bad of ["../탈출.tif", "C:/Windows/system32/x", "하위/파일", ".."]) {
      await expect(
        registry.execute("gradientRemoval", { input: bad, output: "o.tif" }),
        `${bad} 가 통과했습니다`,
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
      await expect(
        registry.execute("gradientRemoval", { input: "i.tif", output: bad }),
      ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.INVALID_PARAMETER }));
    }
  });

  it("입력 파일이 없으면 실행하지 않는다", async () => {
    let ran = false;
    const registry = setup(
      [base],
      async () => {
        ran = true;
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
      workspace,
    );
    await expect(
      registry.execute("gradientRemoval", { input: "없음.tif", output: "o.tif" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_FAILED }));
    expect(ran).toBe(false);
  });
});

describe("실행 결과 해석", () => {
  const ok = async (): Promise<ProcessOutcome> => ({
    code: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
  });

  it("종료 코드가 0 이 아니면 COMMAND_FAILED 와 stderr 를 준다", async () => {
    const registry = setup(
      [base],
      async () => ({ code: 3, stdout: "", stderr: "모델을 찾을 수 없음", timedOut: false }),
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");

    await expect(
      registry.execute("gradientRemoval", { input: "in.tif", output: "out.tif" }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.COMMAND_FAILED,
        details: expect.objectContaining({ exitCode: 3, stderr: "모델을 찾을 수 없음" }),
      }),
    );
  });

  it("제한 시간을 넘기면 COMMAND_TIMEOUT", async () => {
    const registry = setup(
      [base],
      async () => ({ code: null, stdout: "", stderr: "", timedOut: true }),
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x", "utf8");

    await expect(
      registry.execute("gradientRemoval", { input: "in.tif", output: "out.tif" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_TIMEOUT }));
  });

  it("성공했다고 해도 출력 파일이 없으면 실패로 본다", async () => {
    // 다음 단계가 없는 파일을 읽게 두지 않는다.
    const registry = setup([base], ok, workspace);
    await writeFile(join(workspace, "in.tif"), "x", "utf8");

    await expect(
      registry.execute("gradientRemoval", { input: "in.tif", output: "out.tif" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_FAILED }));
  });
});

describe("실제 프로세스 실행", () => {
  /**
   * 가짜 러너만 쓰면 `spawn` 호출이 맞는지 알 수 없다.
   * Node 자신을 외부 처리기로 삼아 실행 경로 전체를 확인한다.
   */
  it("입력을 읽어 출력을 만드는 프로그램을 돌린다", async () => {
    const script = join(workspace, "처리기.cjs");
    await writeFile(
      script,
      [
        "const fs = require('node:fs');",
        "const [input, output, mode] = process.argv.slice(2);",
        "fs.writeFileSync(output, mode + ':' + fs.readFileSync(input, 'utf8'));",
      ].join("\n"),
      "utf8",
    );
    await writeFile(join(workspace, "in.txt"), "원본", "utf8");

    const registry = setup(
      [
        {
          id: "node-fake",
          capability: "gradientRemoval",
          executable: process.execPath,
          args: [script, "{{input}}", "{{output}}", "{{mode}}"],
          params: { mode: { type: "enum", values: ["빼기", "나누기"], default: "빼기" } },
        },
      ],
      undefined,
      workspace,
    );

    const result = await registry.execute("gradientRemoval", {
      input: "in.txt",
      output: "out.txt",
      params: { mode: "나누기" },
    });

    expect(result.provider).toBe("node-fake");
    expect(result.outputPath).toBe(join(workspace, "out.txt"));
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    await expect(readFile(join(workspace, "out.txt"), "utf8")).resolves.toBe("나누기:원본");
  });

  it("실패하는 프로그램의 종료 코드와 stderr 를 전달한다", async () => {
    const script = join(workspace, "실패.cjs");
    await writeFile(
      script,
      ["console.error('처리 실패: 모델 없음');", "process.exit(2);"].join("\n"),
      "utf8",
    );
    await writeFile(join(workspace, "in.txt"), "x", "utf8");

    const registry = setup(
      [{ ...base, id: "failing", args: [script, "{{input}}", "{{output}}"] }],
      undefined,
      workspace,
    );

    await expect(
      registry.execute("gradientRemoval", { input: "in.txt", output: "out.txt" }),
    ).rejects.toThrow(
      expect.objectContaining({
        code: ErrorCode.COMMAND_FAILED,
        details: expect.objectContaining({ exitCode: 2 }),
      }),
    );
  });
});

describe("사용 가능 여부", () => {
  it("없는 실행 파일은 이유를 알려준다", async () => {
    const registry = setup([{ ...base, executable: join(workspace, "없는프로그램.exe") }]);
    const [entry] = await registry.describeAsync();
    expect(entry?.available).toBe(false);
    expect(entry?.reason).toBe("실행 파일을 찾을 수 없습니다.");
  });

  it("상대 경로를 거부한다", async () => {
    // 상대 경로는 서버의 작업 디렉터리에 따라 달라진다.
    const registry = setup([{ ...base, executable: "graxpert.exe" }]);
    const [entry] = await registry.describeAsync();
    expect(entry?.available).toBe(false);
    expect(entry?.reason).toBe("실행 파일은 절대 경로여야 합니다.");
  });

  it("실제로 있는 실행 파일은 사용 가능하다", async () => {
    const registry = setup([base]);
    const [entry] = await registry.describeAsync();
    expect(entry?.available).toBe(true);
    expect(entry?.reason).toBeNull();
  });

  it("쓸 수 없는 Provider 는 실행 시점에 COMMAND_NOT_SUPPORTED", async () => {
    const registry = setup(
      [{ ...base, executable: join(workspace, "없음.exe") }],
      undefined,
      workspace,
    );
    await expect(
      registry.execute("gradientRemoval", { input: "i.tif", output: "o.tif" }),
    ).rejects.toThrow(expect.objectContaining({ code: ErrorCode.COMMAND_NOT_SUPPORTED }));
  });
});

describe("설정 파일", () => {
  it("파일이 없으면 조용히 넘어간다", async () => {
    const registry = setup();
    await expect(registry.loadConfig(join(workspace, "없음.json"))).resolves.toBe(0);
  });

  it("예제 설정이 스키마를 만족한다", async () => {
    // 복사해서 바로 쓸 수 있어야 한다.
    const registry = setup();
    const example = new URL("../capabilities.example.json", import.meta.url);
    const loaded = await registry.loadConfig(example.pathname.replace(/^\/([A-Za-z]:)/u, "$1"));
    expect(loaded).toBe(3);
    expect(registry.list()).toEqual(["deconvolution", "gradientRemoval", "starRemoval"]);
  });

  it("하나가 잘못되어도 나머지는 등록한다", async () => {
    const path = join(workspace, "capabilities.json");
    await writeFile(
      path,
      JSON.stringify({
        providers: [
          { ...base, id: "good" },
          { ...base, id: "bad", args: ["{{선언안됨}}"] },
        ],
      }),
      "utf8",
    );

    const registry = setup();
    await expect(registry.loadConfig(path)).resolves.toBe(1);
    expect(registry.size).toBe(1);
  });

  it("JSON 이 깨져도 서버가 죽지 않는다", async () => {
    const path = join(workspace, "capabilities.json");
    await writeFile(path, "{ not json", "utf8");
    const registry = setup();
    await expect(registry.loadConfig(path)).resolves.toBe(0);
  });
});

describe("출력 형식 보정", () => {
  /**
   * 처리기가 요청한 이름·형식으로 만들어 주지 않는 경우.
   *
   * GraXpert 3.0.2 는 `-output out.tif` 를 줘도 `out.tif.fits` 를 만든다. 출력 형식
   * 옵션이 없어 호출 쪽에서 우회할 수 없고, Photoshop 은 FITS 를 못 읽는다.
   * 그 버릇을 Provider 선언에 가둬서 Command·Workflow 가 몰라도 되게 한다.
   */

  /** 최소 FITS 를 만든다. 자세한 형식 검증은 fits.test.ts 가 한다. */
  function fitsBytes(value: number): Buffer {
    const cards = [
      "SIMPLE  =                    T",
      "BITPIX  =                  -32",
      "NAXIS   =                    2",
      "NAXIS1  =                    2",
      "NAXIS2  =                    1",
      "END",
    ]
      .map((text) => text.padEnd(80, " "))
      .join("");
    const header = Buffer.alloc(2880, " ");
    header.write(cards, 0, "ascii");
    const data = Buffer.alloc(2880);
    data.writeFloatBE(value, 0);
    data.writeFloatBE(value, 4);
    return Buffer.concat([header, data]);
  }

  it("접미사가 붙은 FITS 를 찾아 TIFF 로 바꾼다", async () => {
    const registry = setup(
      [
        {
          ...base,
          id: "graxpert-fake",
          args: ["{{input}}", "{{output}}"],
          outputSuffix: ".fits",
          convert: "fitsToTiff",
        },
      ],
      async (_exe, args) => {
        // 처리기는 요청한 이름이 아니라 `.fits` 를 붙인 이름으로 만든다.
        await writeFile(`${args[1] as string}.fits`, fitsBytes(0.5));
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
      workspace,
    );

    await writeFile(join(workspace, "in.tif"), "x");
    const result = await registry.execute("gradientRemoval", {
      input: "in.tif",
      output: "out.tif",
    });

    // 요청한 이름으로 TIFF 가 있어야 한다. II 매직이면 우리가 쓴 TIFF 다.
    const produced = await readFile(join(workspace, "out.tif"));
    expect(produced.subarray(0, 4)).toEqual(Buffer.from([0x49, 0x49, 42, 0]));
    expect(result.converted?.["output"]).toContain("2x1");

    // 중간 FITS 는 남기지 않는다. 남기면 작업 폴더가 쓰지 못할 파일로 찬다.
    await expect(readFile(join(workspace, "out.tif.fits"))).rejects.toThrow();
  });

  it("접미사 파일이 없으면 실패한다", async () => {
    // 종료 코드가 0 이어도 만들어진 것이 없으면 성공이 아니다.
    const registry = setup(
      [{ ...base, id: "suffix-only", outputSuffix: ".fits", convert: "fitsToTiff" }],
      async () => ({ code: 0, stdout: "", stderr: "", timedOut: false }),
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x");

    await expect(
      registry.execute("gradientRemoval", { input: "in.tif", output: "out.tif" }),
    ).rejects.toThrow(/out\.tif\.fits/u);
  });

  it("변환 없이 접미사만 있으면 이름만 바꾼다", async () => {
    const registry = setup(
      [{ ...base, id: "rename-only", outputSuffix: ".tmp" }],
      async (_exe, args) => {
        await writeFile(`${args[1] as string}.tmp`, "결과");
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x");

    const result = await registry.execute("gradientRemoval", {
      input: "in.tif",
      output: "out.tif",
    });
    expect(result.converted).toBeUndefined();
    expect(await readFile(join(workspace, "out.tif"), "utf8")).toBe("결과");
  });

  it("보정을 선언하지 않은 Provider 는 그대로 둔다", async () => {
    // 기존 Provider(StarNet2 · BXT) 의 동작이 바뀌면 안 된다.
    const registry = setup(
      [{ ...base, id: "plain" }],
      async (_exe, args) => {
        await writeFile(args[1] as string, "그대로");
        return { code: 0, stdout: "", stderr: "", timedOut: false };
      },
      workspace,
    );
    await writeFile(join(workspace, "in.tif"), "x");

    const result = await registry.execute("gradientRemoval", {
      input: "in.tif",
      output: "out.tif",
    });
    expect(result.converted).toBeUndefined();
    expect(await readFile(join(workspace, "out.tif"), "utf8")).toBe("그대로");
  });
});
