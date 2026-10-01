import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 텍스트 레이어. (ROADMAP §17.33)
 *
 * `CORE_API.md` §5.12 가 텍스트 전체를 P3 로 두고 "실제 요구가 확인된 뒤에
 * 연다" 고 적은 자리다. 확인된 요구는 **워터마크·서명**이므로 거기까지만 연다.
 *
 * 자간·행간·단락·변형·워프는 넣지 않았다. 필요해지면 그때 연다 —
 * 안 쓰는 파라미터가 스키마에 있으면 호출자가 무엇이 중요한지 알 수 없다.
 *
 * ## 슬라이더마다 Tool 을 두지 않는다
 *
 * `set_font` · `set_size` · `set_color` 를 따로 두지 않고 `text.set` 하나로
 * 묶었다. 워터마크는 한 번에 만들고, 고칠 때도 여러 속성을 같이 바꾼다.
 * (`camera_raw.apply` 와 같은 판단)
 */

export const TEXT_CREATE = "TEXT_CREATE";
export const TEXT_SET = "TEXT_SET";
export const FONT_LIST = "FONT_LIST";

/** 0–255. */
const ColorSchema = z
  .object({
    red: z.number().int().min(0).max(255),
    green: z.number().int().min(0).max(255),
    blue: z.number().int().min(0).max(255),
  })
  .strict();

const StyleShape = {
  /**
   * **PostScript 이름**이다. `font.list` 가 주는 `postScriptName` 을 그대로 쓴다.
   *
   * 화면에 보이는 이름(`name`)이 아니다. 없는 이름을 주면 Photoshop 이 조용히
   * 다른 폰트로 대체하므로 Command 가 미리 찾아보고 거절한다.
   */
  font: z.string().trim().min(1).max(255).optional(),
  /**
   * **문서 픽셀이다 — 포인트가 아니다.** 해상도와 무관하다.
   *
   * 실기에서 쟀다(ROADMAP §87). 같은 `size 100` 의 `H` 가 72ppi 문서와 300ppi 문서에서
   * 똑같이 72px 높이였다(Arial 대문자 높이 ≈ 0.716 × size). 포인트였다면 300ppi 에서
   * 약 4.17배인 300px 가 나와야 한다. 두 번째 문서가 실제로 300ppi 였는지도
   * `image.resize` 의 `before.resolution` 으로 확인했다.
   *
   * **Photoshop 문자 패널의 pt 는 `size × 72 ÷ ppi` 다.** 창 캡처로 패널을 읽었다 —
   * 300ppi 에서 size 100 → 24pt, 150ppi 에서 → 48pt.
   */
  size: z.number().min(0.1).max(1296).optional(),
  color: ColorSchema.optional(),
  /** 0–100. 워터마크는 보통 20–40 이다. */
  opacity: z.number().int().min(0).max(100).optional(),
  alignment: z.enum(["left", "center", "right"]).optional(),
};

export const TextCreateParamsSchema = z
  .object({
    /** 넣을 글자. 줄바꿈을 포함할 수 있다. */
    contents: z.string().min(1).max(2000),
    /** 기준점. 문서 좌상단이 원점이고 **글자의 기준선(baseline)** 이다. */
    x: z.number().min(0),
    y: z.number().min(0),
    /** 레이어 이름. 생략하면 Photoshop 이 내용으로 정한다. */
    name: z.string().trim().min(1).max(255).optional(),
    ...StyleShape,
  })
  .strict();

export type TextCreateParams = z.infer<typeof TextCreateParamsSchema>;

export const TextSetParamsSchema = z
  .object({
    /** 대상 텍스트 레이어. 생략하면 활성 레이어. */
    layerId: z.number().int().positive().optional(),
    contents: z.string().min(1).max(2000).optional(),
    ...StyleShape,
  })
  .strict()
  .refine(
    (value) =>
      value.contents !== undefined ||
      value.font !== undefined ||
      value.size !== undefined ||
      value.color !== undefined ||
      value.opacity !== undefined ||
      value.alignment !== undefined,
    { message: "바꿀 항목을 하나 이상 주세요." },
  );

export type TextSetParams = z.infer<typeof TextSetParamsSchema>;

export const TextResultSchema = z.object({
  layer: LayerInfoSchema,
  /**
   * 실제로 적용한 항목.
   *
   * 준 것과 다를 수 있다 — 짐작하지 않고 적용한 것만 담는다.
   */
  applied: z.array(z.string()),
});

export type TextResult = z.infer<typeof TextResultSchema>;

export const FontListParamsSchema = z
  .object({
    /**
     * 이름·계열에 이 문자열이 든 것만. 대소문자를 가리지 않는다.
     *
     * 607개가 통째로 오면 LLM 의 맥락을 먹는다.
     */
    query: z.string().trim().min(1).max(100).optional(),
    /** 상한. 기본 50. */
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type FontListParams = z.infer<typeof FontListParamsSchema>;

export const FontListResultSchema = z.object({
  fonts: z.array(
    z.object({
      name: z.string(),
      family: z.string(),
      style: z.string(),
      /** `text.create` · `text.set` 의 `font` 에 넣을 값. */
      postScriptName: z.string(),
    }),
  ),
  /** 거르기 전 전체 수. `fonts.length` 와 다를 수 있다. */
  total: z.number().int(),
});

export type FontListResult = z.infer<typeof FontListResultSchema>;

function forwardText<TParams>(label: string): CommandHandler<TParams, TextResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = TextResultSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
        details: { issues: parsed.error.issues },
        cause: parsed.error,
      });
    }
    return parsed.data;
  };
}

export const textCreateCommand = forwardText<TextCreateParams>("텍스트 생성");
export const textSetCommand = forwardText<TextSetParams>("텍스트 수정");

export const fontListCommand: CommandHandler<FontListParams, FontListResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = FontListResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "폰트 목록이 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  // **거르기는 서버가 한다.** Plugin 은 실행 Agent 이고, 같은 계산을 두 곳에서
  // 하지 않는다. (CLAUDE.md 의존 방향 6)
  const query = command.params.query?.toLowerCase();
  const matched =
    query === undefined
      ? parsed.data.fonts
      : parsed.data.fonts.filter(
          (font) =>
            font.name.toLowerCase().includes(query) ||
            font.family.toLowerCase().includes(query) ||
            font.postScriptName.toLowerCase().includes(query),
        );
  return { fonts: matched.slice(0, command.params.limit ?? 50), total: parsed.data.total };
};
