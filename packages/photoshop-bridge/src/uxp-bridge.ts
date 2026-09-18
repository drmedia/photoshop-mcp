import type { ZodType } from "zod";
import type { PhotoshopBridge } from "./bridge.js";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import type { DocumentInfo, LayerInfo, PhotoshopCommand } from "./protocol/types.js";
import { DocumentInfoSchema, LayerInfoListSchema } from "./protocol/types.js";
import type { BridgeTransport, SendOptions } from "./transport/transport.js";

/** Phase 2 에서 UXP Plugin 이 처리하는 Command. */
export const DOCUMENT_GET = "DOCUMENT_GET";
export const LAYER_LIST = "LAYER_LIST";

export interface UXPPhotoshopBridgeOptions {
  /** Command 요청에 적용할 기본 타임아웃(ms). 생략하면 전송의 기본값을 쓴다. */
  timeoutMs?: number;
}

/**
 * 실제 Photoshop 과 통신하는 Bridge 구현. (ARCHITECTURE §8)
 *
 * {@link MockPhotoshopBridge} 와 동일한 인터페이스를 만족하므로
 * 상위 계층(Command Engine · MCP)은 교체 사실을 알지 못한다.
 *
 * Photoshop API 를 직접 호출하지 않는다. 모든 작업은 전송 계층을 통해
 * UXP Plugin 의 Command Dispatcher 로 넘긴다.
 */
export class UXPPhotoshopBridge implements PhotoshopBridge {
  readonly #transport: BridgeTransport;
  readonly #sendOptions: SendOptions;

  constructor(transport: BridgeTransport, options: UXPPhotoshopBridgeOptions = {}) {
    this.#transport = transport;
    this.#sendOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  }

  /** 전송 계층. 연결 상태 조회나 기동/정지에 사용한다. */
  get transport(): BridgeTransport {
    return this.#transport;
  }

  isConnected(): boolean {
    return this.#transport.isConnected();
  }

  /**
   * Command 를 Plugin 으로 전달한다.
   *
   * `PhotoshopCommand` 의 `documentId` 와 `params` 를 와이어 포맷의 `payload` 로
   * 평탄화한다. (PROTOCOL.md §3.4)
   */
  async executeCommand<TResult>(command: PhotoshopCommand): Promise<TResult> {
    const params =
      typeof command.params === "object" && command.params !== null
        ? (command.params as Record<string, unknown>)
        : {};

    const payload: Record<string, unknown> = {
      ...params,
      ...(command.documentId === undefined ? {} : { documentId: command.documentId }),
    };

    return this.#transport.request<TResult>({ command: command.type, payload }, this.#sendOptions);
  }

  async getDocumentInfo(): Promise<DocumentInfo> {
    const raw = await this.executeCommand<unknown>({ type: DOCUMENT_GET, params: {} });
    return parse(DocumentInfoSchema, raw, DOCUMENT_GET);
  }

  async getLayers(): Promise<LayerInfo[]> {
    const raw = await this.executeCommand<unknown>({ type: LAYER_LIST, params: {} });
    return parse(LayerInfoListSchema, raw, LAYER_LIST);
  }
}

/**
 * Plugin 응답을 검증한다.
 *
 * Plugin 은 별도 프로세스이므로 응답 형태를 신뢰하지 않는다.
 * 스키마를 만족하지 않으면 상위 계층으로 잘못된 자료를 넘기지 않고 프로토콜 오류로 처리한다.
 */
function parse<TResult>(schema: ZodType<TResult>, raw: unknown, command: string): TResult {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 스키마를 만족하지 않습니다: ${command}`,
      { details: { command, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
}
