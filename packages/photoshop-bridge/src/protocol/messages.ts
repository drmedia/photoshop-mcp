import { z } from "zod";

/**
 * Bridge 메시지 규약. (PROTOCOL.md §3)
 *
 * 이 모듈은 와이어 포맷만 정의한다. 전송 방식(WebSocket 등)을 알지 못한다.
 */

/** 현재 프로토콜 버전. 호환되지 않는 변경 시 올린다. (PROTOCOL.md §3.3) */
export const PROTOCOL_VERSION = 1;

/** 최대 프레임 크기. 초과 시 연결을 닫는다. (PROTOCOL.md §2) */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** Command 기본 타임아웃(ms). (PROTOCOL.md §6) */
export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Plugin → Server
// ---------------------------------------------------------------------------

export const HelloMessageSchema = z.object({
  id: z.string().min(1),
  type: z.literal("hello"),
  payload: z.object({
    protocolVersion: z.number().int(),
    plugin: z.object({ name: z.string(), version: z.string() }),
    host: z.object({ app: z.string(), version: z.string() }).optional(),
    commands: z.array(z.string()),
  }),
});

export type HelloMessage = z.infer<typeof HelloMessageSchema>;

const BridgeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
  recoverable: z.boolean().optional(),
});

export const ResponseMessageSchema = z.union([
  z.object({
    id: z.string().min(1),
    type: z.literal("response").optional(),
    success: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("response").optional(),
    success: z.literal(false),
    error: BridgeErrorSchema,
  }),
]);

export type ResponseMessage = z.infer<typeof ResponseMessageSchema>;

/** Phase 11 예약. 현재는 수신 시 무시한다. (PROTOCOL.md §3) */
export const EventMessageSchema = z.object({
  type: z.literal("event"),
  event: z.string().min(1),
  payload: z.unknown().optional(),
});

export type EventMessage = z.infer<typeof EventMessageSchema>;

/** Plugin 이 보낼 수 있는 모든 메시지. */
export const InboundMessageSchema = z.union([
  HelloMessageSchema,
  EventMessageSchema,
  ResponseMessageSchema,
]);

export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// ---------------------------------------------------------------------------
// Server → Plugin
// ---------------------------------------------------------------------------

export interface CommandMessage {
  id: string;
  type: "command";
  command: string;
  payload: Record<string, unknown>;
}

export interface WelcomeResult {
  protocolVersion: number;
  server: { name: string; version: string };
}

/** `hello` 에 대한 성공 응답. */
export interface WelcomeMessage {
  id: string;
  type: "response";
  success: true;
  result: WelcomeResult;
}

/** 요청 실패 응답. */
export interface ErrorResponseMessage {
  id: string;
  type: "response";
  success: false;
  error: { code: string; message: string; details?: unknown; recoverable?: boolean };
}

export type OutboundMessage = CommandMessage | WelcomeMessage | ErrorResponseMessage;

// ---------------------------------------------------------------------------

/** 연결 상태. (PROTOCOL.md §7) */
export type ConnectionState = "disconnected" | "handshaking" | "connected";
