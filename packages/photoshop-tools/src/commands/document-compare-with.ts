import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import { DocumentCompareResultSchema } from "./document-compare.js";

/**
 * **다른 문서와** 견준다. (ROADMAP §101)
 *
 * `document.compare` 는 같은 문서의 전과 후(크기가 같아야 한다)를 견준다. 참조 사진에 맞춰 보정할
 * 때는 견줄 대상이 **다른 문서**이고 크기도 비율도 다르다. 그동안은 문서를 번갈아 캡처해 두 장을
 * 기억하며 눈으로 견줬고, 그 눈이 두 번 틀렸다(MEASUREMENT.md §2).
 *
 * ## 같은 크기로 줄여 견준다
 *
 * 두 문서를 **같은 크기의 미리보기**로 읽어 나란히 붙이고 그 미리보기에서 수치를 낸다. 그래서
 * `document.compare` 와 달리 수치도 축소본에서 나온다 — **클리핑 퍼센트는 믿지 않는다**(단일 픽셀
 * 클리핑이 묻힌다). 톤 분위수 · 채널 중앙값 · 타일 색차는 구도가 비슷한 사진끼리 쓸 만하다.
 * 비율이 다르면 한쪽이 늘어나므로 `aspect` 로 알린다 — 같은 장면이 아니면 타일 색차는 위치를
 * 따르지 않는다.
 *
 * ## 문서를 옮기지 않는다
 *
 * Imaging API 가 문서 id 를 받으므로 활성 문서를 바꾸지 않고 읽는다. 사용자의 탭이 그대로다.
 *
 * ## 판정이 없다
 *
 * `document.compare` 와 같다 — 차이와 위치만 준다. 어느 쪽이 맞는지는 사진이 정한다.
 */

export const DOCUMENT_COMPARE_WITH = "DOCUMENT_COMPARE_WITH";

export const DocumentCompareWithParamsSchema = z
  .object({
    /** 견줄 **다른** 문서(`photoshop.document.list` 의 id). 활성 문서는 안 된다. */
    documentId: z.number().int().positive(),
    /** 다른 문서의 레이어. 생략하면 그 문서의 합성. */
    layerId: z.number().int().positive().optional(),
    /** 활성 문서의 레이어. 생략하면 활성 문서의 합성. */
    activeLayerId: z.number().int().positive().optional(),
    /** 짧은 변을 몇 타일로 나눌지. 4–16, 기본 8. */
    grid: z.number().int().min(4).max(16).optional(),
    /** 합친 그림의 긴 변(px). 256–2048, 기본 1280. */
    longEdge: z.number().int().min(256).max(2048).optional(),
    /** 차이 열지도를 세 번째 패널로 붙인다. 기본 꺼짐. */
    diff: z.boolean().optional(),
    /** JPEG 품질 1–100, 기본 80. */
    quality: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type DocumentCompareWithParams = z.infer<typeof DocumentCompareWithParamsSchema>;

const SideSchema = z.object({
  documentId: z.number().int(),
  name: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** `document` · `layer:<id>` */
  source: z.string(),
});

export const DocumentCompareWithResultSchema = DocumentCompareResultSchema.omit({
  panels: true,
}).extend({
  /**
   * 왼쪽부터의 패널 순서. `reference` 가 다른 문서, `active` 가 활성 문서다. **그림에는 글자가
   * 없으므로 이 순서가 유일한 표식이다.**
   */
  panels: z
    .array(z.enum(["reference", "active", "difference"]))
    .min(2)
    .max(3),
  /** 수치를 어디서 냈는지. 언제나 축소한 미리보기다. */
  measuredFrom: z.literal("preview"),
  reference: SideSchema,
  active: SideSchema,
  /** 두 문서의 가로/세로 비. 1% 넘게 다르면 `differs` 이고 한쪽이 늘어나 있다. */
  aspect: z.object({ reference: z.number(), active: z.number(), differs: z.boolean() }),
});

export type DocumentCompareWithResult = z.infer<typeof DocumentCompareWithResultSchema>;

/**
 * 수치의 `before` 는 **reference**, `after` 는 **active** 다 — `change` 는 (active − reference) 다.
 * 이름을 따로 짓지 않고 `document.compare` 의 모양을 그대로 쓴다.
 */
export const documentCompareWithCommand: CommandHandler<
  DocumentCompareWithParams,
  DocumentCompareWithResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentCompareWithResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "문서 비교 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  const expected = command.params.diff === true ? 3 : 2;
  if (parsed.data.panels.length !== expected) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `요청한 패널 수(${String(expected)})와 결과(${String(parsed.data.panels.length)})가 다릅니다. ` +
        "서버와 Photoshop 플러그인의 버전이 같은지 확인하세요.",
      { details: { requested: expected, received: parsed.data.panels } },
    );
  }
  return parsed.data;
};
