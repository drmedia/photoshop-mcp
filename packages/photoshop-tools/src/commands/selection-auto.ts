import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { z } from "zod";

/**
 * Photoshop 의 자동 선택 명령 — `선택 > 하늘`.
 *
 * **Photoshop 네이티브 기능**이며 메뉴에 있다.
 * 내부적으로 Adobe 의 모델을 쓰지만 호출하는 쪽에서는 Gaussian Blur 와 다를 바 없는
 * 명령 하나다 — 외부 프로그램도, 플러그인도 필요 없다.
 *
 * 한동안 `docs/CORE_API.md` §27 이 이것을 "Core 가 아니라 고수준 워크플로" 로
 * 분류해 두어 구현하지 않았다. 잘못된 분류였다. Core 의 기준은 "Photoshop 일반
 * 기능인가" 이고 이 둘은 그 기준을 만족한다.
 *
 * 이것이 없으면 하늘/전경을 나누는 모든 작업이 사각형 근사로 떨어진다. 실제 지평선은
 * 직선이 아니므로 결과가 쓸모없다. 천체사진 워크플로를 시험하다 드러났다.
 */

export const SELECTION_SKY = "SELECTION_SKY";

export const SelectionAutoParams = z.object({}).strict();

export interface SelectionResult {
  hasSelection: boolean;
  /** 선택 영역의 경계. 선택이 없으면 `null`. */
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

const ResultSchema = z.object({
  hasSelection: z.boolean(),
  bounds: z
    .object({ left: z.number(), top: z.number(), right: z.number(), bottom: z.number() })
    .nullable(),
});

function forward(): CommandHandler<Record<string, never>, SelectionResult> {
  return async (command, context) => {
    const raw = await context.bridge.executeCommand<unknown>(command);
    // 경계를 함께 돌려준다. 자동 선택은 **아무것도 못 찾을 수 있고**, 그때
    // hasSelection 만으로는 "하늘이 없는 사진" 인지 "실패" 인지 구분이 어렵다.
    return ResultSchema.parse(raw);
  };
}

export const selectionSkyCommand = forward();
