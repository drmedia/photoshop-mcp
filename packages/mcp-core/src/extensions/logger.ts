import type { Logger } from "@photoshop-mcp/photoshop-bridge";

/**
 * stderr 로만 쓰는 로거.
 *
 * `stdout` 은 MCP stdio 전송이 점유한다. 로그를 그쪽으로 보내면 프로토콜이 깨진다.
 */
export function createConsoleLogger(prefix = "photoshop-mcp"): Logger {
  const write = (level: string, message: string, details?: unknown): void => {
    const line = `[${prefix}] ${level} ${message}`;
    if (details === undefined) {
      console.error(line);
    } else {
      console.error(line, details);
    }
  };

  return {
    debug: (message, details) => {
      // 기본적으로 조용하다. 필요하면 PHOTOSHOP_MCP_DEBUG 로 켠다.
      if (process.env["PHOTOSHOP_MCP_DEBUG"] === "1") {
        write("debug", message, details);
      }
    },
    info: (message, details) => write("info", message, details),
    warn: (message, details) => write("warn", message, details),
    error: (message, details) => write("error", message, details),
  };
}

/** 아무것도 쓰지 않는 로거. 테스트에서 쓴다. */
export function createSilentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}
