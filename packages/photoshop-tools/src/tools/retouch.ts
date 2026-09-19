import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import {
  RETOUCH_REMOVE_SPOTS,
  RemoveSpotsParamsSchema,
  type RemoveSpotsResult,
} from "../commands/retouch.js";

/** `photoshop.retouch.remove_spots` — 센서 먼지·잡티를 지운다. (ROADMAP §17.14) */
export function createRemoveSpotsTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof RemoveSpotsParamsSchema>, RemoveSpotsResult> {
  return {
    name: "photoshop.retouch.remove_spots",
    description:
      "센서 먼지·잡티를 지운다. 지점마다 타원으로 선택해 **내용 인식 채우기**를 건다. " +
      "spots 는 문서 픽셀 좌표(왼쪽 위가 0,0)의 목록이며 한 번에 여러 개를 받는다. " +
      "radius 는 결함보다 조금 크게 잡는다 — 결함이 선택 안에 완전히 들어와야 한다. " +
      "**배경 레이어에는 걸 수 없다.** 원본 촬영 픽셀이 사라지기 때문이며, " +
      "photoshop.layer.duplicate 로 복제한 뒤 그 레이어를 지정하면 된다. " +
      "먼지인지 먼저 확인한다 — photoshop.selection.capture 로 원본 해상도로 보면 " +
      "먼지는 가장자리가 흐린 원형이고 새나 비행기는 형태가 또렷하다. " +
      "지운 뒤에도 같은 방법으로 확인한다.",
    permission: "edit",
    inputSchema: RemoveSpotsParamsSchema,
    handler: async (input, context) =>
      engine.execute<RemoveSpotsResult>(
        { type: RETOUCH_REMOVE_SPOTS, params: input },
        { requestId: context.requestId },
      ),
  };
}
