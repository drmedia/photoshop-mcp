/**
 * Photoshop MCP UXP Plugin bootstrap.
 *
 * 이 플러그인은 Photoshop MCP 의 실행 Agent 다. MCP 로직을 포함하지 않는다.
 * (ARCHITECTURE §11)
 *
 * 역할:
 *   1. Command Dispatcher 구성
 *   2. MCP Server 로 WebSocket 접속 및 재접속
 *   3. 연결 상태 패널 표시
 */
import { entrypoints, host } from "uxp";
import { CommandDispatcher } from "./dispatcher/dispatcher.js";
import {
  adjustmentBrightnessContrast,
  adjustmentCurves,
  adjustmentLevels,
} from "./dom/adjustment.js";
import { documentGet } from "./dom/document.js";
import { gaussianBlur } from "./dom/filter.js";
import {
  adjustmentHueSaturation,
  adjustmentVibrance,
  layerBlendMode,
  selectionSet,
} from "./dom/gap-tools.js";
import {
  maskCreate,
  maskDisable,
  maskEnable,
  selectionClear,
  selectionInvert,
} from "./dom/mask-selection.js";
import { groupCreate, groupMoveLayer } from "./dom/group.js";
import { historyUndo } from "./dom/history.js";
import {
  layerCreate,
  layerDuplicate,
  layerOpacity,
  layerRename,
  layerSelect,
  layerVisibility,
} from "./dom/layer-edit.js";
import { layerList } from "./dom/layers.js";
import { startNotifications } from "./dom/notifications.js";
import { historyList, selectionGet } from "./dom/state-read.js";
import { workspaceDelete, workspaceUsage } from "./dom/workspace-files.js";
import { layerPlace } from "./dom/place.js";
import { documentExport, documentSave, documentSaveAs } from "./dom/save.js";
import { approveFolder, revokeFolder, workspaceStatus } from "./dom/workspace.js";
import { BridgeClient, type ClientState } from "./transport/ws-client.js";

const PLUGIN = { name: "photoshop-mcp-uxp", version: "0.1.0" };

/** PROTOCOL.md §1 기본 엔드포인트. */
const DEFAULT_URL = "ws://127.0.0.1:8765";

const STATE_LABEL: Record<ClientState, string> = {
  disconnected: "연결 끊김",
  connecting: "접속 중",
  handshaking: "핸드셰이크 중",
  connected: "연결됨",
  retrying: "재시도 대기",
};

/** Command 등록. Command 추가 시 이 함수만 수정한다. (ARCHITECTURE §12) */
export function createDispatcher(): CommandDispatcher {
  const dispatcher = new CommandDispatcher();

  // Phase 1 — 조회
  dispatcher.register("DOCUMENT_GET", async () => documentGet());
  dispatcher.register("LAYER_LIST", async () => layerList());

  // Phase 3 — 레이어 편집 (비파괴)
  // payload 는 Server 의 Command Engine 이 이미 검증했다. (ARCHITECTURE §3.2)
  dispatcher.register("LAYER_CREATE", async (p) => layerCreate(p as { name?: string }));
  dispatcher.register("LAYER_DUPLICATE", async (p) =>
    layerDuplicate(p as { layerId?: number; name?: string }),
  );
  dispatcher.register("LAYER_RENAME", async (p) =>
    layerRename(p as { layerId?: number; name: string }),
  );
  dispatcher.register("LAYER_SELECT", async (p) => layerSelect(p as { layerId: number }));
  dispatcher.register("LAYER_VISIBILITY", async (p) =>
    layerVisibility(p as { layerId?: number; visible: boolean }),
  );
  dispatcher.register("LAYER_OPACITY", async (p) =>
    layerOpacity(p as { layerId?: number; opacity: number }),
  );

  // Phase 3 — 그룹
  dispatcher.register("GROUP_CREATE", async (p) =>
    groupCreate(p as { name?: string; layerIds?: number[] }),
  );
  dispatcher.register("GROUP_MOVE_LAYER", async (p) =>
    groupMoveLayer(p as { layerId: number; groupId: number | null }),
  );

  // Phase 3 — History
  dispatcher.register("HISTORY_UNDO", async () => historyUndo());

  // Phase 4 — 조정 레이어 (비파괴)
  dispatcher.register("ADJUSTMENT_CURVES", async (p) =>
    adjustmentCurves(p as Parameters<typeof adjustmentCurves>[0]),
  );
  dispatcher.register("ADJUSTMENT_LEVELS", async (p) =>
    adjustmentLevels(p as Parameters<typeof adjustmentLevels>[0]),
  );
  dispatcher.register("ADJUSTMENT_BRIGHTNESS_CONTRAST", async (p) =>
    adjustmentBrightnessContrast(p as Parameters<typeof adjustmentBrightnessContrast>[0]),
  );

  // Phase 4 — 마스크 · 선택 영역
  dispatcher.register("MASK_CREATE", async (p) =>
    maskCreate(p as Parameters<typeof maskCreate>[0]),
  );
  dispatcher.register("MASK_ENABLE", async (p) => maskEnable(p as { layerId?: number }));
  dispatcher.register("MASK_DISABLE", async (p) => maskDisable(p as { layerId?: number }));
  dispatcher.register("SELECTION_CLEAR", async () => selectionClear());
  dispatcher.register("SELECTION_INVERT", async () => selectionInvert());

  // Phase 4 — 필터 (기본 스마트 필터)
  dispatcher.register("FILTER_GAUSSIAN_BLUR", async (p) =>
    gaussianBlur(p as Parameters<typeof gaussianBlur>[0]),
  );

  // ROADMAP 8.6
  dispatcher.register("LAYER_BLEND_MODE", async (p) =>
    layerBlendMode(p as Parameters<typeof layerBlendMode>[0]),
  );
  dispatcher.register("SELECTION_SET", async (p) =>
    selectionSet(p as Parameters<typeof selectionSet>[0]),
  );
  dispatcher.register("ADJUSTMENT_HUE_SATURATION", async (p) =>
    adjustmentHueSaturation(p as Parameters<typeof adjustmentHueSaturation>[0]),
  );
  dispatcher.register("ADJUSTMENT_VIBRANCE", async (p) =>
    adjustmentVibrance(p as Parameters<typeof adjustmentVibrance>[0]),
  );

  // Phase 9 — 파일 저장 (ROADMAP §8.5)
  //
  // 폴더 승인 자체는 Command 가 아니다. getFolder() 가 사용자 제스처를 요구하므로
  // 패널 버튼에서만 할 수 있다. 서버는 승인을 대신할 수 없다.
  dispatcher.register("WORKSPACE_STATUS", async () => workspaceStatus());
  dispatcher.register("DOCUMENT_SAVE_AS", async (p) =>
    documentSaveAs(p as Parameters<typeof documentSaveAs>[0]),
  );
  dispatcher.register("DOCUMENT_EXPORT", async (p) =>
    documentExport(p as Parameters<typeof documentExport>[0]),
  );
  dispatcher.register("DOCUMENT_SAVE", async () => documentSave());

  // 외부 처리 결과를 Photoshop 으로 되돌리는 길. (Phase 8 과 짝을 이룬다)
  dispatcher.register("LAYER_PLACE", async (p) =>
    layerPlace(p as Parameters<typeof layerPlace>[0]),
  );

  // ROADMAP §17 — 임시 파일 관리
  dispatcher.register("WORKSPACE_USAGE", async (p) =>
    workspaceUsage(p as Parameters<typeof workspaceUsage>[0]),
  );
  dispatcher.register("WORKSPACE_DELETE", async (p) =>
    workspaceDelete(p as Parameters<typeof workspaceDelete>[0]),
  );

  // ROADMAP §16 — MCP Resource 를 뒷받침하는 읽기
  dispatcher.register("SELECTION_GET", async () => selectionGet());
  dispatcher.register("HISTORY_LIST", async () => historyList());

  return dispatcher;
}

export function createClient(url: string = DEFAULT_URL): BridgeClient {
  return new BridgeClient({
    url,
    dispatcher: createDispatcher(),
    plugin: PLUGIN,
    host: { app: "PS", version: host?.version ?? "unknown" },
    onStateChange: renderState,
    log: (message) => {
      console.log(`[photoshop-mcp] ${message}`);
    },
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let statusElement: HTMLElement | null = null;
let errorElement: HTMLElement | null = null;
let workspaceElement: HTMLElement | null = null;

function renderState(state: ClientState): void {
  const label = STATE_LABEL[state];
  const detail =
    state === "retrying" ? `${label} (${Math.round(client.retryDelayMs / 1000)}초 후)` : label;

  console.log(`[photoshop-mcp] 상태: ${detail}`);

  // 연결되면 구독 상태를 다시 보낸다. 로드 시점에는 보낼 곳이 없었다.
  if (state === "connected" && notificationStatus !== null) {
    client.sendEvent(notificationStatus.event, notificationStatus.payload);
  }

  if (statusElement !== null) {
    // URL 을 같은 줄에 합친다. 도킹된 패널은 줄 하나가 아깝다.
    statusElement.textContent = `Bridge: ${detail} · ${client.url}`;
  }
  // 접속 실패 사유를 패널에 그대로 노출한다.
  // UXP Developer Tool 콘솔을 열지 않고도 원인을 확인할 수 있어야 한다.
  if (errorElement !== null) {
    const message = client.lastError;
    errorElement.textContent = message ?? "";
    errorElement.style.display = message === null ? "none" : "block";
  }
}

const client = createClient();

/**
 * 작업 폴더 상태를 패널에 그린다.
 *
 * 승인은 여기서만 할 수 있다. `getFolder()` 가 사용자 제스처를 요구하므로
 * 서버가 소켓으로 띄울 수 없다. (ROADMAP §8.5)
 */
async function renderWorkspace(): Promise<void> {
  if (workspaceElement === null) {
    return;
  }
  try {
    const status = await workspaceStatus();
    workspaceElement.textContent = status.approved
      ? `저장 폴더: ${status.path ?? "(경로 없음)"}`
      : "저장 폴더: 승인되지 않음";
  } catch (error) {
    workspaceElement.textContent = `저장 폴더 확인 실패: ${describeError(error)}`;
  }
}

/**
 * 패널이 열릴 때 상태 표시 요소를 잡아둔다.
 *
 * 도킹된 패널은 사용자가 높이를 늘리지 못하는 경우가 있다. 내용이 잘리면 '폴더 승인'
 * 버튼에 닿을 수 없으므로, 루트를 스크롤 가능하게 만들고 줄 수를 최소로 유지한다.
 * 패널 탭에 이미 이름이 있으므로 제목 줄을 두지 않는다.
 */
export function mountPanel(root: HTMLElement): void {
  root.style.height = "100%";
  root.style.overflow = "auto";

  // 가장 중요한 것을 맨 위에 둔다. 도킹된 패널은 아래가 잘릴 수 있는데
  // 사용자가 높이를 못 늘리는 경우가 있다. 승인 버튼은 항상 닿을 수 있어야 한다.
  root.innerHTML = [
    '<div style="padding:8px;font-family:sans-serif;font-size:11px">',
    // 1행 — 승인 버튼
    "<div>",
    '<button id="photoshop-mcp-approve" style="font-size:11px">저장 폴더 승인</button>',
    '<button id="photoshop-mcp-revoke" style="font-size:11px;margin-left:4px">해제</button>',
    "</div>",
    // 2행 — 승인된 경로
    '<div id="photoshop-mcp-workspace" style="margin-top:6px;opacity:.85;',
    'word-break:break-all">저장 폴더: 확인 중</div>',
    // 3행 — Bridge 상태
    '<div id="photoshop-mcp-state" style="margin-top:6px;opacity:.85">-</div>',
    // 4행 — 오류. 길어질 수 있으므로 맨 아래에 둔다.
    '<div id="photoshop-mcp-error" style="margin-top:6px;padding:4px;',
    'background:#4a1f1f;color:#ffb4b4;word-break:break-all;display:none"></div>',
    "</div>",
  ].join("");

  statusElement = root.querySelector("#photoshop-mcp-state");
  errorElement = root.querySelector("#photoshop-mcp-error");
  workspaceElement = root.querySelector("#photoshop-mcp-workspace");

  root.querySelector("#photoshop-mcp-approve")?.addEventListener("click", () => {
    void approveFolder()
      .catch((error: unknown) => {
        if (workspaceElement !== null) {
          workspaceElement.textContent = `승인 실패: ${describeError(error)}`;
        }
        return null;
      })
      .then(() => renderWorkspace());
  });
  root.querySelector("#photoshop-mcp-revoke")?.addEventListener("click", () => {
    revokeFolder();
    void renderWorkspace();
  });

  renderState(client.state);
  void renderWorkspace();
}

/**
 * UXP 버전에 따라 패널 콜백이 루트 노드를 직접 주기도 하고
 * `{ node }` 형태로 주기도 한다. 양쪽을 받아들인다.
 */
function resolveRoot(arg: unknown): HTMLElement | null {
  if (arg instanceof HTMLElement) {
    return arg;
  }
  if (typeof arg === "object" && arg !== null && "node" in arg) {
    const node = (arg as { node: unknown }).node;
    return node instanceof HTMLElement ? node : null;
  }
  return null;
}

function onPanel(arg: unknown): void {
  const root = resolveRoot(arg);
  if (root !== null) {
    mountPanel(root);
  }
}

/**
 * 패널 플라이아웃 메뉴(≡) 항목.
 *
 * 도킹된 패널은 높이를 사용자가 못 늘리는 경우가 있어 버튼이 잘린다.
 * 메뉴는 패널 공간을 쓰지 않으므로 항상 닿을 수 있다.
 * 메뉴 클릭도 사용자 제스처라 `getFolder()` 를 띄울 수 있다.
 */
const MENU_APPROVE = "approveWorkspaceFolder";
const MENU_REVOKE = "revokeWorkspaceFolder";

function onMenu(id: string): void {
  if (id === MENU_APPROVE) {
    void approveFolder()
      .then((status) => {
        console.log(
          `[photoshop-mcp] ${status === null ? "폴더 승인 취소됨" : `폴더 승인: ${status.path ?? ""}`}`,
        );
      })
      .catch((error: unknown) => {
        console.error(`[photoshop-mcp] 폴더 승인 실패: ${describeError(error)}`);
        if (workspaceElement !== null) {
          workspaceElement.textContent = `승인 실패: ${describeError(error)}`;
        }
      })
      .then(() => renderWorkspace());
    return;
  }
  if (id === MENU_REVOKE) {
    revokeFolder();
    void renderWorkspace();
  }
}

entrypoints.setup({
  panels: {
    photoshopMcpPanel: {
      create: onPanel,
      show: onPanel,
      menuItems: [
        { id: MENU_APPROVE, label: "저장 폴더 승인…" },
        { id: MENU_REVOKE, label: "저장 폴더 승인 해제" },
      ],
      invokeMenu: onMenu,
    },
  },
});

// 플러그인이 로드되면 패널을 열지 않아도 접속을 유지한다.
client.start();

/**
 * 알림 구독 상태. 연결되면 서버로 보낸다.
 *
 * 구독은 플러그인 로드 직후 실행되는데 그때는 아직 WebSocket 연결 전이다.
 * 그대로 보내면 버려지고, 왜 알림이 안 오는지 알 수 없게 된다.
 */
let notificationStatus: { event: string; payload: unknown } | null = null;

// Photoshop 동작 알림을 서버로 흘린다. (ROADMAP §15)
// 실패해도 Bridge 는 계속 동작해야 하므로 감싼다 — 알림은 부가 기능이다.
try {
  startNotifications((event, payload) => {
    if (event.startsWith("photoshop.notifications.")) {
      notificationStatus = { event, payload };
      client.sendEvent(event, payload);
      return;
    }
    client.sendEvent(event, payload);
  });
} catch (error) {
  notificationStatus = {
    event: "photoshop.notifications.unavailable",
    payload: { reason: describeError(error), phase: "startup" },
  };
  console.error(`[photoshop-mcp] 알림 구독 실패: ${describeError(error)}`);
}

export { client };
