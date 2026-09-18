/**
 * Photoshop Bridge 프로토콜 타입.
 *
 * 이 모듈은 MCP·Command Engine·Bridge 구현이 공통으로 사용하는 자료 구조만 정의한다.
 * Photoshop API 나 전송 방식(WebSocket 등)에 의존하지 않는다.
 */

/**
 * Command Engine 이 Bridge 로 전달하는 내부 명령.
 * MCP Tool 과 1:1 로 대응하지 않는다. (ARCHITECTURE §3.2)
 */
export interface PhotoshopCommand<TParams = unknown> {
  /** 명령 식별자. 예: `DOCUMENT_GET` */
  type: string;
  /** 대상 문서. 생략하면 활성 문서를 사용한다. */
  documentId?: number;
  /** 명령별 파라미터. */
  params: TParams;
}

/** 문서 정보. Phase 1 은 Mock Bridge 가 제공하는 최소 필드만 다룬다. */
export interface DocumentInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  bitDepth: number;
  colorMode: string;
}

/** 레이어 종류. Phase 1 Mock 이 표현할 수 있는 범위로 제한한다. */
export type LayerType = "pixel" | "adjustment" | "group" | "text" | "shape" | "smartObject";

/** 레이어 정보. Opacity / Parent 는 실제 Photoshop 연결(Phase 2)에서 추가한다. */
export interface LayerInfo {
  id: number;
  name: string;
  type: LayerType;
  visible: boolean;
}
