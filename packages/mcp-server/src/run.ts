/**
 * CLI 부트스트랩.
 *
 * 프로세스 수준의 관심사만 다룬다: 환경 변수 읽기, 시작 로그, 종료 시그널 처리,
 * 치명적 오류의 종료 코드.
 *
 * Tool 등록이나 Command Engine 구성 같은 조립은 `@photoshop-mcp/mcp-core` 가 담당하고,
 * 기동은 {@link startPhotoshopMcpServer} 가 담당한다.
 *
 * `stdout` 은 MCP stdio 전송이 점유하므로 로그는 반드시 `stderr` 로 출력한다.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_PORT,
  PermissionPolicy,
  parsePermissionLevels,
} from "@photoshop-mcp/photoshop-bridge";
import { startPhotoshopMcpServer, type BridgeMode, type StartOptions } from "./start.js";

const STATE_LABEL: Record<string, string> = {
  disconnected: "연결 끊김",
  handshaking: "hello 대기",
  awaiting_ready: "ready 대기",
  connected: "연결됨",
};

function log(message: string): void {
  console.error(`[photoshop-mcp] ${message}`);
}

/**
 * 환경 변수에서 실행 옵션을 읽는다.
 *
 * - `PHOTOSHOP_MCP_PORT` — Bridge WebSocket 포트 (기본 8765)
 * - `PHOTOSHOP_MCP_BRIDGE` — `uxp` (기본) 또는 `mock`
 * - `PHOTOSHOP_MCP_EXTENSIONS` — Extension 디렉터리 (기본 `<cwd>/extensions`)
 * - `PHOTOSHOP_MCP_ALLOW` — 허용할 Permission Level (기본 `read,edit`)
 * - `PHOTOSHOP_MCP_CAPABILITIES` — 외부 처리기 설정 (기본 `<cwd>/capabilities.json`)
 * - `PHOTOSHOP_MCP_WORKFLOWS` — 워크플로 설정 (기본 `<cwd>/workflows.json`)
 */
export function readOptionsFromEnv(env: Record<string, string | undefined> = process.env): {
  mode: BridgeMode;
  port: number;
  extensionsDir: string;
  capabilityConfig: string;
  workflowConfig: string;
  policy: PermissionPolicy;
} {
  const mode: BridgeMode = env["PHOTOSHOP_MCP_BRIDGE"] === "mock" ? "mock" : "uxp";

  const rawPort = env["PHOTOSHOP_MCP_PORT"];
  const parsed = rawPort === undefined ? Number.NaN : Number.parseInt(rawPort, 10);
  const port = Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;

  if (rawPort !== undefined && port !== parsed) {
    log(`PHOTOSHOP_MCP_PORT 값이 올바르지 않습니다: ${rawPort} — 기본값 ${DEFAULT_PORT} 사용`);
  }

  // 디렉터리가 없으면 조용히 건너뛴다. Extension 이 없는 것은 정상이다.
  const extensionsDir = resolve(env["PHOTOSHOP_MCP_EXTENSIONS"] ?? "extensions");

  // 값을 주면 그것이 **전체 목록**이다. 기존 기본값에 더하지 않는다.
  // 그래야 `PHOTOSHOP_MCP_ALLOW=read` 로 읽기 전용 서버를 만들 수 있다.
  const { levels, unknown } = parsePermissionLevels(env["PHOTOSHOP_MCP_ALLOW"]);
  if (unknown.length > 0) {
    // 오타 때문에 권한이 빠진 것을 조용히 넘기지 않는다.
    log(`PHOTOSHOP_MCP_ALLOW 에 알 수 없는 값이 있습니다: ${unknown.join(", ")} — 무시합니다`);
  }

  // 파일이 없으면 조용히 넘어간다. 외부 처리기가 없는 것은 정상이다.
  const capabilityConfig = resolve(env["PHOTOSHOP_MCP_CAPABILITIES"] ?? "capabilities.json");

  const workflowConfig = resolve(env["PHOTOSHOP_MCP_WORKFLOWS"] ?? "workflows.json");

  return {
    mode,
    port,
    extensionsDir,
    capabilityConfig,
    workflowConfig,
    policy: new PermissionPolicy(levels),
  };
}

/** CLI 진입점. 오류를 스스로 처리하며 예외를 던지지 않는다. */
export async function main(): Promise<void> {
  const { mode, port, extensionsDir, capabilityConfig, workflowConfig, policy } =
    readOptionsFromEnv();

  const options: StartOptions = {
    mode,
    port,
    extensionsDir,
    capabilityConfig,
    workflowConfig,
    policy,
    onBridgeStateChange: (state) => {
      log(`Bridge: ${STATE_LABEL[state] ?? state}`);
    },
  };

  try {
    const mcp = await startPhotoshopMcpServer(options);

    const names = mcp.tools
      .list()
      .map((tool) => tool.name)
      .join(", ");
    const bridgeLabel =
      mode === "mock" ? "Mock Bridge" : `UXP Bridge (ws://127.0.0.1:${port} 대기 중)`;
    log(`stdio 서버 시작. ${bridgeLabel}`);
    log(`Tool ${mcp.tools.size}개: ${names}`);
    log(`허용 권한: ${policy.allowed.join(", ") || "(없음)"}`);
    if (mcp.loadedProviders > 0) {
      log(`외부 처리기 ${mcp.loadedProviders}개: ${mcp.capabilities.list().join(", ")}`);
    }
    if (mcp.loadedWorkflows > 0) {
      log(
        `워크플로 ${mcp.loadedWorkflows}개: ${mcp.workflows
          .list()
          .map((w) => w.id)
          .join(", ")}`,
      );
    }
    if (mcp.loadedExtensions.length > 0) {
      const extensionNames = mcp.loadedExtensions
        .map((extension) => `${extension.manifest.name}(${extension.manifest.namespace})`)
        .join(", ");
      log(`Extension ${mcp.loadedExtensions.length}개: ${extensionNames}`);
    }

    // 잡히지 않은 오류를 알아볼 수 있게 남긴다. (ROADMAP §17 Crash recovery)
    //
    // 삼키지 않는다. MCP 서버는 클라이언트가 다시 띄우므로 죽는 편이 맞고,
    // 오류를 감추면 다음에 같은 문제가 또 난다. 다만 진행 중인 Job 은 정리한다 —
    // 그러지 않으면 외부 처리기 프로세스가 서버보다 오래 산다.
    const fatal = (kind: string) => (error: unknown) => {
      log(`${kind}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      try {
        const cancelled = mcp.jobs.cancelAll();
        if (cancelled > 0) {
          log(`진행 중이던 Job ${cancelled}개를 취소했습니다.`);
        }
      } catch {
        // 정리 중 또 실패해도 원래 오류를 덮지 않는다.
      }
      process.exitCode = 1;
      process.exit(1);
    };
    process.once("uncaughtException", fatal("처리되지 않은 예외"));
    process.once("unhandledRejection", fatal("처리되지 않은 Promise 거부"));

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void mcp.stop().finally(() => {
          log(`${signal} 수신, 종료합니다.`);
        });
      });
    }
  } catch (error) {
    log(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

/**
 * 이 파일이 직접 실행된 경우에만 기동한다.
 *
 * `npm run dev` 는 이 파일을 tsx 로 직접 실행하고,
 * `bin/photoshop-mcp.js` 는 {@link main} 을 import 해서 호출한다.
 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main();
}
