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
import { pathToFileURL } from "node:url";
import { DEFAULT_PORT } from "@photoshop-mcp/photoshop-bridge";
import { startPhotoshopMcpServer, type BridgeMode, type StartOptions } from "./start.js";

const STATE_LABEL: Record<string, string> = {
  disconnected: "연결 끊김",
  handshaking: "핸드셰이크 중",
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
 */
export function readOptionsFromEnv(env: Record<string, string | undefined> = process.env): {
  mode: BridgeMode;
  port: number;
} {
  const mode: BridgeMode = env["PHOTOSHOP_MCP_BRIDGE"] === "mock" ? "mock" : "uxp";

  const rawPort = env["PHOTOSHOP_MCP_PORT"];
  const parsed = rawPort === undefined ? Number.NaN : Number.parseInt(rawPort, 10);
  const port = Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;

  if (rawPort !== undefined && port !== parsed) {
    log(`PHOTOSHOP_MCP_PORT 값이 올바르지 않습니다: ${rawPort} — 기본값 ${DEFAULT_PORT} 사용`);
  }

  return { mode, port };
}

/** CLI 진입점. 오류를 스스로 처리하며 예외를 던지지 않는다. */
export async function main(): Promise<void> {
  const { mode, port } = readOptionsFromEnv();

  const options: StartOptions = {
    mode,
    port,
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
