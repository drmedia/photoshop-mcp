import type { CommandMessage, ConnectionState } from "../protocol/messages.js";

export interface SendOptions {
  /** 이 요청에만 적용할 타임아웃(ms). */
  timeoutMs?: number;
}

/**
 * Bridge 전송 계층 추상화. (PROTOCOL.md §9)
 *
 * Photoshop 기능을 알지 못한다. 프레임 송수신과 연결 상태만 다룬다.
 * Command 의 의미 해석은 Plugin 의 Dispatcher 책임이다.
 */
export interface BridgeTransport {
  /** 수신 대기를 시작한다. Photoshop 이 없어도 성공한다. */
  start(): Promise<void>;

  /** 대기 중인 요청을 실패시키고 전송을 정지한다. */
  stop(): Promise<void>;

  /** 핸드셰이크까지 완료된 연결이 있는지. */
  isConnected(): boolean;

  state(): ConnectionState;

  /**
   * Command 를 보내고 응답을 기다린다.
   *
   * @throws {PhotoshopMcpError}
   *   - `PHOTOSHOP_NOT_CONNECTED` — 연결 없음 또는 대기 중 끊김
   *   - `COMMAND_TIMEOUT` — 타임아웃 내 응답 없음
   *   - Plugin 이 보고한 오류 코드 그대로
   */
  request<TResult>(
    message: Omit<CommandMessage, "id" | "type">,
    options?: SendOptions,
  ): Promise<TResult>;
}
