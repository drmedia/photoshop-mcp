import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  MEASURE_TILT,
  MeasureTiltParamsSchema,
  type MeasureTiltResult,
} from "../commands/measure-tilt.js";

/** `photoshop.measure.tilt` — 경계선 기울기를 잰다. (ROADMAP §17.21) */
export function createMeasureTiltTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof MeasureTiltParamsSchema>, MeasureTiltResult> {
  return {
    name: "photoshop.measure.tilt",
    description:
      "수평선·기둥 같은 경계선의 기울기를 잰다. photoshop.document.rotate 의 입력을 만드는 Tool 이다. " +
      "bounds 는 **문서 픽셀 좌표** {left, top, right, bottom}(왼쪽 위가 0,0)이고 " +
      "**경계선 하나만 들어오게** 잡는다 — 섬·건물이 섞이면 잔차가 커진다. " +
      "minContrast 는 경계로 인정할 최소 대비(0–255 눈금, 기본 20)다. " +
      "angleDegrees 는 시계 방향이 양수이고 rotate 와 같은 규약이라 **부호를 뒤집어 넘긴다** " +
      "(−1.87° 로 나왔으면 rotate 에 1.87). " +
      "**각도만 보고 돌리지 않는다.** residualIqr 이 직선성을 말한다 — " +
      "경계가 실제로는 휘어 있는데 그럴듯한 각도가 나오는 경우가 실기에서 세 번 중 두 번이었다. " +
      "잔차는 risePixels(그 구간에서 경계가 오르내린 높이)와 견주어 읽는다. " +
      "잔차가 그에 비해 크면 직선이 아니므로 **돌리지 않는 것이 답이다.** " +
      "확신이 서지 않으면 서로 떨어진 두 구간을 따로 재서 각도가 일치하는지 본다. " +
      "**보정이 쌓인 문서에서는 layerId 로 원본 레이어를 지정한다** — " +
      "합성에서는 경계 대비가 낮아져 경계를 찾는 줄이 크게 줄어든다.",
    permission: "read",
    inputSchema: MeasureTiltParamsSchema,
    handler: async (input, context) =>
      engine.execute<MeasureTiltResult>(
        { type: MEASURE_TILT, params: input },
        { requestId: context.requestId },
      ),
  };
}
