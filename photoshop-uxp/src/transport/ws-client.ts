import type { HelloMessage, ReadyMessage, ResponseMessage } from "@photoshop-mcp/photoshop-bridge";
import { CommandDispatcher, DispatchError, type CommandPayload } from "../dispatcher/dispatcher.js";

/** PROTOCOL.md §3.3 */
export const PROTOCOL_VERSION = 1;

/** PROTOCOL.md §7 — 지수 백오프 */
const RECONNECT_INITIAL_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * 후보 하나에 쓰는 시간. 소켓을 만든 때부터 핸드셰이크가 끝날 때까지다. (ROADMAP §93)
 *
 * **핸드셰이크에도 걸어야 한다.** 포트를 다른 프로그램의 WebSocket 서버가 쓰고 있으면 연결은
 * 열리는데 `hello_ack` 가 오지 않는다 — 기한이 없으면 그 후보에서 영원히 멈추고 뒤의 후보를 못 본다.
 * 루프백이라 정상 서버는 수 ms 안에 답한다.
 */
const ATTEMPT_TIMEOUT_MS = 3_000;

/**
 * 연결 수명 상태. PROTOCOL.md §7 의 상태 기계를 Plugin 쪽에서 본 것.
 *
 * - `connecting` — 소켓을 만들고 open 을 기다린다
 * - `handshaking` — `hello` 를 보내고 `hello_ack` 를 기다린다
 * - `connected` — `hello_ack` 를 받고 `ready` 를 보냈다
 * - `retrying` — 접속에 실패해 백오프 대기 중이다
 *
 * `retrying` 을 따로 둔 이유: 이 상태를 `connecting` 으로 두면 매번 즉시 실패하는
 * 상황에서도 UI 가 "접속 중" 으로 보여 진단을 방해한다.
 */
export type ClientState = "disconnected" | "connecting" | "handshaking" | "connected" | "retrying";

export interface BridgeClientOptions {
  /**
   * 접속 후보. 앞에서부터 시도하고, 모두 실패하면 백오프 뒤에 처음부터 다시 훑는다. (ROADMAP §93)
   *
   * 한 번이라도 붙은 후보는 다음 훑기에서 맨 앞에 선다 — 서버가 재시작해도 같은 포트면 바로 붙는다.
   */
  urls: readonly string[];
  /** 핸드셰이크까지 끝낸 후보. 다음 실행에서 맨 앞에 두려고 저장하는 데 쓴다. */
  onConnected?: (url: string) => void;
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
  private lastErrorMessage: string | null = null;
  private nextRetryMs = 0;
  /** 이번 훑기에서 아직 시도하지 않은 후보. */
  private queue: string[] = [];
  /** 지금 시도하는(또는 붙은) 후보. */
  private currentUrl: string;
  /** 마지막으로 핸드셰이크까지 끝낸 후보. 다음 훑기의 맨 앞이다. */
  private preferredUrl: string | null = null;
  /** 소켓 생성 자체가 실패했는가 — 권한 거부는 포트를 바꿔도 같아서 사유를 따로 둔다. */
  private constructorFailed = false;
  private attemptTimer: ReturnType<typeof setTimeout> | null = null;
  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 서버가 `hello_ack` 로 알려 준 pid. 같은 기계에 서버가 여럿일 때 어느 쪽인지 가린다. */
  private serverPidValue: number | null = null;

  constructor(options: BridgeClientOptions) {
    if (options.urls.length === 0) {
      throw new Error("접속 후보가 없습니다.");
    }
    this.options = options;
    this.currentUrl = options.urls[0] as string;
  }

  get state(): ClientState {
    return this.currentState;
  }

  /** 마지막 접속 실패 사유. 패널에 노출해 UDT 콘솔 없이도 원인을 알 수 있게 한다. */
  get lastError(): string | null {
    return this.lastErrorMessage;
  }

  /** `retrying` 상태에서 다음 재시도까지 남은 대기(ms). */
  get retryDelayMs(): number {
    return this.nextRetryMs;
  }

  /** 지금 시도하는 URL. 붙었으면 붙은 URL 이다. */
  get url(): string {
    return this.currentUrl;
  }

  /** 후보 범위를 한 줄로. 예: `ws://127.0.0.1:8765–8774`. 어느 서버도 못 찾았을 때 보여 준다. */
  get urlRange(): string {
    const first = this.options.urls[0] as string;
    const last = this.options.urls[this.options.urls.length - 1] as string;
    if (first === last) {
      return first;
    }
    return `${first}–${last.slice(last.lastIndexOf(":") + 1)}`;
  }

  /** 붙은 서버의 pid. 서버가 알려 주지 않았으면 `null`. */
  get serverPid(): number | null {
    return this.serverPidValue;
  }

  /** 접속을 시작한다. 실패하면 백오프 후 재시도한다. */
  start(): void {
    this.stopped = false;
    // 껐다 다시 켠 것이면 이전의 백오프가 남아 있다. 켜는 순간에는 바로 찾아야 한다.
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    this.nextRetryMs = 0;
    this.beginSweep();
    this.connect();
  }

  /** 재접속을 중단하고 연결을 닫는다. */
  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.clearAttemptTimer();
    if (this.advanceTimer !== null) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "plugin stopping");
    // 끈 상태에서 옛 접속 실패 문구가 패널에 남으면 지금도 찾고 있는 것처럼 읽힌다.
    this.queue = [];
    this.lastErrorMessage = null;
    this.constructorFailed = false;
    this.serverPidValue = null;
    this.setState("disconnected");
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.clearReconnectTimer();
    if (this.queue.length === 0) {
      this.beginSweep();
    }
    this.currentUrl = this.queue.shift() as string;
    this.setState("connecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.currentUrl);
    } catch (error) {
      // UXP 가 network 권한을 거부하면 생성자에서 던진다.
      // 조용히 재시도하면 원인을 알 수 없으므로 사유를 남긴다.
      this.lastErrorMessage = describe(error);
      this.constructorFailed = true;
      this.log(`WebSocket 생성 실패 (${this.currentUrl}): ${this.lastErrorMessage}`);
      this.advance();
      return;
    }
    this.socket = socket;

    // 이 후보에 쓸 수 있는 시간. 핸드셰이크가 끝나면 `handleHelloAck` 가 푼다.
    this.clearAttemptTimer();
    this.attemptTimer = setTimeout(() => {
      this.attemptTimer = null;
      this.log(`${this.currentUrl} 응답 없음`);
      this.failCurrent(socket);
    }, ATTEMPT_TIMEOUT_MS);

    listen(socket, "open", () => {
      this.setState("handshaking");
      this.sendHello(socket);
    });

    listen(socket, "message", (event) => {
      void this.handleFrame(socket, String((event as MessageEvent).data));
    });

    listen(socket, "error", () => {
      this.lastErrorMessage = `WebSocket error (${this.currentUrl})`;
      this.log(this.lastErrorMessage);
      // UXP 는 error 뒤에 close 를 보내지 않을 수 있다.
      // close 만 믿고 기다리면 connecting 상태로 영구히 멈춘다.
      this.failCurrent(socket);
    });

    listen(socket, "close", () => {
      this.failCurrent(socket);
    });
  }

  /**
   * 현재 소켓을 실패 처리하고 재접속을 예약한다.
   *
   * `error` 와 `close` 양쪽에서 호출되며, 둘 다 오더라도 한 번만 동작한다.
   */
  private failCurrent(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }
    this.socket = null;
    this.serverPidValue = null;
    this.clearAttemptTimer();
    try {
      socket.close();
    } catch {
      // 이미 닫혔거나 닫을 수 없는 상태면 무시한다.
    }
    this.setState("disconnected");
    this.advance();
  }

  /** 이번 훑기의 후보 순서를 만든다. 마지막으로 붙은 후보가 맨 앞이다. */
  private beginSweep(): void {
    const urls = [...this.options.urls];
    const preferred = this.preferredUrl;
    this.queue =
      preferred !== null && urls.includes(preferred)
        ? [preferred, ...urls.filter((url) => url !== preferred)]
        : urls;
    this.constructorFailed = false;
  }

  /**
   * 한 후보가 실패한 뒤의 다음 걸음. (ROADMAP §93)
   *
   * 남은 후보가 있으면 **기다리지 않고** 다음으로 간다 — 루프백에서 닫힌 포트는 즉시 거절되므로
   * 한 바퀴가 빠르다. 모두 실패했을 때만 백오프를 쓴다. 후보마다 백오프를 걸면 서버가 끝 포트에 있을 때
   * 한 바퀴에 수십 초가 든다.
   */
  private advance(): void {
    if (this.stopped) {
      return;
    }
    if (this.queue.length > 0) {
      // 같은 호출 스택에서 이어 가면 연달아 실패할 때 재귀가 깊어진다.
      this.advanceTimer = setTimeout(() => {
        this.advanceTimer = null;
        this.connect();
      }, 0);
      return;
    }
    // 한 바퀴를 다 돌았다. 소켓 생성 실패(권한)는 사유를 그대로 두고, 아니면 범위를 말한다.
    if (!this.constructorFailed) {
      this.lastErrorMessage = `No server found (${this.urlRange})`;
    }
    this.scheduleReconnect();
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

    // 우리 서버다. 이 후보를 기억하고 남은 후보는 버린다.
    this.clearAttemptTimer();
    this.preferredUrl = this.currentUrl;
    this.queue = [];
    this.lastErrorMessage = null;
    const server = isRecord(payload["server"]) ? payload["server"] : {};
    this.serverPidValue = typeof server["pid"] === "number" ? server["pid"] : null;

    // 핸드셰이크 성공 시 백오프를 초기화한다.
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    this.setState("connected");
    this.log(`핸드셰이크 완료 (hello → hello_ack → ready) ${this.currentUrl}`);
    this.options.onConnected?.(this.currentUrl);
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

  /**
   * 이벤트를 보낸다. (PROTOCOL.md §5)
   *
   * 응답을 기다리지 않는다. 연결이 없으면 **버린다** — 이벤트는 지금 일어난 일이고
   * 나중에 연결됐을 때 밀어 넣으면 순서가 뒤엉킨다.
   */
  sendEvent(event: string, payload: unknown): void {
    const socket = this.socket;
    if (socket === null || this.state !== "connected") {
      return;
    }
    try {
      socket.send(JSON.stringify({ type: "event", event, payload }));
    } catch {
      // 전송 실패는 무시한다. 이벤트 때문에 연결을 끊지 않는다.
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
    this.nextRetryMs = delay;
    this.setState("retrying");
    this.log(`${delay}ms 후 재접속`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
  }

  private clearAttemptTimer(): void {
    if (this.attemptTimer !== null) {
      clearTimeout(this.attemptTimer);
      this.attemptTimer = null;
    }
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

/**
 * 이벤트 핸들러를 등록한다.
 *
 * UXP 에서는 `socket.onopen = ...` 프로퍼티 할당이 동작하는 것이 확인된 방식이므로
 * 그쪽을 우선한다. 프로퍼티를 받지 않는 구현을 위해 `addEventListener` 로 대체한다.
 * 둘 다 등록하면 중복 호출되므로 하나만 쓴다.
 */
function listen(socket: WebSocket, type: string, handler: (event: Event) => void): void {
  const target = socket as unknown as {
    addEventListener?: (type: string, handler: (event: Event) => void) => void;
  } & Record<string, unknown>;

  const property = `on${type}`;
  target[property] = handler;
  if (target[property] === handler) {
    return;
  }
  if (typeof target.addEventListener === "function") {
    target.addEventListener(type, handler);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
