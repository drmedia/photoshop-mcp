import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * History 스냅샷. (ROADMAP §101)
 *
 * `history.undo` 는 한 칸씩만 간다. 변형을 시도하고 이름으로 돌아오려면 몇 번 눌러야 하는지
 * 세어야 하는데, 실기에서 그 셈이 여러 번 어긋났다. 스냅샷은 지금 상태에 이름을 붙여 두고
 * 그 이름으로 돌아온다.
 *
 * ## Photoshop 의 **진짜 스냅샷**을 쓴다
 *
 * History 항목을 기억해 두는 방법은 쓰지 않았다. Photoshop 은 History 를 50개(기본)까지만
 * 들고 있어서 편집이 몇십 번 쌓이면 기억해 둔 지점이 사라진다 — 보정 한 번이면 흔히 넘는다.
 * 스냅샷은 그 한도와 무관하게 문서가 열려 있는 동안 남는다.
 *
 * ## 이름은 우리가 만든 것만 안다
 *
 * 사용자가 패널에서 만든 스냅샷과 이름이 겹치면 어느 쪽으로 돌아갈지 알 수 없다. 그래서 Photoshop
 * 에는 `MCP · <이름>` 으로 만들고, 이 Tool 들은 **자기가 만든 것만** 다룬다.
 */

export const HISTORY_CREATE_SNAPSHOT = "HISTORY_CREATE_SNAPSHOT";
export const HISTORY_RESTORE_SNAPSHOT = "HISTORY_RESTORE_SNAPSHOT";
export const HISTORY_LIST_SNAPSHOTS = "HISTORY_LIST_SNAPSHOTS";

/** 스냅샷 이름. 앞뒤 공백과 개행을 허용하지 않는다 — 같은 이름이 둘로 보이는 것을 막는다. */
const SnapshotNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => value === value.trim() && !/[\r\n]/u.test(value), {
    message: "이름의 앞뒤 공백과 줄바꿈은 허용하지 않습니다.",
  });

export const HistoryCreateSnapshotParamsSchema = z.object({ name: SnapshotNameSchema }).strict();
export type HistoryCreateSnapshotParams = z.infer<typeof HistoryCreateSnapshotParamsSchema>;

export const HistoryRestoreSnapshotParamsSchema = z.object({ name: SnapshotNameSchema }).strict();
export type HistoryRestoreSnapshotParams = z.infer<typeof HistoryRestoreSnapshotParamsSchema>;

export const HistoryListSnapshotsParamsSchema = z.object({}).strict();
export type HistoryListSnapshotsParams = z.infer<typeof HistoryListSnapshotsParamsSchema>;

const SnapshotEntrySchema = z.object({
  name: z.string(),
  /** 만들 때의 History 상태 이름. 어느 편집 직후인지 알아보는 용도다. */
  historyState: z.string(),
  /** 만들 때의 레이어 수. 돌아온 뒤 구성이 같은지 볼 때 쓴다. */
  layerCount: z.number().int(),
});

export const HistoryCreateSnapshotResultSchema = SnapshotEntrySchema.extend({
  documentId: z.number().int(),
  /** Photoshop 에 실제로 붙은 이름. 패널에서 이 이름으로 보인다. */
  photoshopName: z.string(),
});
export type HistoryCreateSnapshotResult = z.infer<typeof HistoryCreateSnapshotResultSchema>;

export const HistoryRestoreSnapshotResultSchema = z.object({
  name: z.string(),
  documentId: z.number().int(),
  /** 돌아온 뒤의 History 상태 이름. */
  currentState: z.string(),
  /**
   * 돌아온 뒤 레이어 id 구성이 스냅샷을 만들 때와 같은가.
   *
   * **`false` 면 돌아오지 못했거나 다른 문서다.** Photoshop 이 오류 없이 끝났어도 호출자가 직접
   * 확인할 수 있게 둔다 — 안 했는데 했다고 말하지 않는다.
   */
  layerIdsMatch: z.boolean(),
});
export type HistoryRestoreSnapshotResult = z.infer<typeof HistoryRestoreSnapshotResultSchema>;

export const HistoryListSnapshotsResultSchema = z.object({
  documentId: z.number().int(),
  snapshots: z.array(SnapshotEntrySchema),
});
export type HistoryListSnapshotsResult = z.infer<typeof HistoryListSnapshotsResultSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, type: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new PhotoshopMcpError(
      ErrorCode.PROTOCOL_ERROR,
      `Plugin 응답이 스키마를 만족하지 않습니다: ${type}`,
      { details: { command: type, issues: parsed.error.issues, received: raw } },
    );
  }
  return parsed.data;
}

export const historyCreateSnapshotCommand: CommandHandler<
  HistoryCreateSnapshotParams,
  HistoryCreateSnapshotResult
> = async (command, context) =>
  parseOrThrow(
    HistoryCreateSnapshotResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    command.type,
  );

export const historyRestoreSnapshotCommand: CommandHandler<
  HistoryRestoreSnapshotParams,
  HistoryRestoreSnapshotResult
> = async (command, context) =>
  parseOrThrow(
    HistoryRestoreSnapshotResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    command.type,
  );

export const historyListSnapshotsCommand: CommandHandler<
  HistoryListSnapshotsParams,
  HistoryListSnapshotsResult
> = async (command, context) =>
  parseOrThrow(
    HistoryListSnapshotsResultSchema,
    await context.bridge.executeCommand<unknown>(command),
    command.type,
  );
