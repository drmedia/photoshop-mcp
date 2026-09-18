import type { CreatePhotoshopMcpOptions, PhotoshopMcp } from "@photoshop-mcp/mcp-core";
import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";

export interface StartOptions extends CreatePhotoshopMcpOptions {
  /**
   * 사용할 transport. 생략하면 stdio 를 사용한다.
   * 테스트에서 in-memory transport 를 주입할 때 사용한다.
   */
  transport?: Parameters<PhotoshopMcp["server"]["start"]>[0];
}

/**
 * Core 를 조립하고 서버를 기동한다.
 *
 * 프로그램적으로 임베드할 때 사용하는 public API 다.
 * 로그를 출력하거나 `process` 를 건드리지 않는다. 그런 처리는 `run.ts` 의 책임이다.
 */
export async function startPhotoshopMcpServer(options: StartOptions = {}): Promise<PhotoshopMcp> {
  const { transport, ...coreOptions } = options;
  const mcp = createPhotoshopMcp(coreOptions);
  await mcp.server.start(transport);
  return mcp;
}
