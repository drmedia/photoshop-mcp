import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@photoshop-mcp/photoshop-bridge";
import {
  ErrorCode,
  PhotoshopMcpError,
  SERVER_NAME,
  SERVER_VERSION,
} from "@photoshop-mcp/photoshop-bridge";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface PhotoshopMcpServerOptions {
  /** MCP Client 에 보고할 서버 이름. */
  name?: string;
  /** MCP Client 에 보고할 서버 버전. */
  version?: string;
  /** 노출할 Tool 레지스트리. */
  registry: ToolRegistry;
}

/**
 * MCP Client 와 통신하는 최상위 인터페이스. (ARCHITECTURE §4.1)
 *
 * Photoshop 구현 로직을 갖지 않는다. `tools/list` 와 `tools/call` 요청을
 * {@link ToolRegistry} 로 넘기고 결과와 오류를 MCP 형식으로 변환하는 역할만 한다.
 */
export class PhotoshopMcpServer {
  readonly #registry: ToolRegistry;
  readonly #server: Server;
  #transport: Transport | null = null;
  #requestSequence = 0;

  constructor(options: PhotoshopMcpServerOptions) {
    this.#registry = options.registry;
    this.#server = new Server(
      {
        name: options.name ?? SERVER_NAME,
        version: options.version ?? SERVER_VERSION,
      },
      { capabilities: { tools: {} } },
    );
    this.#registerHandlers();
  }

  /** 하위 MCP SDK 서버. 테스트에서 in-memory transport 를 붙일 때 사용한다. */
  get server(): Server {
    return this.#server;
  }

  /** 서버를 기동한다. transport 를 생략하면 stdio 를 사용한다. */
  async start(transport: Transport = new StdioServerTransport()): Promise<void> {
    this.#transport = transport;
    await this.#server.connect(transport);
  }

  /** 서버를 정지한다. */
  async stop(): Promise<void> {
    if (this.#transport === null) {
      return;
    }
    await this.#server.close();
    this.#transport = null;
  }

  #registerHandlers(): void {
    this.#server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: this.#registry.list().map((tool) => ({
        name: tool.name,
        // 요구 권한을 설명에 덧붙인다. 클라이언트가 호출 전에 위험도를 알 수 있어야 한다.
        description: `${tool.description} [권한: ${tool.permission}]`,
        inputSchema: zodToJsonSchema(tool.inputSchema, {
          target: "jsonSchema7",
          $refStrategy: "none",
        }) as { type: "object" },
      })),
    }));

    this.#server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const requestId = `req-${++this.#requestSequence}`;
      try {
        const result = await this.#registry.invoke(request.params.name, request.params.arguments, {
          requestId,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: toStructuredContent(result),
        };
      } catch (error) {
        const normalized = PhotoshopMcpError.from(error, ErrorCode.COMMAND_FAILED);
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify(normalized.toJSON(), null, 2) }],
        };
      }
    });
  }
}

/**
 * Tool 결과를 MCP `structuredContent` 로 변환한다.
 * 객체가 아닌 결과(배열·원시값)는 `value` 키로 감싼다.
 */
function toStructuredContent(result: unknown): Record<string, unknown> {
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  return { value: result };
}
