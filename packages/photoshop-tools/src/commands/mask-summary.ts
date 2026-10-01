import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, LayerInfoSchema, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 마스크 요약. (ROADMAP §97)
 *
 * 마스크의 흑·백 비율, 효과가 닿는 경계 상자, 위치별 강도. `document.analyze` 의 마스크 분석은 거의 한
 * 값인 마스크에서 `gradient` 가 0 을 돌려줘 모양을 말하지 못했다(§95) — 그 빈틈이다.
 *
 * ## 판정이 없다
 *
 * "마스크가 좋다·나쁘다" 를 담지 않는다. 숫자와 위치만 준다(MEASUREMENT.md §2).
 */

export const MASK_SUMMARY = "MASK_SUMMARY";

export const MaskSummaryParamsSchema = z
  .object({
    /** 생략하면 활성 레이어. 마스크가 있어야 한다. */
    layerId: z.number().int().positive().optional(),
    /** 짧은 변을 몇 타일로 나눌지. 4–16, 기본 8. */
    grid: z.number().int().min(4).max(16).optional(),
  })
  .strict();

export type MaskSummaryParams = z.infer<typeof MaskSummaryParamsSchema>;

const BoxSchema = z.object({
  left: z.number().int(),
  top: z.number().int(),
  right: z.number().int(),
  bottom: z.number().int(),
});

const PercentSchema = z.number().min(0).max(100);

export const MaskSummarySchema = z.object({
  layer: LayerInfoSchema,
  /** 무엇을 쟀는지. `mask:<id>` */
  source: z.string(),
  /** 잰 영역. **문서 캔버스** 크기다 — 아래 좌표는 이 영역의 왼쪽 위가 원점이다. */
  area: z.object({ width: z.number().int(), height: z.number().int() }),
  hiddenPercent: PercentSchema,
  revealedPercent: PercentSchema,
  partialPercent: PercentSchema,
  meanPercent: PercentSchema,
  touched: BoxSchema.nullable(),
  full: BoxSchema.nullable(),
  grid: z.object({ cols: z.number().int(), rows: z.number().int() }),
  tiles: z.array(z.array(PercentSchema)),
  elapsedMs: z.number().int(),
});

export type MaskSummary = z.infer<typeof MaskSummarySchema>;

export const maskSummaryCommand: CommandHandler<MaskSummaryParams, MaskSummary> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = MaskSummarySchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "마스크 요약 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }

  /* 격자 모양이 맞는지 본다. 행 · 열 수가 어긋난 표를 그대로 주면 호출자는 타일 좌표를 잘못 읽는다. */
  const { grid, tiles } = parsed.data;
  if (tiles.length !== grid.rows || tiles.some((row) => row.length !== grid.cols)) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `타일 표(${String(tiles.length)}행)가 격자(${String(grid.rows)}행 × ${String(grid.cols)}열)와 다릅니다. ` +
        "서버와 Photoshop 플러그인의 버전이 같은지 확인하세요.",
      { details: { grid, rows: tiles.length } },
    );
  }

  // 완전히 가림 + 완전히 보임 + 부분 = 100 (반올림 오차 안에서).
  const { hiddenPercent, revealedPercent, partialPercent } = parsed.data;
  if (Math.abs(hiddenPercent + revealedPercent + partialPercent - 100) > 0.01) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "마스크 비율의 합이 100 이 아닙니다.", {
      details: { hiddenPercent, revealedPercent, partialPercent },
    });
  }
  return parsed.data;
};
