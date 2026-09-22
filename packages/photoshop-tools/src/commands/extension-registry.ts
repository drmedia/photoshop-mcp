import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 등록된 Extension 조회. (ROADMAP §18.3)
 *
 * **기본은 "아무 패널도 안 깔려 있다" 다.** 사용자가 PhotoshopMCP 패널에서 고른
 * 것만 붙는다 — GraXpert 를 안 쓰는 사람에게 `gx.*` 가 보이면 무엇이 이 서버의
 * 능력인지 흐려진다.
 *
 * 목록은 플러그인의 `localStorage` 에 있다. 서버의 cwd 는 MCP 클라이언트가
 * 정해 우리가 통제할 수 없으므로 **플러그인이 경로를 알려 준다.** 작업 폴더
 * 승인(§8.5) · 액션 허용 목록(§17.36) 과 같은 자리다.
 *
 * `read` 다. 목록을 보는 것은 적재가 아니다.
 */

export const EXTENSION_REGISTRY = "EXTENSION_REGISTRY";

export const ExtensionRegistryParamsSchema = z.object({}).strict();
export type ExtensionRegistryParams = z.infer<typeof ExtensionRegistryParamsSchema>;

export const ExtensionRegistryResultSchema = z.object({
  extensions: z.array(
    z.object({
      /** 적재할 디렉터리. `extension.json` 이 이 안에 있다. */
      path: z.string(),
      addedAt: z.number(),
    }),
  ),
  total: z.number().int().nonnegative(),
  /** `localStorage` 에 남았는지. `false` 면 Photoshop 재시작 때 사라진다. */
  persisted: z.boolean(),
});

export type ExtensionRegistryResult = z.infer<typeof ExtensionRegistryResultSchema>;

export const extensionRegistryCommand: CommandHandler<
  ExtensionRegistryParams,
  ExtensionRegistryResult
> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = ExtensionRegistryResultSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "Extension 목록이 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
