import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 앱 설정과 색. (ROADMAP §61)
 *
 * **전부 DOM 이다** — `app.preferences`(24.0+) · `app.foregroundColor` ·
 * `app.backgroundColor`.
 *
 * 환경 설정의 **속성 이름을 짐작하지 않는다.** 하위 객체 안쪽이 레퍼런스에
 * 없어 반사적으로 읽고 나온 것만 담는다.
 */

export const PREFERENCES_GET = "PREFERENCES_GET";
export const COLOR_GET_FOREGROUND_BACKGROUND = "COLOR_GET_FOREGROUND_BACKGROUND";

/** 레퍼런스에 적힌 열둘. */
export const PreferenceCategorySchema = z.enum([
  "cursors",
  "fileHandling",
  "general",
  "guidesGridsAndSlices",
  "history",
  "interface",
  "notifications",
  "performance",
  "tools",
  "transparencyAndGamut",
  "type",
  "unitsAndRulers",
]);

export const PreferencesGetParamsSchema = z
  .object({
    /** 하나만 보고 싶을 때. 생략하면 열둘을 전부 준다. */
    category: PreferenceCategorySchema.optional(),
  })
  .strict();

/** 값은 문자열·숫자·불린만 담는다. 중첩 객체와 함수는 빼고 준다. */
const FlatValues = z.record(z.union([z.string(), z.number(), z.boolean()])).nullable();

export const PreferencesGetResultSchema = z.object({
  /** 읽지 못한 범주는 `null` 이다. */
  categories: z.record(FlatValues),
});

export const ColorInfoSchema = z.object({
  red: z.number().nullable(),
  green: z.number().nullable(),
  blue: z.number().nullable(),
  /** `#RRGGBB`. 셋을 다 읽었을 때만 값이 있다. */
  hex: z.string().nullable(),
});

export const ColorGetResultSchema = z.object({
  foreground: ColorInfoSchema,
  background: ColorInfoSchema,
});

export const ColorGetParamsSchema = z.object({}).strict();

export type PreferenceCategory = z.infer<typeof PreferenceCategorySchema>;
export type PreferencesGetParams = z.infer<typeof PreferencesGetParamsSchema>;
export type PreferencesGetResult = z.infer<typeof PreferencesGetResultSchema>;
export type ColorGetParams = z.infer<typeof ColorGetParamsSchema>;
export type ColorGetResult = z.infer<typeof ColorGetResultSchema>;

function forward<TParams, TResult>(
  schema: z.ZodType<TResult>,
  label: string,
): CommandHandler<TParams, TResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, `${label} 결과가 예상과 다릅니다.`, {
        details: { issues: parsed.error.issues, received: raw },
        cause: parsed.error,
      });
    }
    return parsed.data;
  };
}

export const preferencesGetCommand = forward<PreferencesGetParams, PreferencesGetResult>(
  PreferencesGetResultSchema,
  "환경 설정",
);
export const colorGetCommand = forward<ColorGetParams, ColorGetResult>(
  ColorGetResultSchema,
  "전경·배경색",
);
