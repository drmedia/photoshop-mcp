import { z } from "zod";

/**
 * 액션 허용 목록. (ROADMAP §17.35)
 *
 * ## 권한이 아니라 **목록**이다
 *
 * 액션은 무엇을 하는지 알 수 없으므로 실행은 언제나 `destructive` 다.
 * 이 파일이 정하는 것은 그보다 앞의 질문 — **어느 것을 부를 수 있는가** 다.
 * `capabilities.json` 이 실행 파일을 가두는 것과 같은 자리다(§19).
 *
 * 레벨을 액션마다 선언하게 하지 않은 것은, 선언이 **사실일 보장이 없기**
 * 때문이다. 액션 안을 읽을 수 없는데 `edit` 이라고 적으면 그것은 희망이지
 * 사실이 아니다. 이 프로젝트는 모르는 것을 그럴듯한 값으로 덮지 않는다.
 *
 * ## 이름은 유일하지 않다
 *
 * 실기에서 `B and C Landscape` 가 두 세트에 있었다(§17.34). `set` 과 `action`
 * 둘 다 있어야 한 액션이 정해진다.
 */

export const ActionDeclarationSchema = z
  .object({
    /** 액션 세트의 **정확한 이름**. `photoshop.action.list` 로 확인한다. */
    set: z.string().trim().min(1).max(255),
    /** 액션의 **정확한 이름**. */
    action: z.string().trim().min(1).max(255),
    /**
     * 이 액션이 무엇을 하는지.
     *
     * **LLM 이 읽는 유일한 단서다.** 이름만으로는 파일을 쓰는지 레이어를
     * 지우는지 알 수 없다.
     */
    description: z.string().trim().min(1).max(500),
    /**
     * 오래 걸리면 `true`.
     *
     * MCP 기본 요청 타임아웃이 60초다(§14). 외부 플러그인을 부르는 액션은
     * 그보다 오래 걸린다 — 실기에서 StarNet2 가 67초였다.
     */
    longRunning: z.boolean().optional(),
  })
  .strict();

export type ActionDeclaration = z.infer<typeof ActionDeclarationSchema>;

/** `actions.json` 전체. 키가 호출자가 쓰는 이름이다. */
export const ActionConfigSchema = z.record(
  z.string().trim().min(1).max(100),
  ActionDeclarationSchema,
);

export type ActionConfig = z.infer<typeof ActionConfigSchema>;
