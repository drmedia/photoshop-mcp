import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import type { z } from "zod";
import { ACTION_LIST, ActionListParamsSchema, type ActionListResult } from "../commands/action.js";

/** `photoshop.action.list` — 등록된 액션을 조회한다. (ROADMAP §17.34) */
export function createActionListTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof ActionListParamsSchema>, ActionListResult> {
  return {
    name: "photoshop.action.list",
    description:
      "Photoshop 에 등록된 액션 세트와 액션을 조회한다. **조회만 한다 — 실행하지 않는다.** " +
      "액션은 사용자가 녹화해 둔 것이라 **무엇을 하는지 이름만 보고는 알 수 없다** — " +
      "파일 저장·평탄화·레이어 삭제가 들어 있을 수 있다. " +
      "**액션 이름은 유일하지 않다.** 같은 이름이 여러 세트에 있을 수 있으므로 세트와 함께 읽는다. " +
      "**두 단계로 쓴다** — set 없이 부르면 세트 이름만 주고, 그 이름을 set 에 넣으면 " +
      "그 세트의 액션을 준다. 한 번에 다 읽으면 UXP 왕복이 너무 많아 타임아웃한다.",
    permission: "read",
    inputSchema: ActionListParamsSchema,
    handler: async (input, context) =>
      engine.execute<ActionListResult>(
        { type: ACTION_LIST, params: input },
        { requestId: context.requestId },
      ),
  };
}
