import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
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
  /**
   * 노출할 Resource 레지스트리. (ROADMAP §16)
   *
   * 생략하면 `resources/*` 를 지원하지 않는다고 선언한다. 빈 목록을 돌려주면
   * 클라이언트가 있는 줄 알고 구독을 시도한다.
   */
  resources?: ResourceSource;
}

/**
 * Resource 노출에 필요한 최소 표면. `ResourceRegistry` 가 이 모양을 만족한다.
 *
 * MCP 서버가 mcp-core 의 구현을 직접 알지 않도록 좁게 받는다.
 */
export interface ResourceSource {
  list(): { uri: string; name: string; description?: string; mimeType?: string }[];
  read(uri: string): Promise<{
    definition: { uri: string; mimeType?: string };
    contents: unknown;
  }>;
  subscribe(uri: string): void;
  unsubscribe(uri: string): void;
  setNotifier(notify: (uri: string) => void): void;
}

/**
 * MCP Client 와 통신하는 최상위 인터페이스. (ARCHITECTURE §4.1)
 *
 * Photoshop 구현 로직을 갖지 않는다. `tools/list` 와 `tools/call` 요청을
 * {@link ToolRegistry} 로 넘기고 결과와 오류를 MCP 형식으로 변환하는 역할만 한다.
 */
export class PhotoshopMcpServer {
  readonly #registry: ToolRegistry;
  readonly #resources: ResourceSource | null;
  readonly #server: Server;
  #transport: Transport | null = null;
  #requestSequence = 0;

  constructor(options: PhotoshopMcpServerOptions) {
    this.#registry = options.registry;
    this.#resources = options.resources ?? null;
    this.#server = new Server(
      {
        name: options.name ?? SERVER_NAME,
        version: options.version ?? SERVER_VERSION,
      },
      {
        capabilities: {
          tools: {},
          // 구독까지 지원한다고 선언한다. Command 가 문서를 바꾸면 알린다.
          ...(options.resources === undefined
            ? {}
            : { resources: { subscribe: true, listChanged: false } }),
        },
      },
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

  /**
   * `resources/*` 핸들러. (ROADMAP §16)
   *
   * 레지스트리를 주지 않았으면 아무것도 등록하지 않는다 — 지원한다고 선언하지도
   * 않았으므로 클라이언트가 부르지 않는다.
   */
  #registerResourceHandlers(): void {
    const resources = this.#resources;
    if (resources === null) {
      return;
    }

    this.#server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: resources.list().map((entry) => ({
        uri: entry.uri,
        name: entry.name,
        ...(entry.description === undefined ? {} : { description: entry.description }),
        mimeType: entry.mimeType ?? "application/json",
      })),
    }));

    this.#server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      try {
        const { definition, contents } = await resources.read(uri);
        return {
          contents: [
            {
              uri,
              mimeType: definition.mimeType ?? "application/json",
              text: JSON.stringify(contents, null, 2),
            },
          ],
        };
      } catch (error) {
        // Tool 과 달리 Resource 는 isError 를 돌려줄 수 없다. 오류로 던져야
        // 클라이언트가 실패를 안다. 코드와 메시지를 담고 원인도 붙인다 —
        // 서버 쪽에서 스택을 추적할 수 있어야 한다.
        const normalized = PhotoshopMcpError.from(error, ErrorCode.COMMAND_FAILED);
        throw new Error(`${normalized.code}: ${normalized.message}`, { cause: error });
      }
    });

    this.#server.setRequestHandler(SubscribeRequestSchema, (request) => {
      resources.subscribe(request.params.uri);
      return {};
    });

    this.#server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
      resources.unsubscribe(request.params.uri);
      return {};
    });

    // 레지스트리가 변경을 알리면 MCP 알림으로 내보낸다.
    // 전송이 붙기 전에 부르면 SDK 가 던지므로 삼킨다 — 알림 때문에 Command 가
    // 실패하면 안 된다.
    resources.setNotifier((uri) => {
      void this.#server.sendResourceUpdated({ uri }).catch(() => {
        // 클라이언트가 이미 끊겼을 수 있다.
      });
    });
  }

  #registerHandlers(): void {
    this.#registerResourceHandlers();

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
