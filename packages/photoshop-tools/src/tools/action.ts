import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";
import {
  ACTION_ALLOWLIST,
  ACTION_LIST,
  ACTION_PLAY,
  ActionAllowlistParamsSchema,
  ActionListParamsSchema,
  type ActionAllowlistResult,
  type ActionListResult,
  type ActionPlayResult,
} from "../commands/action.js";

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

/** `photoshop.action.declared` — 실행이 허용된 액션을 조회한다. (ROADMAP §17.36) */
export function createActionDeclaredTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof ActionAllowlistParamsSchema>, ActionAllowlistResult> {
  return {
    name: "photoshop.action.declared",
    description:
      "**실행이 허용된** 액션을 조회한다. photoshop.action.list 는 Photoshop 에 있는 전부를 " +
      "보여 주지만 부를 수 있는 것은 여기 있는 것뿐이다. " +
      "허용 목록은 **사용자가 Photoshop 패널에서 고른다** — 서버도 LLM 도 고칠 수 없다. " +
      "비어 있으면 photoshop.action.run 이 아무것도 못 한다. " +
      "그때는 사용자에게 **Photoshop MCP 패널의 '액션 선택…' 버튼**을 눌러 달라고 말한다. " +
      "persisted 가 false 면 Photoshop 을 다시 켤 때 선택이 사라진다.",
    permission: "read",
    inputSchema: ActionAllowlistParamsSchema,
    handler: async (input, context) =>
      engine.execute<ActionAllowlistResult>(
        { type: ACTION_ALLOWLIST, params: input },
        { requestId: context.requestId },
      ),
  };
}

const ActionRunInputSchema = z
  .object({
    /** 액션 세트의 **정확한 이름**. */
    set: z.string().trim().min(1).max(255),
    /** 액션의 **정확한 이름**. */
    action: z.string().trim().min(1).max(255),
  })
  .strict();

/** `photoshop.action.run` — 허용된 액션을 실행한다. (ROADMAP §17.36) */
export function createActionRunTool(
  engine: CommandEngine,
): ToolDefinition<z.infer<typeof ActionRunInputSchema>, ActionPlayResult> {
  return {
    name: "photoshop.action.run",
    description:
      "액션을 실행한다. **사용자가 Photoshop 패널에서 허용한 것만 부를 수 있다** — " +
      "허용 목록은 photoshop.action.declared 로 본다. " +
      "**permission 이 destructive 다** — 액션이 무엇을 하는지 알 수 없기 때문이다. " +
      "파일 저장·평탄화·레이어 삭제가 들어 있을 수 있고 이름만으로는 구분되지 않는다. " +
      "기본 허용 밖이라 PHOTOSHOP_MCP_ALLOW 로 켜야 한다. " +
      "**액션 이름은 유일하지 않으므로 set 과 action 을 둘 다 준다.** " +
      "**대화상자를 끄려고 DialogModes.NONE 을 건다** — dialogMode 가 실제로 건 값이고 " +
      "null 이면 못 건 것이다. dialogsSuppressed 가 false 면 대화상자가 떠서 " +
      "플러그인이 멈출 수 있다. " +
      "**건다고 반드시 막히는 것은 아니다** — 거는 데 성공하는 것은 확인했지만, " +
      "뜨려던 대화상자가 실제로 막히는지는 아직 확인되지 않았다. " +
      "액션의 대화상자 토글은 사용자가 꺼 두는 것이 여전히 안전하다. " +
      "되돌리려면 photoshop.history.undo 를 쓴다 — 액션은 여러 단계일 수 있어 여러 번 필요하다.",
    permission: "destructive",
    inputSchema: ActionRunInputSchema,
    handler: async (input, context) =>
      engine.execute<ActionPlayResult>(
        { type: ACTION_PLAY, params: input },
        { requestId: context.requestId },
      ),
  };
}
