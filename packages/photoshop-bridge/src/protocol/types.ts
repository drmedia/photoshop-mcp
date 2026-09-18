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

/**
 * 레이어 종류. (PROTOCOL.md §4)
 *
 * `unknown` 은 Plugin 이 Photoshop 의 `LayerKind` 를 분류하지 못한 경우다.
 * 임의로 `pixel` 로 단정하지 않는다 — 새로 생긴 조정 레이어 종류를 픽셀 레이어로
 * 오인하면 호출자가 잘못된 대상에 작업하게 된다. (PROTOCOL.md §4)
 */
export const LayerTypeSchema = z.enum([
  "pixel",
  "adjustment",
  "group",
  "text",
  "shape",
  "smartObject",
  "unknown",
]);

export type LayerType = z.infer<typeof LayerTypeSchema>;

/**
 * 혼합 모드.
 *
 * `passThrough` 는 그룹 레이어의 기본값이며 그룹에만 쓸 수 있다.
 * 실기에서 그룹이 이 값을 돌려주는 것을 확인했다.
 */
export const BlendModeSchema = z.enum([
  "passThrough",
  "normal",
  "dissolve",
  "darken",
  "multiply",
  "colorBurn",
  "linearBurn",
  "lighten",
  "screen",
  "colorDodge",
  "linearDodge",
  "overlay",
  "softLight",
  "hardLight",
  "vividLight",
  "linearLight",
  "pinLight",
  "hardMix",
  "difference",
  "exclusion",
  "subtract",
  "divide",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

export type BlendMode = z.infer<typeof BlendModeSchema>;

/** 레이어 정보. */
export const LayerInfoSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: LayerTypeSchema,
  visible: z.boolean(),
  /** 0–100. */
  opacity: z.number(),
  /** 소속 그룹의 레이어 ID. 최상위면 `null`. */
  parentId: z.number().int().nullable(),
  /** 혼합 모드. 매핑하지 못한 값은 `rawBlendMode` 에 원본이 담긴다. */
  blendMode: BlendModeSchema.nullable(),
  /** `blendMode` 가 `null` 일 때만 포함. */
  rawBlendMode: z.string().optional(),
  /** `type` 이 `unknown` 일 때만 포함. Photoshop 의 원본 `LayerKind`. */
  rawKind: z.string().optional(),
  /**
   * 배경 레이어인지.
   *
   * 배경 레이어는 편집을 다르게 받는다 — `set_opacity` 는 **일반 레이어로 승격**시켜
   * id 와 이름을 바꾸고, `rename` 과 `set_blend_mode` 는 거부한다. 이것을 모르면
   * 호출자가 피할 방법이 없다.
   *
   * **Photoshop 이 알려줄 때만 담는다.** 값을 얻지 못하면 필드가 아예 없다.
   * 없는 것을 `false` 로 덮으면 "배경이 아니다" 라는 틀린 사실을 말하게 된다.
   */
  isBackground: z.boolean().optional(),
  /**
   * 레이어 마스크가 있는지.
   *
   * 마스크를 만들었는지 호출자가 확인할 방법이 없었다. "하늘만 어둡게" 같은 작업은
   * 마스크가 붙어야 완성인데 결과를 볼 수 없으면 스스로 검증할 수 없다.
   * `mask.enable` 을 마스크 없는 레이어에 불러 막히는 일도 미리 피할 수 없었다.
   *
   * **Photoshop 이 알려줄 때만 담는다.** UXP DOM 에 없어서 batchPlay 로 읽으며,
   * 읽지 못하면 필드가 아예 없다. (`isBackground` 와 같은 원칙)
   */
  hasMask: z.boolean().optional(),
  /** 마스크가 켜져 있는지. `hasMask` 가 `true` 일 때만 의미가 있다. */
  maskEnabled: z.boolean().optional(),
});

export type LayerInfo = z.infer<typeof LayerInfoSchema>;

export const LayerInfoListSchema = z.array(LayerInfoSchema);
