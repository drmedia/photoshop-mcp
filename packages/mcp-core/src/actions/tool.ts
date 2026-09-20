import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition, ToolRegistry } from "@photoshop-mcp/photoshop-bridge";
import { ACTION_PLAY, type ActionPlayResult } from "@photoshop-mcp/photoshop-tools";
import { z } from "zod";
import type { ActionRegistry } from "./registry.js";

/**
 * 선언된 액션 실행. (ROADMAP §17.35)
 *
 * `registerPhotoshopTools` 가 아니라 여기 있는 것은 `ActionRegistry` 가
 * Command Engine 이 아닌 별도 구성 요소이기 때문이다 — Capability · Job ·
 * Workflow Tool 이 분리된 것과 같은 이유다. 선택 인자로 받으면 주지 않았을 때
 * Tool 이 조용히 빠진다.
 */

const ActionRunInputSchema = z
  .object({
    /** `actions.json` 의 키. `photoshop.action.declared` 로 볼 수 있다. */
    name: z.string().trim().min(1).max(100),
  })
  .strict();

const DeclaredInputSchema = z.object({}).strict();

export function registerActionTools(
  registry: ToolRegistry,
  engine: CommandEngine,
  actions: ActionRegistry,
): void {
  const declared: ToolDefinition<Record<string, never>, unknown> = {
    name: "photoshop.action.declared",
    description:
      "actions.json 에 선언되어 **실제로 부를 수 있는** 액션을 조회한다. " +
      "photoshop.action.list 는 Photoshop 에 있는 전부를 보여 주지만 그중 부를 수 있는 것은 여기 있는 것뿐이다. " +
      "description 이 그 액션이 무엇을 하는지 말해 주는 **유일한 단서다** — 이름만으로는 알 수 없다.",
    permission: "read",
    inputSchema: DeclaredInputSchema,
    handler: async () => ({ actions: actions.list(), total: actions.size }),
  };

  const run: ToolDefinition<z.infer<typeof ActionRunInputSchema>, ActionPlayResult> = {
    name: "photoshop.action.run",
    description:
      "actions.json 에 선언된 액션을 실행한다. **선언되지 않은 것은 부를 수 없다.** " +
      "무엇이 선언되어 있는지는 photoshop.action.declared 로 본다. " +
      "**permission 이 destructive 다** — 액션이 무엇을 하는지 알 수 없기 때문이다. " +
      "파일 저장·평탄화·레이어 삭제가 들어 있을 수 있고 이름만으로는 구분되지 않는다. " +
      "기본 허용 밖이라 PHOTOSHOP_MCP_ALLOW 로 켜야 한다. " +
      "액션 안의 대화상자는 끄고 실행하지만 **끄지 못하는 환경이 있다** — " +
      "결과의 dialogsSuppressed 가 false 면 대화상자가 떠서 멈출 수 있다. " +
      "되돌리려면 photoshop.history.undo 를 쓴다 — 액션은 여러 단계일 수 있어 여러 번 필요하다.",
    permission: "destructive",
    inputSchema: ActionRunInputSchema,
    handler: async (input, context) => {
      // 선언에 없으면 여기서 멈춘다. Photoshop 까지 가지 않는다.
      const declaration = actions.require(input.name);
      return engine.execute<ActionPlayResult>(
        { type: ACTION_PLAY, params: { set: declaration.set, action: declaration.action } },
        { requestId: context.requestId },
      );
    },
  };

  registry.register(declared);
  registry.register(run);
}
