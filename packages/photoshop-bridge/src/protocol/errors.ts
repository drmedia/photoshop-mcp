/**
 * 공통 오류 모델. (ARCHITECTURE §32)
 *
 * 모든 계층은 실패를 {@link PhotoshopMcpError} 로 정규화해서 전달한다.
 */

/** 표준 오류 코드. */
export const ErrorCode = {
  /** Photoshop 연결이 없음. */
  PHOTOSHOP_NOT_CONNECTED: "PHOTOSHOP_NOT_CONNECTED",
  /** 활성 문서 없음 또는 지정한 문서를 찾을 수 없음. */
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  /** 지정한 레이어를 찾을 수 없음. */
  LAYER_NOT_FOUND: "LAYER_NOT_FOUND",
  /** 입력 값이 스키마를 만족하지 않음. */
  INVALID_PARAMETER: "INVALID_PARAMETER",
  /** 등록되지 않은 Command. */
  COMMAND_NOT_SUPPORTED: "COMMAND_NOT_SUPPORTED",
  /** Command 실행 중 분류되지 않은 실패. */
  COMMAND_FAILED: "COMMAND_FAILED",
  /** 같은 이름의 Tool 이 이미 등록됨. */
  DUPLICATE_TOOL: "DUPLICATE_TOOL",
  /** 같은 타입의 Command 가 이미 등록됨. */
  DUPLICATE_COMMAND: "DUPLICATE_COMMAND",
  /** 등록되지 않은 Tool. */
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  /** 타임아웃 내에 Plugin 응답이 없음. */
  COMMAND_TIMEOUT: "COMMAND_TIMEOUT",
  /** Plugin 과 Server 의 프로토콜 버전이 다름. */
  PROTOCOL_VERSION_MISMATCH: "PROTOCOL_VERSION_MISMATCH",
  /** 프레임 파싱 실패 또는 메시지 스키마 위반. */
  PROTOCOL_ERROR: "PROTOCOL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface PhotoshopMcpErrorOptions {
  /** 진단에 도움이 되는 부가 정보. */
  details?: unknown;
  /** 호출자가 재시도하거나 우회할 수 있는 오류인지. */
  recoverable?: boolean;
  /** 원인 오류. */
  cause?: unknown;
}

/** 직렬화된 오류 형태. Bridge 응답과 MCP 오류 본문에 사용한다. */
export interface SerializedPhotoshopMcpError {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
}

export class PhotoshopMcpError extends Error {
  override readonly name = "PhotoshopMcpError";
  readonly code: string;
  readonly details: unknown;
  readonly recoverable: boolean;

  constructor(code: string, message: string, options: PhotoshopMcpErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.details = options.details;
    this.recoverable = options.recoverable ?? false;
  }

  toJSON(): SerializedPhotoshopMcpError {
    const serialized: SerializedPhotoshopMcpError = {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
    };
    if (this.details !== undefined) {
      serialized.details = this.details;
    }
    return serialized;
  }

  /** 임의의 예외를 {@link PhotoshopMcpError} 로 정규화한다. 이미 해당 타입이면 그대로 반환한다. */
  static from(error: unknown, fallbackCode: string = ErrorCode.COMMAND_FAILED): PhotoshopMcpError {
    if (error instanceof PhotoshopMcpError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new PhotoshopMcpError(fallbackCode, message, { cause: error });
  }
}

/** 값이 {@link PhotoshopMcpError} 인지 확인한다. */
export function isPhotoshopMcpError(value: unknown): value is PhotoshopMcpError {
  return value instanceof PhotoshopMcpError;
}
