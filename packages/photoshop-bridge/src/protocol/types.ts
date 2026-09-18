import { z } from "zod";

/**
 * Photoshop Bridge 프로토콜 타입.
 *
 * 이 모듈은 MCP·Command Engine·Bridge 구현이 공통으로 사용하는 자료 구조만 정의한다.
 * Photoshop API 나 전송 방식(WebSocket 등)에 의존하지 않는다.
 *
 * Plugin 은 별도 프로세스이므로 응답 형태를 신뢰할 수 없다.
 * 그래서 자료 구조를 zod 스키마로 정의하고 타입을 거기서 파생시킨다.
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

/**
 * 문서 정보. (PROTOCOL.md §4)
 *
 * `bitDepth` 가 `null` 이면 Plugin 이 Photoshop 의 값을 해석하지 못한 것이며,
 * 그때 `rawBitDepth` 에 원본이 담긴다. 임의의 기본값으로 채우지 않는다 —
 * 8비트로 단정하면 16/32비트 문서를 8비트로 오인하게 만든다.
 */
export const DocumentInfoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
  bitDepth: z.number().int().nullable(),
  rawBitDepth: z.string().optional(),
  colorMode: z.string(),
});

export type DocumentInfo = z.infer<typeof DocumentInfoSchema>;

/** 레이어 종류. (PROTOCOL.md §4) */
export const LayerTypeSchema = z.enum([
  "pixel",
  "adjustment",
  "group",
  "text",
  "shape",
  "smartObject",
]);

export type LayerType = z.infer<typeof LayerTypeSchema>;

/** 레이어 정보. Opacity 와 Parent 는 Phase 3 에서 추가한다. */
export const LayerInfoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: LayerTypeSchema,
  visible: z.boolean(),
});

export type LayerInfo = z.infer<typeof LayerInfoSchema>;

export const LayerInfoListSchema = z.array(LayerInfoSchema);
