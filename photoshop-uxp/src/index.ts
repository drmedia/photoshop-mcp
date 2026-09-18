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

let statusElement: HTMLElement | null = null;
let errorElement: HTMLElement | null = null;

function renderState(state: ClientState): void {
  const label = STATE_LABEL[state];
  const detail =
    state === "retrying" ? `${label} (${Math.round(client.retryDelayMs / 1000)}초 후)` : label;

  console.log(`[photoshop-mcp] 상태: ${detail}`);

  if (statusElement !== null) {
    statusElement.textContent = detail;
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

/** 패널이 열릴 때 상태 표시 요소를 잡아둔다. */
export function mountPanel(root: HTMLElement): void {
  root.innerHTML = [
    '<div style="padding:12px;font-family:sans-serif;font-size:12px">',
    '<div style="font-weight:600;margin-bottom:6px">Photoshop MCP</div>',
    '<div>Bridge: <span id="photoshop-mcp-state">-</span></div>',
    `<div style="margin-top:6px;opacity:.7;font-size:11px">${client.url}</div>`,
    '<div id="photoshop-mcp-error" style="margin-top:8px;padding:6px;',
    "background:#4a1f1f;color:#ffb4b4;font-size:11px;",
    'word-break:break-all;display:none"></div>',
    "</div>",
  ].join("");
  statusElement = root.querySelector("#photoshop-mcp-state");
  errorElement = root.querySelector("#photoshop-mcp-error");
  renderState(client.state);
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

entrypoints.setup({
  panels: {
    photoshopMcpPanel: {
      create: onPanel,
      show: onPanel,
    },
  },
});

// 플러그인이 로드되면 패널을 열지 않아도 접속을 유지한다.
client.start();

export { client };
