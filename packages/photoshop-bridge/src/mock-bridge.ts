import type { PhotoshopBridge } from "./bridge.js";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import type { DocumentInfo, LayerInfo, PhotoshopCommand } from "./protocol/types.js";

/** ROADMAP §5.5 의 기본 Mock 문서. */
export const DEFAULT_MOCK_DOCUMENT: DocumentInfo = {
  id: 1,
  name: "test.psd",
  width: 6048,
  height: 4024,
  bitDepth: 16,
  colorMode: "RGB",
};

/** ROADMAP §5.5 의 기본 Mock 레이어. */
export const DEFAULT_MOCK_LAYERS: readonly LayerInfo[] = [
  { id: 10, name: "Background", type: "pixel", visible: true },
  { id: 11, name: "Curves 1", type: "adjustment", visible: true },
  { id: 12, name: "Retouch", type: "pixel", visible: false },
];

export interface MockPhotoshopBridgeOptions {
  /** 초기 연결 상태. 기본값 `true`. */
  connected?: boolean;
  /** 활성 문서. `null` 이면 열린 문서가 없는 상태를 의미한다. */
  document?: DocumentInfo | null;
  /** 활성 문서의 레이어 목록. */
  layers?: readonly LayerInfo[];
}

/**
 * 실제 Photoshop 없이 Phase 1 을 검증하기 위한 Bridge 구현.
 *
 * 정상 응답뿐 아니라 오류 상황도 재현할 수 있도록
 * 연결 상태 · 문서 유무 · 1회성 실패 주입을 제어할 수 있다.
 */
export class MockPhotoshopBridge implements PhotoshopBridge {
  #connected: boolean;
  #document: DocumentInfo | null;
  #layers: LayerInfo[];
  #pendingFailure: PhotoshopMcpError | null = null;

  /** 이 Bridge 가 처리한 Command 기록. 테스트에서 호출 경로를 검증할 때 사용한다. */
  readonly executedCommands: PhotoshopCommand[] = [];

  constructor(options: MockPhotoshopBridgeOptions = {}) {
    this.#connected = options.connected ?? true;
    this.#document =
      options.document === undefined ? { ...DEFAULT_MOCK_DOCUMENT } : options.document;
    this.#layers = [...(options.layers ?? DEFAULT_MOCK_LAYERS)];
  }

  isConnected(): boolean {
    return this.#connected;
  }

  /** 연결 상태를 바꾼다. 연결 끊김 오류를 재현할 때 사용한다. */
  setConnected(connected: boolean): void {
    this.#connected = connected;
  }

  /** 활성 문서를 바꾼다. `null` 을 주면 문서 없음 오류를 재현한다. */
  setDocument(document: DocumentInfo | null): void {
    this.#document = document;
  }

  /** 레이어 목록을 바꾼다. */
  setLayers(layers: readonly LayerInfo[]): void {
    this.#layers = [...layers];
  }

  /** 다음 호출 1회를 지정한 오류로 실패시킨다. Bridge 오류 전파 경로를 검증할 때 사용한다. */
  failNextWith(error: PhotoshopMcpError): void {
    this.#pendingFailure = error;
  }

  async executeCommand<TResult>(command: PhotoshopCommand): Promise<TResult> {
    this.executedCommands.push(command);
    this.#guard();

    switch (command.type) {
      case "PING":
        return { connected: this.#connected } as TResult;
      case "DOCUMENT_GET":
        return (await this.getDocumentInfo()) as TResult;
      case "LAYER_LIST":
        return (await this.getLayers()) as TResult;
      default:
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_NOT_SUPPORTED,
          `Mock Bridge 가 지원하지 않는 Command 입니다: ${command.type}`,
          { details: { command: command.type } },
        );
    }
  }

  async getDocumentInfo(): Promise<DocumentInfo> {
    this.#guard();
    return { ...this.#requireDocument() };
  }

  async getLayers(): Promise<LayerInfo[]> {
    this.#guard();
    this.#requireDocument();
    return this.#layers.map((layer) => ({ ...layer }));
  }

  /** 주입된 1회성 실패와 연결 상태를 확인한다. */
  #guard(): void {
    if (this.#pendingFailure !== null) {
      const failure = this.#pendingFailure;
      this.#pendingFailure = null;
      throw failure;
    }
    if (!this.#connected) {
      throw new PhotoshopMcpError(
        ErrorCode.PHOTOSHOP_NOT_CONNECTED,
        "Photoshop 에 연결되어 있지 않습니다.",
        { recoverable: true },
      );
    }
  }

  #requireDocument(): DocumentInfo {
    if (this.#document === null) {
      throw new PhotoshopMcpError(ErrorCode.DOCUMENT_NOT_FOUND, "열려 있는 문서가 없습니다.", {
        recoverable: true,
      });
    }
    return this.#document;
  }
}
