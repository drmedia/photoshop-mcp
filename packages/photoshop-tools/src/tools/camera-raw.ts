import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  CAMERA_RAW_APPLY,
  CameraRawParamsSchema,
  type CameraRawResult,
} from "../commands/camera-raw.js";

/** `photoshop.camera_raw.apply` — Camera Raw 필터. (ROADMAP §17.17) */
export function createCameraRawApplyTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof CameraRawParamsSchema>, CameraRawResult> {
  return {
    name: "photoshop.camera_raw.apply",
    description:
      "Camera Raw 필터를 건다. 노출·대비·밝은영역·어두운영역·색온도·부분대비·디헤이즈 " +
      "그리고 **노이즈 감소**까지 한 번에 적용한다. " +
      "**필요한 설정을 한 번의 호출에 모두 담아라.** 나눠서 여러 번 부르면 픽셀이 " +
      "반복해서 구워져 결과가 달라진다 — 실기에서 같은 네 설정을 네 번 나눠 걸었더니 " +
      "중간값이 19% 어긋났다. 고치려면 photoshop.history.undo 로 되돌린 뒤 전체를 다시 적용한다. " +
      "노이즈 감소는 Photoshop 의 노이즈 감소 필터보다 훨씬 잘 듣는다 — " +
      "실기에서 σ 6.72 → 3.42(49%) 이면서 색은 소수점 둘째 자리까지 그대로였다. " +
      "픽셀을 직접 바꾸므로 원본을 남기려면 photoshop.layer.duplicate 로 복제한 뒤 건다. " +
      "숨긴 레이어와 조정 레이어에는 걸 수 없다. " +
      "temperature 는 켈빈이 아니라 -100~100 상대값이다. " +
      "**색상 혼합(HSL)** 은 hue/saturation/luminance × Red·Orange·Yellow·Green·Aqua·Blue·Purple·Magenta " +
      "24개 파라미터다(예: saturationOrange, luminanceBlue). " +
      "전역 vibrance·saturation 과 달리 **특정 색만** 건드리므로, 야경에서 조명색만 " +
      "살리고 하늘은 그대로 두는 식의 조정에 쓴다. " +
      "레이어를 photoshop.smart_object.convert 로 먼저 감싸면 스마트 필터로 남아 " +
      "나중에 값만 고칠 수 있다 — 그러면 '한 번에 담아라' 제약도 완화된다.",
    permission: "edit",
    inputSchema: CameraRawParamsSchema,
    handler: async (input, context) =>
      engine.execute<CameraRawResult>(
        { type: CAMERA_RAW_APPLY, params: input },
        { requestId: context.requestId },
      ),
  };
}
