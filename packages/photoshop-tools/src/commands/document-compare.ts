import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { CapturedImageSchema, ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 보정 전후 비교. (ROADMAP §91)
 *
 * 보정 뒤 미리보기를 LLM 에게 돌려주되 **무엇이 얼마나 어디서 변했는지**를 함께 준다. 이미지를 못
 * 받는 클라이언트(앞서 Copilot 이 이미지 참조를 가져오지 못해 404 로 실패한 적이 있다)에서도 수치로
 * 판단할 수 있어야 하기 때문이다.
 *
 * 결과는 `CapturedImage` 에 수치 필드를 얹은 하나의 객체다. 서버는 이미지 결과를 알아보고 base64
 * 를 이미지 블록으로, 나머지를 텍스트로 내보낸다(`mcp-server.ts`).
 *
 * ## 판정이 없다
 *
 * "좋아졌다" · "과하다" 가 없다. 변한 양과 위치만 준다. 무엇이 좋은 변화인지는 사진이 정한다
 * (MEASUREMENT.md §2).
 */

export const DOCUMENT_COMPARE = "DOCUMENT_COMPARE";

export const DocumentCompareParamsSchema = z
  .object({
    /**
     * 보정 전 픽셀을 담은 레이어. **필수**다.
     *
     * 이 프로젝트의 보정은 비파괴라 원본이 아래에 그대로 있다(복제 → 스마트 오브젝트 → Camera Raw).
     * 보통 배경 레이어다. 캔버스 전체를 덮어야 한다 — 크기가 다르면 거절한다.
     */
    beforeLayerId: z.number().int().positive(),
    /** 보정 후 레이어. 생략하면 **보이는 그대로의 합성**이다. */
    afterLayerId: z.number().int().positive().optional(),
    /**
     * `selection` 이면 선택 영역의 경계 상자만 비교한다 — 전체에서 안 보이는 것을 **확대해서** 볼 때.
     * 선택이 없으면 실패한다.
     */
    region: z.enum(["document", "selection"]).optional(),
    /** 짧은 변을 몇 타일로 나눌지. 4–16, 기본 8. */
    grid: z.number().int().min(4).max(16).optional(),
    /**
     * 합친 그림의 긴 변(px). 256–2048, 기본 1280.
     *
     * 패널이 둘(셋)이라 한 장당 크기는 이보다 작다. 세로 사진이면 한 장이 가로 약 630px 이다 —
     * 세부를 보려면 올리거나 `region: "selection"` 으로 좁힌다.
     */
    longEdge: z.number().int().min(256).max(2048).optional(),
    /** 차이 열지도를 세 번째 패널로 붙인다. 기본 꺼짐 — 패널이 셋이면 각각이 작아진다. */
    diff: z.boolean().optional(),
    /** JPEG 품질 **1–100**, 기본 80. (document.export 의 1–12 와 다르다) */
    quality: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type DocumentCompareParams = z.infer<typeof DocumentCompareParamsSchema>;

// ── 결과 ──────────────────────────────────────────────────────────────

const GlobalSchema = z.object({
  pixels: z.number().int(),
  channelMedians: z.object({ red: z.number(), green: z.number(), blue: z.number() }),
  luminance: z.object({
    p1: z.number(),
    p5: z.number(),
    p50: z.number(),
    p95: z.number(),
    p99: z.number(),
  }),
  clipping: z.object({ highPercent: z.number(), lowPercent: z.number() }),
});

const NullableRows = z.array(z.array(z.number().nullable()));

export const DocumentCompareResultSchema = CapturedImageSchema.extend({
  /** 왼쪽부터의 패널 순서. 그림에는 글자가 없으므로 이 순서가 유일한 표식이다. */
  panels: z
    .array(z.enum(["before", "after", "difference"]))
    .min(2)
    .max(3),
  /** 잰 영역의 크기(픽셀). `hotspots` 의 좌표는 이 영역의 왼쪽 위가 원점이다. */
  area: z.object({ width: z.number().int(), height: z.number().int() }),
  grid: z.object({ cols: z.number().int(), rows: z.number().int() }),
  before: GlobalSchema,
  after: GlobalSchema,
  change: z.object({
    luminance: z.object({
      p1: z.number(),
      p5: z.number(),
      p50: z.number(),
      p95: z.number(),
      p99: z.number(),
    }),
    channelMedians: z.object({ red: z.number(), green: z.number(), blue: z.number() }),
    clipping: z.object({ highPercent: z.number(), lowPercent: z.number() }),
    tiles: z.object({ deltaLuminance: NullableRows, deltaE: NullableRows }),
    deltaE: z.object({ mean: z.number(), max: z.number() }).nullable(),
    hotspots: z.array(
      z.object({
        left: z.number(),
        top: z.number(),
        right: z.number(),
        bottom: z.number(),
        deltaE: z.number(),
        deltaLuminance: z.number(),
      }),
    ),
  }),
  elapsedMs: z.number().int(),
});

export type DocumentCompareResult = z.infer<typeof DocumentCompareResultSchema>;

export const documentCompareCommand: CommandHandler<
  DocumentCompareParams,
  DocumentCompareResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = DocumentCompareResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "비교 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }

  // 요청한 패널이 모두 있는지 본다 — 서버만 새 버전이면 옛 플러그인이 차이 패널을 빼고 돌려준다
  // (ROADMAP §84 의 applied 비교와 같은 이유).
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
