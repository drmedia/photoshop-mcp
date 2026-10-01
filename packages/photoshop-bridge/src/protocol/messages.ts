import { z } from "zod";

/**
 * Bridge 메시지 규약. (PROTOCOL.md §3)
 *
 * 이 모듈은 와이어 포맷만 정의한다. 전송 방식(WebSocket 등)을 알지 못한다.
 *
 * 메시지는 두 갈래다.
 *
 * - **Connection lifecycle**: `hello` · `hello_ack` · `ready`.
 *   요청/응답이 아니므로 `id` 를 갖지 않는다.
 * - **Request/response**: `command` · `response`. `id` 로 짝을 맞춘다.
 */

/** 현재 프로토콜 버전. 호환되지 않는 변경 시 올린다. (PROTOCOL.md §3.3) */
export const PROTOCOL_VERSION = 1;

/** 최대 프레임 크기. 초과 시 연결을 닫는다. (PROTOCOL.md §2) */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** Command 기본 타임아웃(ms). (PROTOCOL.md §6) */
export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Connection lifecycle — Plugin → Server
// ---------------------------------------------------------------------------

/** 1단계. Plugin 이 접속 직후 자신을 알린다. */
export const HelloMessageSchema = z.object({
  type: z.literal("hello"),
  payload: z.object({
    protocolVersion: z.number().int(),
    plugin: z.object({ name: z.string(), version: z.string() }),
    host: z.object({ app: z.string(), version: z.string() }).optional(),
    commands: z.array(z.string()),
  }),
});

export type HelloMessage = z.infer<typeof HelloMessageSchema>;

/**
 * 3단계. Plugin 이 Command 를 처리할 준비가 되었음을 알린다.
 *
 * Server 는 이 메시지를 받은 뒤에만 연결을 `connected` 로 전이하고 Command 를 보낸다.
 * (PROTOCOL.md §3.4)
 */
export const ReadyMessageSchema = z.object({
  type: z.literal("ready"),
});

export type ReadyMessage = z.infer<typeof ReadyMessageSchema>;

// ---------------------------------------------------------------------------
// Connection lifecycle — Server → Plugin
// ---------------------------------------------------------------------------

export interface HelloAckAccepted {
  type: "hello_ack";
  payload: {
    accepted: true;
    protocolVersion: number;
    /** `pid` 는 선택이다 — 같은 기계에 서버가 여럿일 때 패널이 어느 쪽에 붙었는지 보이게 한다. */
    server: { name: string; version: string; pid?: number };
  };
}

export interface HelloAckRejected {
  type: "hello_ack";
  payload: {
    accepted: false;
    protocolVersion: number;
    error: { code: string; message: string };
  };
}

/** 2단계. Server 가 `hello` 를 수락하거나 거부한다. */
export type HelloAckMessage = HelloAckAccepted | HelloAckRejected;

// ---------------------------------------------------------------------------
// Request / response
// ---------------------------------------------------------------------------

const BridgeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
  recoverable: z.boolean().optional(),
});

/** Server → Plugin. Command 실행 요청. */
export interface CommandMessage {
  id: string;
  type: "command";
  command: string;
  payload: Record<string, unknown>;
}

/** Plugin → Server. `command` 에 대한 응답. */
export const ResponseMessageSchema = z.union([
  z.object({
    type: z.literal("response"),
    id: z.string().min(1),
    success: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal("response"),
    id: z.string().min(1),
    success: z.literal(false),
    error: BridgeErrorSchema,
  }),
]);

export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;

// ---------------------------------------------------------------------------

/** Phase 11 예약. 현재는 수신 시 무시한다. (PROTOCOL.md §3) */
export const EventMessageSchema = z.object({
  type: z.literal("event"),
  event: z.string().min(1),
  payload: z.unknown().optional(),
});

export type EventMessage = z.infer<typeof EventMessageSchema>;

/**
 * Plugin 이 보낼 수 있는 모든 메시지.
 *
 * `response` 가 성공/실패 두 변형을 가지므로 `discriminatedUnion` 은 쓸 수 없다
 * (`type` 판별값이 중복된다). 각 변형이 `type` 리터럴을 갖고 있어
 * TypeScript 쪽 narrowing 은 그대로 동작한다.
 */
export const InboundMessageSchema = z.union([
  HelloMessageSchema,
  ReadyMessageSchema,
  EventMessageSchema,
  ...ResponseMessageSchema.options,
]);

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

/** Server 가 보낼 수 있는 모든 메시지. */
export type OutboundMessage = CommandMessage | HelloAckMessage;

// ---------------------------------------------------------------------------

/**
 * 연결 상태. (PROTOCOL.md §7)
 *
 * - `handshaking` — 소켓은 열렸고 `hello` 를 기다린다
 * - `awaiting_ready` — `hello_ack` 를 보냈고 `ready` 를 기다린다
 * - `connected` — `ready` 를 받았다. 이 상태에서만 Command 를 보낸다
 */
export type ConnectionState = "disconnected" | "handshaking" | "awaiting_ready" | "connected";
