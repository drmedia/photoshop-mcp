import { WebSocketServer, type WebSocket } from "ws";
import { ErrorCode, PhotoshopMcpError } from "../protocol/errors.js";
import type {
  CommandMessage,
  ConnectionState,
  HelloAckMessage,
  HelloMessage,
  OutboundMessage,
  ResponseMessage,
} from "../protocol/messages.js";
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  InboundMessageSchema,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
} from "../protocol/messages.js";
import { SERVER_NAME, SERVER_VERSION } from "../protocol/server-info.js";
import type { BridgeTransport, SendOptions } from "./transport.js";

export const DEFAULT_PORT = 8765;
export const DEFAULT_HOST = "127.0.0.1";

/**
 * 서버가 빈 포트를 찾아 볼 후보의 수. `DEFAULT_PORT` 부터 연속으로 센다. (ROADMAP §93)
 *
 * **Plugin 도 같은 범위를 훑는다.** Plugin 은 contracts 를 타입으로만 참조해서 이 값을 import 할 수
 * 없다 — `photoshop-uxp/src/transport/bridge-ports.ts` 에 같은 값이 따로 있고
 * `tests/bridge-port-sync.test.ts` 가 둘이 같은지 대조한다. 한쪽만 바뀌면 Plugin 이 서버를 못 찾는다.
 */
export const PORT_CANDIDATES = 10;

export interface WebSocketBridgeTransportOptions {
  /** 바인딩 포트. 기본 8765. `0` 을 주면 임의의 빈 포트를 사용한다. */
  port?: number;
  /**
   * `port` 부터 연속으로 몇 개까지 시도할지. 기본 1(= `port` 하나만).
   *
   * 앞 포트가 `EADDRINUSE` 면 다음 포트로 넘어간다. **그 밖의 오류는 넘어가지 않는다** — 권한 오류처럼
   * 포트를 바꿔도 같은 오류는 포트 탓이 아니다. `port: 0` 이면 무시한다.
   */
  portCount?: number;
  /** 바인딩 호스트. 기본 `127.0.0.1` (루프백 전용). */
  host?: string;
  /** Command 기본 타임아웃(ms). */
  timeoutMs?: number;
  /** 연결 상태 변화 알림. 로깅용. */
  onStateChange?: (state: ConnectionState) => void;
  /**
   * Plugin 이 보낸 이벤트. (ROADMAP §15)
   *
   * 전송 계층은 이벤트의 의미를 알지 못한다. 이름과 payload 를 그대로 올린다.
   */
  onEvent?: (event: string, payload: unknown) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: PhotoshopMcpError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Plugin 이 보고한 정보. `hello` 수신 후 채워진다. */
export interface PluginInfo {
  name: string;
  version: string;
  host?: { app: string; version: string };
  commands: string[];
}

/**
 * WebSocket 기반 Bridge 전송. MCP Server 측이 서버 역할을 한다. (PROTOCOL.md §1)
 *
 * 핸드셰이크는 3단계다. (PROTOCOL.md §3.2~3.4)
 *
 * ```text
 * Plugin → hello       handshaking
 * Server → hello_ack   awaiting_ready
 * Plugin → ready       connected
 * ```
 *
 * `ready` 를 받기 전에는 Command 를 보내지 않는다.
 *
 * 동시에 하나의 Plugin 연결만 유지하며, 새 연결이 오면 이전 연결을 대체한다.
 * 재접속 책임은 Plugin 쪽에 있고 이 전송은 계속 listen 한다. (PROTOCOL.md §7)
 */
export class WebSocketBridgeTransport implements BridgeTransport {
  readonly #port: number;
  readonly #portCount: number;
  readonly #host: string;
  readonly #timeoutMs: number;
  readonly #onStateChange: ((state: ConnectionState) => void) | undefined;
  readonly #onEvent: ((event: string, payload: unknown) => void) | undefined;

  #server: WebSocketServer | null = null;
  #socket: WebSocket | null = null;
  #state: ConnectionState = "disconnected";
  #plugin: PluginInfo | null = null;
  #sequence = 0;
  readonly #pending = new Map<string, PendingRequest>();

  constructor(options: WebSocketBridgeTransportOptions = {}) {
    this.#port = options.port ?? DEFAULT_PORT;
    this.#portCount = Math.max(1, Math.floor(options.portCount ?? 1));
    this.#host = options.host ?? DEFAULT_HOST;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.#onStateChange = options.onStateChange;
    this.#onEvent = options.onEvent;
  }

  /** 실제로 바인딩된 포트. `port: 0` 으로 기동한 경우 확인에 사용한다. */
  get port(): number {
    const address = this.#server?.address();
    return typeof address === "object" && address !== null ? address.port : this.#port;
  }

  /** 접속한 Plugin 정보. `hello` 이전이면 `null`. */
  get plugin(): PluginInfo | null {
    return this.#plugin;
  }

  async start(): Promise<void> {
    if (this.#server !== null) {
      return;
    }

    /* 앞 포트가 쓰이고 있으면 다음 포트로 넘어간다. (ROADMAP §93)
     *
     * **`EADDRINUSE` 만 넘어간다.** 다른 오류는 포트를 바꿔도 같으므로 바로 알린다. `port: 0` 은
     * OS 가 빈 포트를 고르니 찾을 것이 없다. 마지막 후보까지 쓰이고 있으면 그 오류를 그대로 던진다 —
     * 호출자(`run.ts`)가 `EADDRINUSE` 로 알아본다. */
    const attempts = this.#port === 0 ? 1 : this.#portCount;
    let lastError: PhotoshopMcpError | null = null;
    for (let offset = 0; offset < attempts; offset += 1) {
      const port = this.#port === 0 ? 0 : this.#port + offset;
      if (port > 65_535) {
        break;
      }
      try {
        await this.#listen(port);
        return;
      } catch (error) {
        lastError = error as PhotoshopMcpError;
        const code = (lastError.cause as { code?: unknown } | undefined)?.code;
        if (code !== "EADDRINUSE") {
          throw lastError;
        }
      }
    }
    throw (
      lastError ?? new PhotoshopMcpError(ErrorCode.COMMAND_FAILED, "빈 포트를 찾지 못했습니다.")
    );
  }

  /** 포트 하나에 바인딩한다. 실패하면 서버를 정리하고 던진다. */
  async #listen(port: number): Promise<void> {
    const server = new WebSocketServer({
      host: this.#host,
      port,
      maxPayload: MAX_FRAME_BYTES,
    });
    this.#server = server;

    server.on("connection", (socket) => {
      this.#attach(socket);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        this.#server = null;
        server.close();
        reject(new PhotoshopMcpError(ErrorCode.COMMAND_FAILED, error.message, { cause: error }));
      };
      server.once("error", onError);
      server.once("listening", () => {
        server.off("error", onError);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;

    this.#failAllPending(
      new PhotoshopMcpError(ErrorCode.PHOTOSHOP_NOT_CONNECTED, "Bridge 전송이 정지되었습니다.", {
        recoverable: true,
      }),
    );

    this.#socket?.close(1001, "server shutting down");
    this.#socket = null;
    this.#plugin = null;
    this.#setState("disconnected");

    if (server === null) {
      return;
    }
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }

  /** `ready` 까지 완료된 연결이 있는지. */
  isConnected(): boolean {
    return this.#state === "connected";
  }

  state(): ConnectionState {
    return this.#state;
  }

  async request<TResult>(
    message: Omit<CommandMessage, "id" | "type">,
    options: SendOptions = {},
  ): Promise<TResult> {
    const socket = this.#socket;
    // ready 이전에는 Command 를 보내지 않는다. (PROTOCOL.md §3.4)
    if (socket === null || this.#state !== "connected") {
      throw new PhotoshopMcpError(
        ErrorCode.PHOTOSHOP_NOT_CONNECTED,
        "Photoshop 에 연결되어 있지 않습니다.",
        { recoverable: true, details: { state: this.#state } },
      );
    }

    const id = `req-${++this.#sequence}`;
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;

    const result = new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new PhotoshopMcpError(
            ErrorCode.COMMAND_TIMEOUT,
            `Command 응답이 ${timeoutMs}ms 내에 도착하지 않았습니다: ${message.command}`,
            { recoverable: true, details: { command: message.command, timeoutMs } },
          ),
        );
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
    });

    this.#send(socket, { id, type: "command", ...message });
    return result;
  }

  // -------------------------------------------------------------------------

  /** 새 연결을 받아들이고 이전 연결을 대체한다. */
  #attach(socket: WebSocket): void {
    this.#socket?.close(1012, "replaced by a new connection");

    this.#socket = socket;
    this.#plugin = null;
    this.#setState("handshaking");

    socket.on("message", (data) => {
      this.#handleFrame(socket, String(data));
    });

    const detach = (): void => {
      if (this.#socket !== socket) {
        return;
      }
      this.#socket = null;
      this.#plugin = null;
      this.#setState("disconnected");
      // 끊김 시 타임아웃을 기다리지 않고 즉시 실패시킨다. (PROTOCOL.md §7)
      this.#failAllPending(
        new PhotoshopMcpError(ErrorCode.PHOTOSHOP_NOT_CONNECTED, "Photoshop 연결이 끊어졌습니다.", {
          recoverable: true,
        }),
      );
    };

    socket.on("close", detach);
    socket.on("error", detach);
  }

  #handleFrame(socket: WebSocket, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.#rejectProtocol(socket, "프레임이 올바른 JSON 이 아닙니다.");
      return;
    }

    const parsed = InboundMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.#rejectProtocol(socket, "메시지가 프로토콜 스키마를 만족하지 않습니다.");
      return;
    }

    const message = parsed.data;

    switch (message.type) {
      case "hello":
        this.#handleHello(socket, message);
        return;
      case "ready":
        this.#handleReady();
        return;
      case "event":
        // 핸드셰이크 전에 온 이벤트는 버린다. 아직 우리 연결이 아니다.
        if (this.#state === "connected") {
          this.#onEvent?.(message.event, message.payload);
        }
        return;
      case "response":
        // 핸드셰이크 완료 전에 도착한 응답은 버린다. (PROTOCOL.md §3.5)
        if (this.#state !== "connected") {
          return;
        }
        this.#handleResponse(message);
        return;
    }
  }

  /** 1단계 수신 → 2단계 발신. */
  #handleHello(socket: WebSocket, hello: HelloMessage): void {
    const { protocolVersion, plugin, host, commands } = hello.payload;

    if (protocolVersion !== PROTOCOL_VERSION) {
      const rejected: HelloAckMessage = {
        type: "hello_ack",
        payload: {
          accepted: false,
          protocolVersion: PROTOCOL_VERSION,
          error: {
            code: ErrorCode.PROTOCOL_VERSION_MISMATCH,
            message: `프로토콜 버전이 다릅니다. server=${PROTOCOL_VERSION} plugin=${protocolVersion}`,
          },
        },
      };
      this.#send(socket, rejected);
      socket.close(1002, "protocol version mismatch");
      return;
    }

    this.#plugin = {
      name: plugin.name,
      version: plugin.version,
      commands: [...commands],
      ...(host === undefined ? {} : { host }),
    };

    const accepted: HelloAckMessage = {
      type: "hello_ack",
      payload: {
        accepted: true,
        protocolVersion: PROTOCOL_VERSION,
        server: { name: SERVER_NAME, version: SERVER_VERSION, pid: process.pid },
      },
    };
    this.#send(socket, accepted);

    // 아직 connected 가 아니다. ready 를 기다린다.
    this.#setState("awaiting_ready");
  }

  /** 3단계 수신 → 연결 확정. */
  #handleReady(): void {
    // hello 를 건너뛴 ready 는 무시한다. 순서를 지키지 않은 Plugin 이다.
    if (this.#state !== "awaiting_ready") {
      return;
    }
    this.#setState("connected");
  }

  #handleResponse(response: ResponseMessage): void {
    const pending = this.#pending.get(response.id);
    // 대기 항목이 없는 응답은 버린다. 타임아웃 후 늦게 도착한 경우가 여기 해당한다.
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);

    if (response.success) {
      pending.resolve(response.result);
      return;
    }

    const { code, message, details, recoverable } = response.error;
    pending.reject(
      new PhotoshopMcpError(code, message, {
        recoverable: recoverable ?? false,
        ...(details === undefined ? {} : { details }),
      }),
    );
  }

  #rejectProtocol(socket: WebSocket, message: string): void {
    this.#failAllPending(new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, message));
    socket.close(1002, "protocol error");
  }

  #failAllPending(error: PhotoshopMcpError): void {
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  #send(socket: WebSocket, message: OutboundMessage): void {
    socket.send(JSON.stringify(message));
  }

  #setState(state: ConnectionState): void {
    if (this.#state === state) {
      return;
    }
    this.#state = state;
    this.#onStateChange?.(state);
  }
}
