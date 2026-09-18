import type {
  CommandMessage,
  ErrorResponseMessage,
  HelloMessage,
  ResponseMessage,
} from "@photoshop-mcp/photoshop-bridge";
import { CommandDispatcher, DispatchError, type CommandPayload } from "../dispatcher/dispatcher.js";

/** PROTOCOL.md §3.3 */
export const PROTOCOL_VERSION = 1;

/** PROTOCOL.md §7 — 지수 백오프 */
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export type ClientState = "disconnected" | "connecting" | "handshaking" | "connected";

export interface BridgeClientOptions {
  url: string;
  dispatcher: CommandDispatcher;
  plugin: { name: string; version: string };
  host?: { app: string; version: string };
  /** 상태 변화 알림. 연결 상태 UI 갱신에 사용한다. */
  onStateChange?: (state: ClientState) => void;
  /** 진단 로그. */
  log?: (message: string) => void;
}

/**
 * MCP Server 로 접속하는 WebSocket 클라이언트. (PROTOCOL.md §1)
 *
 * Server 가 아니라 Plugin 이 접속하며, 재접속 책임도 Plugin 쪽에 있다. (PROTOCOL.md §7)
 * 이 클래스는 프레임 송수신과 연결 수명만 다룬다.
 * Command 의 의미 해석은 {@link CommandDispatcher} 가 담당한다.
 */
export class BridgeClient {
  private readonly options: BridgeClientOptions;
  private socket: WebSocket | null = null;
  private currentState: ClientState = "disconnected";
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private helloSequence = 0;

  constructor(options: BridgeClientOptions) {
    this.options = options;
  }

  get state(): ClientState {
    return this.currentState;
  }

  /** 접속을 시작한다. 실패하면 백오프 후 재시도한다. */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  /** 재접속을 중단하고 연결을 닫는다. */
  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "plugin stopping");
    this.setState("disconnected");
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.clearReconnectTimer();
    this.setState("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.log(`접속 실패: ${describe(error)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = (): void => {
      this.setState("handshaking");
      this.sendHello(socket);
    };

    socket.onmessage = (event: MessageEvent): void => {
      void this.handleFrame(socket, String(event.data));
    };

    socket.onerror = (): void => {
      this.log("WebSocket 오류");
    };

    socket.onclose = (): void => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.setState("disconnected");
      this.scheduleReconnect();
    };
  }

  private sendHello(socket: WebSocket): void {
    const hello: HelloMessage = {
      id: `hs-${++this.helloSequence}`,
      type: "hello",
      payload: {
        protocolVersion: PROTOCOL_VERSION,
        plugin: this.options.plugin,
        commands: this.options.dispatcher.list(),
        ...(this.options.host === undefined ? {} : { host: this.options.host }),
      },
    };
    this.send(socket, hello);
  }

  private async handleFrame(socket: WebSocket, raw: string): Promise<void> {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      this.log("서버 프레임이 올바른 JSON 이 아닙니다.");
      return;
    }

    if (!isRecord(message)) {
      return;
    }

    // hello 응답 (welcome 또는 버전 불일치 오류)
    if (this.currentState === "handshaking" && typeof message["success"] === "boolean") {
      this.handleWelcome(message);
      return;
    }

    if (message["type"] === "command") {
      await this.handleCommand(socket, message);
      return;
    }
  }

  private handleWelcome(message: Record<string, unknown>): void {
    if (message["success"] !== true) {
      const error = isRecord(message["error"]) ? message["error"] : {};
      this.log(`핸드셰이크 거부: ${String(error["code"])} ${String(error["message"])}`);
      // 서버가 연결을 닫는다. onclose 에서 백오프 재접속으로 이어진다.
      return;
    }

    // 핸드셰이크 성공 시 백오프를 초기화한다.
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    this.setState("connected");
    this.log("핸드셰이크 완료");
  }

  private async handleCommand(socket: WebSocket, message: Record<string, unknown>): Promise<void> {
    const id = typeof message["id"] === "string" ? message["id"] : null;
    const command = typeof message["command"] === "string" ? message["command"] : null;

    if (id === null || command === null) {
      this.log("command 메시지에 id 또는 command 가 없습니다.");
      return;
    }

    const payload: CommandPayload = isRecord(message["payload"]) ? message["payload"] : {};

    try {
      const result = await this.options.dispatcher.dispatch(command, payload);
      const response: ResponseMessage = { id, type: "response", success: true, result };
      this.send(socket, response);
    } catch (error) {
      const dispatchError =
        error instanceof DispatchError
          ? error
          : new DispatchError("COMMAND_FAILED", describe(error), { details: { command } });
      const response: ErrorResponseMessage = {
        id,
        type: "response",
        success: false,
        error: dispatchError.toErrorPayload(),
      };
      this.send(socket, response);
    }
  }

  private send(socket: WebSocket, message: HelloMessage | ResponseMessage | CommandMessage): void {
    if (socket.readyState !== 1 /* OPEN */) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }
    const delay = this.reconnectDelayMs;
    this.log(`${delay}ms 후 재접속`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ClientState): void {
    if (this.currentState === state) {
      return;
    }
    this.currentState = state;
    this.options.onStateChange?.(state);
  }

  private log(message: string): void {
    this.options.log?.(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
