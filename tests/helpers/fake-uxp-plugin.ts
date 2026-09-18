import type { DocumentInfo, LayerInfo } from "@photoshop-mcp/photoshop-bridge";
import { PROTOCOL_VERSION } from "@photoshop-mcp/photoshop-bridge";
import { WebSocket } from "ws";

/**
 * 테스트용 가짜 UXP Plugin.
 *
 * PROTOCOL.md 의 클라이언트 측을 구현한다. Photoshop DOM 대신 주입된 값을 돌려준다.
 * 실제 플러그인의 `BridgeClient` 와 같은 프로토콜을 말하므로, 서버 측 전 구간
 * (Tool → Command Engine → UXPPhotoshopBridge → WebSocket) 을 검증할 수 있다.
 *
 * 핸드셰이크는 3단계다: `hello` → `hello_ack` → `ready`.
 */
export interface FakePluginOptions {
  url: string;
  /** 핸드셰이크로 보고할 프로토콜 버전. 불일치 테스트에 사용한다. */
  protocolVersion?: number;
  /** 등록된 것으로 보고할 Command 목록. */
  commands?: string[];
  /**
   * `hello_ack` 를 받고도 `ready` 를 보내지 않는다.
   * Server 가 `ready` 이전에 Command 를 보내지 않는지 검증할 때 사용한다.
   */
  skipReady?: boolean;
  document?: DocumentInfo | null;
  layers?: LayerInfo[];
  /** 지정한 Command 에 응답하지 않는다. 타임아웃 테스트에 사용한다. */
  silentCommands?: string[];
  /** 지정한 Command 를 이 오류로 실패시킨다. */
  failWith?: Record<string, { code: string; message: string; recoverable?: boolean }>;
  /** 응답 대신 잘못된 형태를 보낸다. 스키마 검증 테스트에 사용한다. */
  malformedResults?: Record<string, unknown>;
}

export const FAKE_DOCUMENT: DocumentInfo = {
  id: 42,
  name: "phase2.psd",
  width: 8192,
  height: 5464,
  bitDepth: 16,
  colorMode: "RGB",
};

export const FAKE_LAYERS: LayerInfo[] = [
  { id: 100, name: "Sky", type: "pixel", visible: true },
  { id: 101, name: "Curves 1", type: "adjustment", visible: true },
  { id: 102, name: "Foreground", type: "group", visible: false },
];

/** 핸드셰이크 진행 결과. */
export interface HandshakeOutcome {
  /** `hello_ack` 의 `accepted` 값. */
  accepted: boolean;
  /** 거부된 경우의 오류 코드. */
  code?: string;
  /** `ready` 를 실제로 보냈는지. */
  readySent: boolean;
}

export class FakeUxpPlugin {
  readonly #options: FakePluginOptions;
  #socket: WebSocket | null = null;

  /** 수신한 Command 기록. 라우팅 검증에 사용한다. */
  readonly received: { command: string; payload: Record<string, unknown> }[] = [];

  /** 핸드셰이크 결과. `connect()` 가 끝나면 채워진다. */
  handshake: HandshakeOutcome | null = null;

  constructor(options: FakePluginOptions) {
    this.#options = options;
  }

  /** 접속하고 핸드셰이크(`hello` → `hello_ack` → `ready`)가 끝날 때까지 기다린다. */
  async connect(): Promise<void> {
    const socket = new WebSocket(this.#options.url);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        resolve();
      });
      socket.once("error", reject);
    });

    const acked = new Promise<void>((resolve) => {
      const onMessage = (data: unknown): void => {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (message["type"] !== "hello_ack") {
          return;
        }
        socket.off("message", onMessage);

        const payload = (message["payload"] ?? {}) as Record<string, unknown>;
        if (payload["accepted"] === true) {
          const readySent = this.#options.skipReady !== true;
          if (readySent) {
            socket.send(JSON.stringify({ type: "ready" }));
          }
          this.handshake = { accepted: true, readySent };
        } else {
          const error = payload["error"] as { code?: string } | undefined;
          this.handshake = {
            accepted: false,
            readySent: false,
            ...(error?.code === undefined ? {} : { code: error.code }),
          };
        }
        resolve();
      };
      socket.on("message", onMessage);
    });

    socket.send(
      JSON.stringify({
        type: "hello",
        payload: {
          protocolVersion: this.#options.protocolVersion ?? PROTOCOL_VERSION,
          plugin: { name: "fake-uxp", version: "0.0.0" },
          host: { app: "PS", version: "26.0.0" },
          commands: this.#options.commands ?? ["DOCUMENT_GET", "LAYER_LIST"],
        },
      }),
    );

    await acked;
    socket.on("message", (data) => {
      this.#handleCommand(socket, String(data));
    });
  }

  /** `skipReady` 로 보류했던 `ready` 를 뒤늦게 보낸다. */
  sendReady(): void {
    this.#socket?.send(JSON.stringify({ type: "ready" }));
    if (this.handshake !== null) {
      this.handshake = { ...this.handshake, readySent: true };
    }
  }

  /**
   * 연결을 끊는다. 서버의 끊김 처리를 검증할 때 사용한다.
   *
   * 서버가 먼저 닫은 경우(프로토콜 오류 등) `close` 이벤트가 다시 오지 않으므로
   * 이미 닫힌 소켓은 기다리지 않고 바로 반환한다.
   */
  async disconnect(code = 1000): Promise<void> {
    const socket = this.#socket;
    if (socket === null) {
      return;
    }
    this.#socket = null;

    if (socket.readyState === WebSocket.CLOSED) {
      return;
    }

    await new Promise<void>((resolve) => {
      socket.once("close", () => {
        resolve();
      });
      socket.close(code, "test disconnect");
    });
  }

  /** 프로토콜을 위반하는 프레임을 보낸다. */
  sendRaw(raw: string): void {
    this.#socket?.send(raw);
  }

  #handleCommand(socket: WebSocket, raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message["type"] !== "command") {
      return;
    }

    const id = String(message["id"]);
    const command = String(message["command"]);
    const payload = (message["payload"] ?? {}) as Record<string, unknown>;
    this.received.push({ command, payload });

    if (this.#options.silentCommands?.includes(command) === true) {
      return;
    }

    const failure = this.#options.failWith?.[command];
    if (failure !== undefined) {
      this.#sendError(socket, id, failure);
      return;
    }

    if (this.#options.malformedResults !== undefined && command in this.#options.malformedResults) {
      this.#sendResult(socket, id, this.#options.malformedResults[command]);
      return;
    }

    const document = this.#options.document === undefined ? FAKE_DOCUMENT : this.#options.document;

    // 실제 Plugin 과 같은 순서로 검사한다: 활성 문서가 없으면 DOCUMENT_NOT_FOUND.
    if ((command === "DOCUMENT_GET" || command === "LAYER_LIST") && document === null) {
      this.#sendError(socket, id, {
        code: "DOCUMENT_NOT_FOUND",
        message: "열려 있는 문서가 없습니다.",
        recoverable: true,
      });
      return;
    }

    switch (command) {
      case "DOCUMENT_GET":
        this.#sendResult(socket, id, document);
        return;
      case "LAYER_LIST":
        this.#sendResult(socket, id, this.#options.layers ?? FAKE_LAYERS);
        return;
      default:
        this.#sendError(socket, id, {
          code: "COMMAND_NOT_SUPPORTED",
          message: `Plugin 이 지원하지 않는 Command: ${command}`,
        });
        return;
    }
  }

  #sendResult(socket: WebSocket, id: string, result: unknown): void {
    socket.send(JSON.stringify({ type: "response", id, success: true, result }));
  }

  #sendError(
    socket: WebSocket,
    id: string,
    error: { code: string; message: string; recoverable?: boolean },
  ): void {
    socket.send(JSON.stringify({ type: "response", id, success: false, error }));
  }
}
