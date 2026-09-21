import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhotoshopMcp, createSilentLogger } from "@photoshop-mcp/mcp-core";
import { MockPhotoshopBridge, PermissionPolicy } from "@photoshop-mcp/photoshop-bridge";
import {
  channelPaths,
  explainRejection,
  readStatus,
  requestRun,
  skyApplied,
  type ChannelPaths,
  type PanelResponse,
} from "../extensions/graxpert/src/panel.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * GraXpert Extension. (ROADMAP §17.37)
 *
 * 패널이 없어도 고정할 수 있는 것을 고정한다 — 스키마, 상태 판정, 거절 안내,
 * 권한. **패널을 흉내 내지 않는다.** 실제 처리는 실기에서만 확인된다.
 *
 * 경로를 주입해서 돌린다. 진짜 경로(`%TEMP%/GraXpert_Photoshop`)를 쓰면
 * **떠 있는 패널이 테스트의 명령을 실제로 실행한다.**
 */

let workspace: string;
let paths: ChannelPaths;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "gx-"));
  /* **Extension 안쪽도 이 경로를 보게 만든다.**
   *
   * `requirePanelReady()` 는 인자를 받지 않으므로 기본 경로를 읽는다. 진짜
   * 경로를 그대로 두면 **떠 있는 패널이 테스트의 명령을 받아 실제로 GraXpert 를
   * 돌린다.** 처음에 이렇게 만들어 두었는데, 그때 패널이 닫혀 있어 통과했다 —
   * 환경에 따라 결과가 달라지는 테스트였다. */
  process.env["PHOTOSHOP_MCP_GRAXPERT_DIR"] = workspace;
  // 기본 10초를 그대로 쓰면 이 파일 하나가 전체 테스트 시간을 두 배로 만든다.
  paths = { ...channelPaths(workspace), responseTimeoutMs: 600, pollMs: 50 };
});

afterEach(async () => {
  delete process.env["PHOTOSHOP_MCP_GRAXPERT_DIR"];
  await rm(workspace, { recursive: true, force: true });
});

const ALL = ["read", "edit", "external", "destructive"];

type Mcp = ReturnType<typeof createPhotoshopMcp>;

async function setup(allow: string[] = ALL): Promise<Mcp> {
  const mcp = createPhotoshopMcp({
    bridge: new MockPhotoshopBridge(),
    logger: createSilentLogger(),
    policy: new PermissionPolicy(allow as never),
  });
  const directory = join(workspace, "graxpert");
  await mkdir(directory, { recursive: true });
  const source = fileURLToPath(new URL("../extensions/graxpert/src/index.ts", import.meta.url));
  await writeFile(
    join(directory, "extension.json"),
    JSON.stringify({
      id: "com.drmedia.graxpert",
      name: "GraXpert Panel Tools",
      version: "0.1.0",
      namespace: "gx",
      main: source,
      permissions: ["photoshop.read", "photoshop.external"],
    }),
    "utf8",
  );
  await mcp.extensions.load({ directory, manifestPath: join(directory, "extension.json") });
  return mcp;
}

const call = async <T>(mcp: Mcp, name: string, input: unknown = {}): Promise<T> =>
  mcp.tools.invoke<T>(name, input, { requestId: "gx" });

/** 패널이 쓰는 상태 파일을 흉내 낸다. */
async function writeStatus(overrides: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    paths.status,
    JSON.stringify({
      schemaVersion: 1,
      at: Date.now(),
      enabled: true,
      panelBusy: false,
      gradientResultBusy: false,
      mode: "background",
      ...overrides,
    }),
    "utf8",
  );
}

describe("상태는 명령을 보내지 않고 읽는다", () => {
  it("파일이 없으면 null 이다", () => {
    // 지어내지 않는다. 없는 것은 없는 것이다.
    expect(readStatus(paths)).toBeNull();
  });

  it("방금 쓴 것은 fresh 다", async () => {
    await writeStatus();
    expect(readStatus(paths)?.fresh).toBe(true);
  });

  it("**낡은 파일은 fresh 가 아니다**", async () => {
    // 패널이 1초마다 쓴다. 닫히면 파일만 남는데, 그걸 현재 상태로 읽으면
    // 닫힌 패널을 열려 있다고 보고하게 된다.
    await writeStatus({ at: Date.now() - 60_000 });
    // mtime 은 지금이라 fresh 로 잡힌다 — at 과 mtime 중 새것을 쓰기 때문이다.
    // 파일을 오래된 것으로 만들려면 mtime 도 과거여야 한다.
    const { utimes } = await import("node:fs/promises");
    const past = new Date(Date.now() - 60_000);
    await utimes(paths.status, past, past);
    expect(readStatus(paths)?.fresh).toBe(false);
  });

  it("깨진 JSON 이면 null 이다", async () => {
    await writeFile(paths.status, "{ 깨진", "utf8");
    expect(readStatus(paths)).toBeNull();
  });

  it("**상태를 읽어도 명령 파일을 만들지 않는다**", async () => {
    await writeStatus();
    readStatus(paths);
    const { existsSync } = await import("node:fs");
    expect(existsSync(paths.command)).toBe(false);
  });
});

describe("요청", () => {
  it("**정식 스키마로 쓴다**", async () => {
    // 패널이 top-level 화이트리스트로 검사한다. 하나라도 빠지거나 더해지면 거절이다.
    const pending = requestRun("denoise", { strength: 0.5 }, new AbortController().signal, paths);
    // 응답이 없으므로 곧 실패한다. 파일만 확인하고 버린다.
    void pending.catch(() => undefined);
    const { readFileSync, existsSync } = await import("node:fs");
    for (let i = 0; i < 50 && !existsSync(paths.command); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const command = JSON.parse(readFileSync(paths.command, "utf8")) as Record<string, unknown>;
    expect(Object.keys(command).sort()).toEqual(
      ["action", "client", "createdAt", "id", "mode", "options", "schemaVersion"].sort(),
    );
    expect(command["schemaVersion"]).toBe(1);
    expect(command["action"]).toBe("run");
    expect(command["mode"]).toBe("denoise");
    // 패널이 10초보다 오래된 명령을 거절한다.
    expect(Date.now() - (command["createdAt"] as number)).toBeLessThan(2000);
  });

  it("**다른 클라이언트의 응답을 읽지 않는다**", async () => {
    // 응답 파일은 공유된다. 실기에서 패널 JSX 액션이 쓴 것이 남아 있었다.
    await writeFile(
      paths.response,
      JSON.stringify({ schemaVersion: 1, id: "photoshop-action-999", accepted: true }),
      "utf8",
    );
    await expect(requestRun("denoise", {}, new AbortController().signal, paths)).rejects.toThrow(
      /응답하지 않았습니다/u,
    );
  });

  it("취소하면 기다리기를 멈춘다", async () => {
    const controller = new AbortController();
    const pending = requestRun("denoise", {}, controller.signal, paths);
    controller.abort();
    await expect(pending).rejects.toThrow(/취소/u);
  });
});

describe("거절 안내", () => {
  const response = (code: string, extra: Partial<PanelResponse> = {}): PanelResponse =>
    ({
      code,
      reason: "사유",
      busySince: null,
      busyForMs: null,
      busyLabel: "",
      busyFrom: "",
      ...extra,
    }) as PanelResponse;

  it("**코드마다 고치는 방법을 말한다**", () => {
    // "거절되었습니다" 만으로는 사용자가 할 수 있는 일이 없다.
    expect(explainRejection(response("automation_disabled"))).toMatch(/Allow External Automation/u);
    expect(explainRejection(response("panel_busy"))).toMatch(/다른 처리/u);
    expect(explainRejection(response("stale_command"))).toMatch(/시계|멈춰/u);
  });

  it("코드를 그대로 담는다", () => {
    // 기계가 가릴 수 있어야 한다.
    expect(explainRejection(response("unsupported_parameter"))).toMatch(
      /\[unsupported_parameter\]/u,
    );
  });

  it("**busy 면 얼마나 오래됐는지와 어디서 켰는지를 말한다**", () => {
    // 오래 켜져 있는데 진행이 없으면 패널의 setBusy(false) 가 빠진 것이다.
    const text = explainRejection(
      response("panel_busy", {
        busySince: Date.now() - 41_000,
        busyForMs: 41_000,
        busyLabel: "Denoise 처리 중…",
        busyFrom: "main.js:4516",
      }),
    );
    expect(text).toMatch(/41초째/u);
    expect(text).toMatch(/main\.js:4516/u);
  });
});

describe("Tool", () => {
  it("권한 — 조회는 read, 실행은 external", async () => {
    const mcp = await setup();
    expect(mcp.tools.get("gx.status")?.permission).toBe("read");
    expect(mcp.tools.get("gx.run_gradient")?.permission).toBe("external");
    expect(mcp.tools.get("gx.run_denoise")?.permission).toBe("external");
  });

  it("**기본 권한에서는 실행이 막힌다**", async () => {
    const mcp = await setup(["read", "edit"]);
    await expect(call(mcp, "gx.run_denoise")).rejects.toThrow(/권한|permission/iu);
  });

  it("**패널이 없으면 Job 을 띄우지 않는다**", async () => {
    // 즉시 알 수 있는 것을 job.status 로 미루지 않는다.
    const mcp = await setup();
    await expect(call(mcp, "gx.run_denoise")).rejects.toThrow(
      /상태 파일이 없습니다|떠 있지 않습니다/u,
    );
    expect(mcp.jobs.list()).toHaveLength(0);
  });

  it("**자동화가 꺼져 있으면 Job 을 띄우지 않는다**", async () => {
    // 패널은 열려 있지만 Allow External Automation 이 꺼진 상태.
    await writeStatus({ enabled: false });
    const mcp = await setup();
    await expect(call(mcp, "gx.run_denoise")).rejects.toThrow(/Allow External Automation/u);
    expect(mcp.jobs.list()).toHaveLength(0);
  });

  it("**패널이 준비되면 Job 이 뜬다**", async () => {
    /* 앞의 두 테스트만 있으면 "항상 거절한다" 도 통과한다. 준비된 경우를
     * 함께 고정해야 가드가 진짜 가드인지 알 수 있다.
     *
     * 이 테스트는 Extension 이 **주입된 경로**를 본다는 증거이기도 하다 —
     * 진짜 패널을 보고 있다면 여기 쓴 가짜 상태가 보이지 않는다. */
    await writeStatus();
    const mcp = await setup();
    const started = await call<{ jobId: string }>(mcp, "gx.run_denoise", { strength: 0.5 });
    expect(started.jobId).toBeTypeOf("string");
    expect(mcp.jobs.list()).toHaveLength(1);
    // 응답할 패널이 없으므로 Job 은 곧 실패한다. 서버가 내려갈 때 정리된다.
    mcp.jobs.cancelAll();
  });
});

describe("스키마", () => {
  let mcp: Mcp;
  beforeEach(async () => {
    mcp = await setup();
  });

  const reject = async (name: string, input: unknown): Promise<void> => {
    await expect(call(mcp, name, input)).rejects.toThrow();
  };

  it("**`method` 를 받지 않는다**", async () => {
    // 외부 자동화는 언제나 AI Auto 다. 패널이 unsupported_parameter 로 거절한다 —
    // 여기서 먼저 막지 않으면 왕복 한 번을 버린다.
    await reject("gx.run_gradient", { method: "AI" });
    await reject("gx.run_gradient", { method: "sample" });
  });

  it("**`batchSize` 는 여섯 값뿐이다**", async () => {
    // 패널이 1·2·4·8·16·32 만 받는다. 3 을 보내면 invalid_batch_size 다.
    await reject("gx.run_denoise", { batchSize: 3 });
    await reject("gx.run_denoise", { batchSize: 64 });
  });

  it("0–1 밖을 거절한다", async () => {
    await reject("gx.run_gradient", { smoothing: 1.5 });
    await reject("gx.run_denoise", { strength: -0.1 });
  });

  it("**모르는 필드를 거절한다**", async () => {
    // 통로가 바뀌며 이름이 달라진 것들이 있다. 남아 있으면 조용히 무시된다.
    await reject("gx.run_gradient", { interpolation: "RBF" });
    await reject("gx.run_denoise", { strength: 0.5, bogus: 1 });
  });

  it("gx.status 는 인자를 받지 않는다", async () => {
    await reject("gx.status", { verbose: true });
  });
});

describe("gx.status 응답", () => {
  it("**패널이 없으면 지어내지 않는다**", async () => {
    const mcp = await setup();
    const result = await call<Record<string, unknown>>(mcp, "gx.status");
    expect(result["panelRunning"]).toBe(false);
    // 모르는 것은 false 가 아니라 null 이다. false 로 덮으면 "꺼져 있다" 는
    // 틀린 사실을 말하게 된다. (rawBitDepth · isBackground 와 같은 원칙)
    expect(result["automationEnabled"]).toBeNull();
    expect(result["blocked"]).toMatch(/상태 파일이 없습니다/u);
  });
});

describe("**하늘 경로를 탔는지는 이름으로 판정한다**", () => {
  // 응답의 settings.method 는 언제나 "AI" 라 "요청했다" 까지만 말한다.
  // 선택이 없어 일반 처리로 간 경우와 구별되지 않는다.

  it("합성·마스크 둘 다 하늘이다", () => {
    expect(skyApplied(["GraXpert - AI Gradient - Sky Merged"])).toBe(true);
    expect(skyApplied(["GraXpert - AI Gradient - Sky Masked"])).toBe(true);
  });

  it("**접미사가 없으면 하늘이 아니다**", () => {
    // 실기에서 선택이 사라진 채 돌아 이 이름이 나왔고, 12초 만에 끝나
    // 성공처럼 보였다. 이 한 줄이 그것을 잡는다.
    expect(skyApplied(["GraXpert - AI Gradient"])).toBe(false);
  });

  it("Denoise 결과는 하늘이 아니다", () => {
    expect(skyApplied(["GraXpert Denoise"])).toBe(false);
  });

  it("여러 장이면 하나라도 있으면 된다", () => {
    expect(skyApplied(["배경 모델", "GraXpert - AI Gradient - Sky Merged"])).toBe(true);
  });

  it("빈 목록은 거짓이다", () => {
    expect(skyApplied([])).toBe(false);
  });

  it("**끝에 있어야 한다**", () => {
    // 사용자가 레이어 이름을 바꿔 그 말이 가운데 들어갈 수 있다.
    expect(skyApplied(["Sky Merged 실험본"])).toBe(false);
  });
});
