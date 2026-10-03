import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  HISTORY_CREATE_SNAPSHOT,
  HISTORY_LIST_SNAPSHOTS,
  HISTORY_RESTORE_SNAPSHOT,
  HistoryCreateSnapshotParamsSchema,
  HistoryListSnapshotsParamsSchema,
  HistoryRestoreSnapshotParamsSchema,
  type HistoryCreateSnapshotParams,
  type HistoryCreateSnapshotResult,
  type HistoryListSnapshotsParams,
  type HistoryListSnapshotsResult,
  type HistoryRestoreSnapshotParams,
  type HistoryRestoreSnapshotResult,
} from "../commands/history-snapshot.js";

/** History 스냅샷 Tool. (ROADMAP §101) */

export function createHistoryCreateSnapshotTool(
  engine: CommandEngine,
): ToolDefinition<HistoryCreateSnapshotParams, HistoryCreateSnapshotResult> {
  return {
    name: "photoshop.history.create_snapshot",
    description:
      "지금 문서 상태에 이름을 붙여 둔다. 변형을 시도하기 전에 걸어 두고 " +
      "photoshop.history.restore_snapshot 으로 그 이름으로 돌아온다 — undo 를 몇 번 눌러야 " +
      "하는지 세지 않아도 된다. " +
      "**Photoshop 의 진짜 스냅샷이다.** History 는 기본 50개까지만 들고 있어서 편집이 쌓이면 " +
      "옛 지점이 사라지지만 스냅샷은 그 한도와 무관하게 문서가 열려 있는 동안 남는다. " +
      "**같은 이름으로 다시 만들면 거절한다** — 덮어쓰면 어디로 돌아가는지 모르게 된다. " +
      "Photoshop 에는 `MCP · <이름>` 으로 붙고, 사용자가 패널에서 만든 스냅샷은 다루지 않는다. " +
      "문서를 바꾸지 않는다(History 항목도 늘지 않는다).",
    permission: "edit",
    inputSchema: HistoryCreateSnapshotParamsSchema,
    handler: async (input, context) =>
      engine.execute<HistoryCreateSnapshotResult>(
        { type: HISTORY_CREATE_SNAPSHOT, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createHistoryRestoreSnapshotTool(
  engine: CommandEngine,
): ToolDefinition<HistoryRestoreSnapshotParams, HistoryRestoreSnapshotResult> {
  return {
    name: "photoshop.history.restore_snapshot",
    description:
      "photoshop.history.create_snapshot 으로 만든 지점으로 돌아간다. " +
      "**이 서버가 만든 스냅샷만** 안다 — 모르는 이름은 아는 이름 목록과 함께 거절한다. " +
      "undo 와 같은 종류라 edit 다. 돌아온 뒤 새로 편집하면 Photoshop 이 그 뒤쪽 이력을 " +
      "버린다(undo 와 같다). " +
      "**결과의 layerIdsMatch 를 본다.** 돌아온 뒤 레이어 id 구성이 만들 때와 같으면 true 다. " +
      "false 면 돌아오지 못했거나 다른 문서다 — Photoshop 이 오류 없이 끝나도 호출자가 직접 " +
      "확인할 수 있게 한다. 스냅샷은 문서마다 따로이고 **활성 문서**의 것을 쓴다.",
    permission: "edit",
    inputSchema: HistoryRestoreSnapshotParamsSchema,
    handler: async (input, context) =>
      engine.execute<HistoryRestoreSnapshotResult>(
        { type: HISTORY_RESTORE_SNAPSHOT, params: input },
        { requestId: context.requestId },
      ),
  };
}

export function createHistoryListSnapshotsTool(
  engine: CommandEngine,
): ToolDefinition<HistoryListSnapshotsParams, HistoryListSnapshotsResult> {
  return {
    name: "photoshop.history.list_snapshots",
    description:
      "이 서버가 활성 문서에 만든 스냅샷을 보여 준다 — 이름, 만들 때의 History 상태, 레이어 수. " +
      "사용자가 패널에서 만든 스냅샷은 나오지 않는다. 서버(플러그인)를 다시 띄우면 기록이 " +
      "사라지므로 Photoshop 에는 남아 있어도 여기서는 안 보인다. 문서를 바꾸지 않는다.",
    permission: "read",
    inputSchema: HistoryListSnapshotsParamsSchema,
    handler: async (input, context) =>
      engine.execute<HistoryListSnapshotsResult>(
        { type: HISTORY_LIST_SNAPSHOTS, params: input },
        { requestId: context.requestId },
      ),
  };
}
