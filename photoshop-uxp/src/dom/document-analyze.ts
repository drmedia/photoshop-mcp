import { DispatchError } from "../dispatcher/dispatcher.js";
import { ALL_ANALYSES, analyze, type AnalysisName } from "./imaging-analysis.js";
import { runModal } from "./modal.js";
import { readPixels, type PixelSourceParams } from "./pixel-source.js";

/**
 * 이미징 분석기. (ROADMAP §90)
 *
 * `document.statistics` 와 **같은 곳을 같은 규칙으로** 읽는다(`pixel-source.ts`). 계산은
 * `imaging-analysis.ts` 의 순수 함수가 한다 — 여기서는 읽고, 부르고, 놓는 일만 한다.
 *
 * 픽셀은 **한 번만** 읽는다. 다섯 분석을 따로 부르면 2400만 픽셀을 다섯 번 읽는다.
 */
export async function documentAnalyze(
  params: PixelSourceParams & { analyses?: AnalysisName[]; grid?: number },
): Promise<unknown> {
  return runModal("Document analyze", async () => {
    const started = Date.now();
    const pixelData = await readPixels(params);
    try {
      const { source, width, height, components, componentSize, maxValue, pixels } = pixelData;
      let result;
      try {
        result = analyze(
          { data: pixelData.data, width, height, components, maxValue },
          { analyses: params.analyses ?? ALL_ANALYSES, grid: params.grid ?? 8 },
        );
      } catch (error) {
        // 폭을 모르는 버퍼에 공간 분석을 걸었을 때. 지어낸 값을 돌려주지 않는다.
        throw new DispatchError(
          "COMMAND_FAILED",
          `분석하지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
          { recoverable: true, details: { source } },
        );
      }
      return {
        source,
        // 잰 영역의 크기. 결과의 `bounds` 와 타일 좌표는 이 영역의 왼쪽 위가 원점이다.
        area: { width, height },
        pixels,
        bitDepth: componentSize,
        ...result,
        method: "getPixels",
        elapsedMs: Date.now() - started,
      };
    } finally {
      pixelData.dispose();
    }
  });
}
