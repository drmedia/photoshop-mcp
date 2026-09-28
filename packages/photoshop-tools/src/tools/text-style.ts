import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  TEXT_CONVERT_TO_PARAGRAPH,
  TEXT_CONVERT_TO_POINT,
  TEXT_CONVERT_TO_SHAPE,
  TEXT_GET,
  TEXT_SET_LEADING,
  TEXT_SET_PARAGRAPH,
  TEXT_SET_TRACKING,
  TEXT_WARP,
  TextSetLeadingParamsSchema,
  TextSetParagraphParamsSchema,
  TextSetTrackingParamsSchema,
  TextTargetParamsSchema,
  TextWarpParamsSchema,
  type TextDetail,
  type TextSetLeadingParams,
  type TextSetParagraphParams,
  type TextSetTrackingParams,
  type TextShapeResult,
  type TextTargetParams,
  type TextWarpParams,
} from "../commands/text-style.js";

/**
 * 텍스트 세부 Tool. (ROADMAP §60)
 *
 * `text.create` · `text.set` 이 워터마크·서명 범위였고 이것이 나머지다.
 */

/** 넷이 공유하는 문장. */
const COMMON =
  "layerId 를 생략하면 활성 레이어. **텍스트 레이어가 아니면 거절한다.** " +
  "결과는 요청값이 아니라 **건 뒤 다시 읽은 전체 상태**다 — 무엇이 실제로 " +
  "들어갔는지 여기서 확인한다. ";

/** 단위는 레퍼런스에 적혀 있다. 짐작이 아니다. */
const UNITS =
  "**단위를 헷갈리기 쉽다** — tracking 은 1/1000 em 이고, leading · 들여쓰기 · " +
  "문단 간격은 **72ppi 기준 픽셀**이다(포인트가 아니다). 300ppi 문서에서는 " +
  "Photoshop 화면에서 보는 값과 다르다. ";

function create<TParams, TResult>(
  name: string,
  description: string,
  permission: ToolDefinition<TParams, TResult>["permission"],
  schema: ToolDefinition<TParams, TResult>["inputSchema"],
  type: string,
  engine: CommandEngine,
): ToolDefinition<TParams, TResult> {
  return {
    name,
    description,
    permission,
    inputSchema: schema,
    handler: async (input, context) =>
      engine.execute<TResult>({ type, params: input }, { requestId: context.requestId }),
  };
}

/** `photoshop.text.get` */
export function createTextGetTool(
  engine: CommandEngine,
): ToolDefinition<TextTargetParams, TextDetail> {
  return create(
    "photoshop.text.get",
    "텍스트 레이어의 내용과 문자 · 단락 · 워프 설정을 전부 돌려준다. " +
      "**photoshop.text.set 이 바꾸는 것보다 훨씬 많이 읽는다** — 자간 · 행간 · " +
      "들여쓰기 · 워프까지 본다. " +
      UNITS +
      "isPointText 와 isParagraphText 가 점 텍스트인지 단락 텍스트인지 가른다. " +
      "**모르는 값은 null 이다** — Photoshop 이 알려주지 않으면 지어내지 않는다. " +
      "문서를 바꾸지 않는다.",
    "read",
    TextTargetParamsSchema,
    TEXT_GET,
    engine,
  );
}

/** `photoshop.text.set_tracking` */
export function createTextSetTrackingTool(
  engine: CommandEngine,
): ToolDefinition<TextSetTrackingParams, TextDetail> {
  return create(
    "photoshop.text.set_tracking",
    "자간을 바꾼다. tracking 은 **1/1000 em**(−1000~1000)이다 — 픽셀도 포인트도 아니다. " +
      "글자 크기에 비례하므로 크기를 바꿔도 비율이 유지된다. " +
      "워터마크처럼 넓게 벌릴 때 100~300 쯤 쓴다. " +
      COMMON,
    "edit",
    TextSetTrackingParamsSchema,
    TEXT_SET_TRACKING,
    engine,
  );
}

/** `photoshop.text.set_leading` */
export function createTextSetLeadingTool(
  engine: CommandEngine,
): ToolDefinition<TextSetLeadingParams, TextDetail> {
  return create(
    "photoshop.text.set_leading",
    "행간을 바꾼다. leading 은 **72ppi 기준 픽셀**(0~4999.99)이다. " +
      "auto: true 를 주면 Photoshop 이 알아서 정한다(보통 글자 크기의 120%). " +
      "**auto 를 켜면 leading 값이 지워져 null 이 된다**(실기 확인) — 그래서 leading 만 " +
      "주면 auto 를 먼저 끈다. leading 과 auto 중 최소 하나는 줘야 한다. " +
      "**한 줄짜리 텍스트에는 효과가 없다** — 줄 사이 간격이므로 두 줄 이상이어야 보인다. " +
      COMMON,
    "edit",
    TextSetLeadingParamsSchema,
    TEXT_SET_LEADING,
    engine,
  );
}

/** `photoshop.text.set_paragraph` */
export function createTextSetParagraphTool(
  engine: CommandEngine,
): ToolDefinition<TextSetParagraphParams, TextDetail> {
  return create(
    "photoshop.text.set_paragraph",
    "단락 설정을 바꾼다. justification 은 left · center · right 와 " +
      "leftJustified · centerJustified · rightJustified · fullyJustified 일곱이다 — " +
      "**뒤의 넷은 양쪽 정렬**이고 마지막 줄을 어디로 붙일지가 다르다. " +
      "firstLineIndent · leftIndent · rightIndent · spaceBefore · spaceAfter 는 " +
      "**72ppi 기준 픽셀**(−1296~1296)이다. hyphenation 은 하이픈 넣기. " +
      "바꿀 항목을 최소 하나는 줘야 한다. " +
      "**한 번 이것을 부르면 안 건드린 항목은 이후 null 로 읽힌다**(실기 확인) — " +
      "Photoshop 이 명시적으로 설정한 것만 보고한다. **null 을 0 으로 읽지 않는다.** " +
      "**정렬 말고는 점 텍스트에서 효과가 거의 없다** — 들여쓰기와 문단 간격은 " +
      "단락 텍스트의 것이다. photoshop.text.convert_to_paragraph 를 먼저 부른다. " +
      COMMON,
    "edit",
    TextSetParagraphParamsSchema,
    TEXT_SET_PARAGRAPH,
    engine,
  );
}

/** `photoshop.text.warp` */
export function createTextWarpTool(
  engine: CommandEngine,
): ToolDefinition<TextWarpParams, TextDetail> {
  return create(
    "photoshop.text.warp",
    "텍스트를 휜다. style 은 none · arc · arcLower · arcUpper · arch · bulge · " +
      "shellLower · shellUpper · flag · wave · fish · rise · fishEye · inflate · " +
      "squeeze · twist 열여섯이다 — **none 을 주면 워프를 푼다.** " +
      "Photoshop 내부 값에는 warp 접두사가 붙지만(warpArcLower) **읽을 때 되돌려주므로 " +
      "넣는 이름과 읽는 이름이 같다.** " +
      "bend 는 휘는 정도(%, −100~100), horizontalDistortion · verticalDistortion 은 " +
      "원근 왜곡(%, −100~100), direction 은 휘는 축이다. " +
      "**텍스트는 그대로 편집할 수 있다** — 모양으로 굳히는 " +
      "photoshop.text.convert_to_shape 와 다르다. " +
      COMMON,
    "edit",
    TextWarpParamsSchema,
    TEXT_WARP,
    engine,
  );
}

/** `photoshop.text.convert_to_point` */
export function createTextConvertToPointTool(
  engine: CommandEngine,
): ToolDefinition<TextTargetParams, TextDetail> {
  return create(
    "photoshop.text.convert_to_point",
    "단락 텍스트를 **점 텍스트**로 바꾼다. 점 텍스트는 상자가 없어 줄바꿈이 " +
      "자동으로 생기지 않고 쓴 대로 이어진다 — 한 줄짜리 서명이나 워터마크에 맞다. " +
      "**상자 밖으로 넘쳐 안 보이던 글자가 있으면 그것은 사라진다.** " +
      COMMON,
    "edit",
    TextTargetParamsSchema,
    TEXT_CONVERT_TO_POINT,
    engine,
  );
}

/** `photoshop.text.convert_to_paragraph` */
export function createTextConvertToParagraphTool(
  engine: CommandEngine,
): ToolDefinition<TextTargetParams, TextDetail> {
  return create(
    "photoshop.text.convert_to_paragraph",
    "점 텍스트를 **단락 텍스트**로 바꾼다. 단락 텍스트는 상자 안에서 자동으로 " +
      "줄바꿈되고 들여쓰기 · 문단 간격 · 양쪽 정렬이 의미를 갖는다 — " +
      "photoshop.text.set_paragraph 를 쓰려면 보통 이것이 먼저다. " +
      COMMON,
    "edit",
    TextTargetParamsSchema,
    TEXT_CONVERT_TO_PARAGRAPH,
    engine,
  );
}

/** `photoshop.text.convert_to_shape` */
export function createTextConvertToShapeTool(
  engine: CommandEngine,
): ToolDefinition<TextTargetParams, TextShapeResult> {
  return create(
    "photoshop.text.convert_to_shape",
    "텍스트를 **모양 레이어로 굳힌다**. 글자가 벡터 윤곽이 되어 " +
      "**더는 텍스트가 아니다 — 내용도 폰트도 고칠 수 없다.** " +
      "그래서 destructive 다. photoshop.layer.rasterize 가 픽셀로 굽는 것과 같은 " +
      "종류이고, 되돌릴 길은 History 뿐이다. " +
      "폰트가 없는 곳에서도 모양이 유지되어야 할 때 쓴다. " +
      "**휘기만 하려는 것이면 photoshop.text.warp 이다** — 그쪽은 텍스트로 남는다. " +
      "layerId 를 생략하면 활성 레이어. 텍스트 레이어가 아니면 거절한다. " +
      "**변환 뒤 정말 텍스트가 아닌지 확인하고 답한다.**",
    "destructive",
    TextTargetParamsSchema,
    TEXT_CONVERT_TO_SHAPE,
    engine,
  );
}
