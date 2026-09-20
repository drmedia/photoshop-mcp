import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 액션 조회. (ROADMAP §17.34)
 *
 * ## 조회와 실행을 나눈다
 *
 * 액션은 사용자가 녹화해 둔 것이라 LLM 이 내용을 만들지 못한다 — 그 점에서는
 * Capability(§19)와 같다. 그러나 **무엇을 하는지 알 수 없다.**
 *
 * 실기에서 본 목록에 이미 `내보내기 > PSD로 저장` 이 있었다. 승인된 작업 폴더
 * 밖으로 파일을 쓴다. 액션 안에 평탄화·레이어 삭제·스크립트 실행이 들어 있어도
 * 이름만 보고는 알 수 없다.
 *
 * 그래서 **조회는 열고 실행은 선언된 것만** 한다. 이 Command 는 조회다.
 *
 * ## 이름은 유일하지 않다
 *
 * 실기에서 `B and C Landscape` 가 `TK9 Blend If actions` 와 `TK9 actions`
 * 양쪽에 있었다. 세트와 함께 읽어야 한다.
 *
 * ## 두 단계로 나눈다
 *
 * UXP 는 속성 하나마다 Photoshop 으로 왕복한다. 액션까지 한 번에 읽으려다
 * **두 번 타임아웃했다.** `set` 을 주지 않으면 세트 이름만 준다.
 */

export const ACTION_LIST = "ACTION_LIST";
export const ACTION_PLAY = "ACTION_PLAY";
export const ACTION_ALLOWLIST = "ACTION_ALLOWLIST";

export const ActionListParamsSchema = z
  .object({
    /**
     * 액션까지 볼 세트의 **정확한 이름**.
     *
     * 생략하면 세트 이름만 준다 — **액션까지 읽으면 왕복이 너무 많아
     * 타임아웃한다.** 실기에서 두 번 겪었다(§17.34).
     *
     * 먼저 생략해서 세트를 보고, 그 이름을 그대로 넣는다.
     */
    set: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export type ActionListParams = z.infer<typeof ActionListParamsSchema>;

/**
 * **`index` 는 담지 않는다.**
 *
 * UXP 는 속성 하나마다 Photoshop 으로 왕복한다. 액션이 91개인 기기에서
 * 세 속성을 읽었더니 15초 타임아웃이 났다. 게다가 순번은 사용자가 액션을
 * 옮기면 바뀌어 키로 쓸 수도 없다.
 */
const ActionSchema = z.object({
  name: z.string(),
  /** Photoshop 이 붙인 식별자. */
  id: z.number().int(),
});

export const ActionListResultSchema = z.object({
  sets: z.array(
    z.object({
      name: z.string(),
      id: z.number().int(),
      /** `set` 을 주지 않으면 비어 있다. */
      actions: z.array(ActionSchema),
    }),
  ),
  totalSets: z.number().int(),
});

export type ActionListResult = z.infer<typeof ActionListResultSchema>;

export const actionListCommand: CommandHandler<ActionListParams, ActionListResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = ActionListResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "액션 목록이 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }

  return parsed.data;
};

/**
 * 액션 실행. (ROADMAP §17.35)
 *
 * ## **permission 은 `destructive` 다**
 *
 * 액션이 무엇을 하는지 알 수 없다. 실기 목록에 `내보내기 > PSD로 저장` 이 있었고
 * 평탄화·레이어 삭제·`.jsx` 실행이 들어 있어도 이름만으로는 모른다.
 *
 * 모르는 것을 `edit` 으로 두면 조용히 경계를 넘는다. `window.capture` 가
 * 찍는 것이 문서가 아니라 화면이라 `external` 인 것과 같은 판단이다(§17.11).
 *
 * 기본 허용(`read` · `edit`) 밖이라 **꺼져 있는 것이 기본**이고
 * `PHOTOSHOP_MCP_ALLOW` 로 켠다.
 *
 * ## 어느 액션을 부를 수 있는지는 따로 정한다
 *
 * 이 Command 는 세트·액션 이름을 그대로 받는다. **무엇을 부를 수 있는가**는
 * `actions.json` 이 정하고 `photoshop.action.run` 이 강제한다 —
 * Capability 가 `capabilities.json` 으로 실행 파일을 가두는 것과 같다(§19).
 */
export const ActionPlayParamsSchema = z
  .object({
    /** 액션 세트의 **정확한 이름**. */
    set: z.string().trim().min(1).max(255),
    /** 액션의 **정확한 이름**. */
    action: z.string().trim().min(1).max(255),
  })
  .strict();

export type ActionPlayParams = z.infer<typeof ActionPlayParamsSchema>;

export const ActionPlayResultSchema = z.object({
  set: z.string(),
  action: z.string(),
  /**
   * 대화상자를 실제로 껐는지.
   *
   * **끄지 못했는데 껐다고 말하지 않는다.** `false` 면 액션 안의 대화상자가
   * 뜰 수 있고, 뜨면 플러그인이 멈춘다.
   */
  dialogsSuppressed: z.boolean(),
  durationMs: z.number().int(),
});

export type ActionPlayResult = z.infer<typeof ActionPlayResultSchema>;

export const actionPlayCommand: CommandHandler<ActionPlayParams, ActionPlayResult> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = ActionPlayResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "액션 실행 결과가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};

/**
 * 허용 목록 조회. (ROADMAP §17.36)
 *
 * 선택은 **Photoshop 패널 모달에서만** 한다 — 액션은 Photoshop 안에 있고
 * 고를 수 있는 것은 사용자뿐이다. 작업 폴더 승인(§8.5)이 패널 버튼에서만
 * 되는 것과 같은 자리다.
 *
 * 서버는 선택을 보관하지 않고 **부를 때마다 물어본다.** 기동 시 한 번 읽으면
 * 사용자가 패널에서 바꾼 것이 반영되지 않는다.
 */
export const ActionAllowlistParamsSchema = z.object({}).strict();

export type ActionAllowlistParams = z.infer<typeof ActionAllowlistParamsSchema>;

export const ActionAllowlistResultSchema = z.object({
  actions: z.array(z.object({ set: z.string(), action: z.string() })),
  total: z.number().int(),
  /**
   * 플러그인 `localStorage` 에 남았는지.
   *
   * `false` 면 Photoshop 을 다시 켤 때 선택이 사라진다. **남았다고 말하고
   * 안 남는 것이 가장 나쁘다.**
   */
  persisted: z.boolean(),
});

export type ActionAllowlistResult = z.infer<typeof ActionAllowlistResultSchema>;

export const actionAllowlistCommand: CommandHandler<
  ActionAllowlistParams,
  ActionAllowlistResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = ActionAllowlistResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "허용 목록이 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
