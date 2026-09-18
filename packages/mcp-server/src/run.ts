/**
 * CLI 부트스트랩.
 *
 * 프로세스 수준의 관심사만 다룬다: 시작 로그, 종료 시그널 처리, 치명적 오류의 종료 코드.
 * Tool 등록이나 Command Engine 구성 같은 조립은 `@photoshop-mcp/mcp-core` 가 담당하고,
 * 기동은 {@link startPhotoshopMcpServer} 가 담당한다.
 *
 * `stdout` 은 MCP stdio 전송이 점유하므로 로그는 반드시 `stderr` 로 출력한다.
 */
import { pathToFileURL } from "node:url";
import { startPhotoshopMcpServer } from "./start.js";

/** CLI 진입점. 오류를 스스로 처리하며 예외를 던지지 않는다. */
export async function main(): Promise<void> {
  try {
    const mcp = await startPhotoshopMcpServer();

    const names = mcp.tools
      .list()
      .map((tool) => tool.name)
      .join(", ");
    console.error(
      `[photoshop-mcp] stdio 서버 시작 (Mock Bridge). Tool ${mcp.tools.size}개: ${names}`,
    );

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        void mcp.server.stop().finally(() => {
          console.error(`[photoshop-mcp] ${signal} 수신, 종료합니다.`);
        });
      });
    }
  } catch (error) {
    console.error("[photoshop-mcp] 시작 실패:", error);
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
