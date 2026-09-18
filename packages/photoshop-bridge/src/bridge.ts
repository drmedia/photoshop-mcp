import type { DocumentInfo, LayerInfo, PhotoshopCommand } from "./protocol/types.js";

/**
 * Photoshop 접근 추상화. (ARCHITECTURE §8)
 *
 * MCP Server 와 Command Engine 은 Photoshop UXP API 를 직접 호출하지 않고
 * 반드시 이 인터페이스를 통해서만 Photoshop 에 접근한다.
 *
 * Phase 1 은 {@link MockPhotoshopBridge} 를, Phase 2 이후에는 동일 인터페이스를
 * 유지한 채 UXP 구현으로 교체한다.
 */
export interface PhotoshopBridge {
  /** Photoshop 과 연결되어 있는지 여부. */
  isConnected(): boolean;

  /** 임의의 Command 를 Photoshop 쪽으로 전달하고 결과를 받는다. */
  executeCommand<TResult>(command: PhotoshopCommand): Promise<TResult>;

  /** 활성 문서 정보를 조회한다. */
  getDocumentInfo(): Promise<DocumentInfo>;

  /** 활성 문서의 레이어 목록을 조회한다. */
  getLayers(): Promise<LayerInfo[]>;
}
