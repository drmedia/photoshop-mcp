import type { HelloMessage, ReadyMessage, ResponseMessage } from "@photoshop-mcp/photoshop-bridge";
import { CommandDispatcher, DispatchError, type CommandPayload } from "../dispatcher/dispatcher.js";

/** PROTOCOL.md §3.3 */
export const PROTOCOL_VERSION = 1;

/** PROTOCOL.md §7 — 지수 백오프 */
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * 연결 수명 상태. PROTOCOL.md §7 의 상태 기계를 Plugin 쪽에서 본 것.
 *
 * - `handshaking` — `hello` 를 보내고 `hello_ack` 를 기다린다
 * - `connected` — `hello_ack` 를 받고 `ready` 를 보냈다
 */
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
 * 핸드셰이크는 3단계다. (PROTOCOL.md §3.2~3.4)
 *
 * ```text
 * Plugin → hello
 * Server → hello_ack
 * Plugin → ready       ← 이 시점부터 Server 가 Command 를 보낸다
 * ```
 *
 * `ready` 는 Dispatcher 가 Command 를 처리할 수 있음을 뜻한다.
 * 그러므로 Dispatcher 구성이 끝난 뒤에만 보낸다.
 *
 * Server 가 아니라 Plugin 이 접속하며, 재접속 책임도 Plugin 쪽에 있다. (PROTOCOL.md §7)
 */
export class BridgeClient {
  private readonly options: BridgeClientOptions;
  private socket: WebSocket | null = null;
  private currentState: ClientState = "disconnected";
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

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

  /** 1단계. */
  private sendHello(socket: WebSocket): void {
    const hello: HelloMessage = {
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

  /** 3단계. Dispatcher 가 준비되었음을 알린다. */
  private sendReady(socket: WebSocket): void {
    const ready: ReadyMessage = { type: "ready" };
    this.send(socket, ready);
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

    switch (message["type"]) {
      case "hello_ack":
        this.handleHelloAck(socket, message);
        return;
      case "command":
        await this.handleCommand(socket, message);
        return;
      default:
        return;
    }
  }

  /** 2단계 수신 → 3단계 발신. */
  private handleHelloAck(socket: WebSocket, message: Record<string, unknown>): void {
    const payload = isRecord(message["payload"]) ? message["payload"] : {};

    if (payload["accepted"] !== true) {
      const error = isRecord(payload["error"]) ? payload["error"] : {};
      this.log(`핸드셰이크 거부: ${String(error["code"])} ${String(error["message"])}`);
      // 서버가 연결을 닫는다. onclose 에서 백오프 재접속으로 이어진다.
      return;
    }

    // Dispatcher 는 생성 시점에 이미 구성되어 있으므로 바로 ready 를 보낸다.
    this.sendReady(socket);

    // 핸드셰이크 성공 시 백오프를 초기화한다.
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    this.setState("connected");
    this.log("핸드셰이크 완료 (hello → hello_ack → ready)");
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
      const response: ResponseMessage = { type: "response", id, success: true, result };
      this.send(socket, response);
    } catch (error) {
      const dispatchError =
        error instanceof DispatchError
          ? error
          : new DispatchError("COMMAND_FAILED", describe(error), { details: { command } });
      const response: ResponseMessage = {
        type: "response",
        id,
        success: false,
        error: dispatchError.toErrorPayload(),
      };
      this.send(socket, response);
    }
  }

  private send(socket: WebSocket, message: HelloMessage | ReadyMessage | ResponseMessage): void {
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
