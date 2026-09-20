import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  SMART_OBJECT_CONVERT,
  SmartObjectConvertParamsSchema,
  type SmartObjectConvertResult,
} from "../commands/smart-object.js";

/** `photoshop.smart_object.convert` — 레이어를 스마트 오브젝트로 만든다. (ROADMAP §17.27) */
export function createSmartObjectConvertTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof SmartObjectConvertParamsSchema>, SmartObjectConvertResult> {
  return {
    name: "photoshop.smart_object.convert",
    description:
      "레이어를 스마트 오브젝트로 변환한다. 픽셀을 버리지 않고 한 겹 감쌀 뿐이다. " +
      "**이 뒤에 거는 camera_raw.apply · filter.* 는 스마트 필터가 되어 나중에 값만 고칠 수 있다** — " +
      "변환하지 않은 레이어에 걸면 픽셀에 구워져 되돌리려면 History 뿐이다. " +
      "국소 보정은 layer.duplicate(또는 stamp_visible) → 선택 → mask.create → 이 Tool → " +
      "camera_raw.apply 순서로 한다. 마스크를 먼저 씌워야 변환된 결과에 함께 들어간다. " +
      "**변환하면 레이어 id 가 바뀐다** — 결과의 layer.id 를 이어서 쓴다. previousId 에 옛 id 가 있다. " +
      "이미 스마트 오브젝트면 아무것도 하지 않고 converted: false 로 답한다(오류가 아니다). " +
      "스마트 오브젝트 안에 스마트 오브젝트를 만들지 않기 위함이다.",
    permission: "edit",
    inputSchema: SmartObjectConvertParamsSchema,
    handler: async (input, context) =>
      engine.execute<SmartObjectConvertResult>(
        { type: SMART_OBJECT_CONVERT, params: input },
        { requestId: context.requestId },
      ),
  };
}
