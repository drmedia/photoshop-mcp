import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 클라이언트가 사라지면 프로세스도 끝난다. (ROADMAP §18.4)
 *
 * **Windows 에는 `SIGTERM` 이 오지 않는다.** MCP 클라이언트가 파이프만 닫고
 * 사라지면 자식은 stdin EOF 만 본다. 그동안 Bridge WebSocket 서버가 이벤트
 * 루프를 붙잡고 있어 프로세스가 남고, **포트를 쥔 채로 산다.** 실기에서
 * 하루에 세 번 손으로 죽였고 그때마다 다음 서버가 `EADDRINUSE` 로 못 떴다.
 *
 * 이 테스트는 **실제 CLI 를 띄운다.** `startPhotoshopMcpServer` 를 직접 부르면
 * stdin 도 시그널도 없어서 재려는 것이 빠진다.
 */

const CLI = fileURLToPath(new URL("../packages/mcp-server/bin/photoshop-mcp.js", import.meta.url));
const ROOT = fileURLToPath(new URL("../", import.meta.url));

let child: ChildProcessWithoutNullStreams | null = null;

afterEach(() => {
  if (child !== null && child.exitCode === null) {
    child.kill();
  }
  child = null;
});

/** CLI 를 띄우고 "시작" 로그가 나올 때까지 기다린다. */
async function launch(port: number): Promise<ChildProcessWithoutNullStreams> {
  const proc = spawn(process.execPath, [CLI], {
    cwd: ROOT,
    env: {
      ...process.env,
      PHOTOSHOP_MCP_BRIDGE: "uxp",
      PHOTOSHOP_MCP_PORT: String(port),
      PHOTOSHOP_MCP_EXTENSIONS_ENABLED: "none",
      PHOTOSHOP_MCP_ALLOW: "read",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`서버가 뜨지 않았습니다. stderr:
${stderr}`),
      );
    }, 20_000);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.includes("stdio 서버 시작")) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`서버가 먼저 끝났습니다 (code ${String(code)}). stderr:
${stderr}`),
      );
    });
  });

  return proc;
}

/** 프로세스가 끝나기를 기다린다. 안 끝나면 `null`. */
async function waitExit(proc: ChildProcessWithoutNullStreams, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null);
    }, ms);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code ?? 0);
    });
  });
}

describe("stdin 이 닫히면", () => {
  it("**프로세스가 끝난다** — 포트를 쥔 채로 남지 않는다", async () => {
    /* 이것이 없으면 Bridge WebSocket 서버가 이벤트 루프를 붙잡아
     * 프로세스가 영원히 산다. 클라이언트는 이미 없는데도. */
    const port = 19000 + Math.floor(Math.random() * 900);
    child = await launch(port);

    child.stdin.end();

    expect(await waitExit(child, 10_000)).toBe(0);
  }, 30_000);

  it("**mock 모드에서도 같다**", async () => {
    /* mock 은 WebSocket 서버를 열지 않아 저절로 끝날 수도 있다. 그래도
     * 같은 경로로 끝나는 것을 고정한다 — 한쪽만 되면 나중에 갈라진다. */
    const proc = spawn(process.execPath, [CLI], {
      cwd: ROOT,
      env: {
        ...process.env,
        PHOTOSHOP_MCP_BRIDGE: "mock",
        PHOTOSHOP_MCP_EXTENSIONS_ENABLED: "none",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child = proc;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("서버가 뜨지 않았습니다."));
      }, 20_000);
      proc.stderr.on("data", (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("stdio 서버 시작")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });

    proc.stdin.end();

    expect(await waitExit(proc, 10_000)).toBe(0);
  }, 30_000);
});
