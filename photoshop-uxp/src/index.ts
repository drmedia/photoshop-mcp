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
import { gaussianBlur, highPass, minimumMaximum } from "./dom/filter.js";
import {
  adjustmentHueSaturation,
  adjustmentColorBalance,
  adjustmentVibrance,
  layerFromBackground,
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
import { layerGetActive, layerList } from "./dom/layers.js";
import { captureDocument, captureLayer, captureSelection } from "./dom/capture.js";
import { documentCrop } from "./dom/document-crop.js";
import { documentRotate } from "./dom/document-rotate.js";
import { documentTilt } from "./dom/document-tilt.js";
import { documentClose, documentFlatten } from "./dom/document-lifecycle.js";
import { smartObjectConvert } from "./dom/smart-object.js";
import { dodgeBurnDab } from "./dom/dodge-burn.js";
import { maskDab, paintDab } from "./dom/paint.js";
import { fontList, textCreate, textSet } from "./dom/text.js";
import { actionList } from "./dom/action.js";
import { actionPlay } from "./dom/action-play.js";
import { actionAllowlist } from "./dom/action-allowlist.js";
import { extensionRegistry } from "./dom/extension-registry.js";
import { openActionPicker } from "./panel/action-picker.js";
import { shortenPath } from "./panel/path-label.js";
import { openExtensionPicker } from "./panel/extension-picker.js";
import { documentOpen } from "./dom/document-open.js";
import { layerReorder } from "./dom/layer-reorder.js";
import { documentStatistics } from "./dom/document-statistics.js";
import { cameraRawApply } from "./dom/camera-raw.js";
import { layerDelete } from "./dom/layer-delete.js";
import { retouchRemoveSpots } from "./dom/retouch.js";
import { maskGradient } from "./dom/mask-gradient.js";
import { selectionSky, selectionSubject } from "./dom/selection-auto.js";
import {
  layerStampVisible,
  selectionColorRange,
  selectionLoadChannel,
  selectionModify,
  selectionSaveChannel,
} from "./dom/selection-ops.js";
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
  disconnected: "Disconnected",
  connecting: "Connecting",
  handshaking: "Handshaking",
  connected: "Connected",
  retrying: "Retrying",
};

/** Command 등록. Command 추가 시 이 함수만 수정한다. (ARCHITECTURE §12) */
export function createDispatcher(): CommandDispatcher {
  const dispatcher = new CommandDispatcher();

  // Phase 1 — 조회
  dispatcher.register("DOCUMENT_GET", async () => documentGet());
  dispatcher.register("LAYER_LIST", async () => layerList());
  dispatcher.register("LAYER_GET_ACTIVE", async () => layerGetActive());
  dispatcher.register("SELECTION_SKY", async () => selectionSky());
  dispatcher.register("SELECTION_SUBJECT", async () => selectionSubject());
  dispatcher.register("LAYER_DELETE", async (p) =>
    layerDelete(p as Parameters<typeof layerDelete>[0]),
  );
  dispatcher.register("CAMERA_RAW_APPLY", async (p) =>
    cameraRawApply(p as Parameters<typeof cameraRawApply>[0]),
  );
  dispatcher.register("RETOUCH_REMOVE_SPOTS", async (p) =>
    retouchRemoveSpots(p as Parameters<typeof retouchRemoveSpots>[0]),
  );
  dispatcher.register("DOCUMENT_STATISTICS", async (p) =>
    documentStatistics(p as Parameters<typeof documentStatistics>[0]),
  );
  dispatcher.register("DOCUMENT_CROP", async (p) =>
    documentCrop(p as Parameters<typeof documentCrop>[0]),
  );
  dispatcher.register("DOCUMENT_ROTATE", async (p) =>
    documentRotate(p as Parameters<typeof documentRotate>[0]),
  );
  dispatcher.register("MEASURE_TILT", async (p) =>
    documentTilt(p as Parameters<typeof documentTilt>[0]),
  );
  dispatcher.register("LAYER_REORDER", async (p) =>
    layerReorder(p as Parameters<typeof layerReorder>[0]),
  );
  dispatcher.register("DOCUMENT_OPEN", async (p) =>
    documentOpen(p as Parameters<typeof documentOpen>[0]),
  );
  dispatcher.register("DODGE_BURN_DAB", async (p) =>
    dodgeBurnDab(p as Parameters<typeof dodgeBurnDab>[0]),
  );
  // 허용 목록 조회. 선택 자체는 Command 가 아니다 — 패널 모달에서만 할 수 있고
  // 서버는 사용자를 대신해 고를 수 없다. (작업 폴더 승인과 같은 자리)
  dispatcher.register("ACTION_ALLOWLIST", async () => actionAllowlist());
  dispatcher.register("EXTENSION_REGISTRY", async () => extensionRegistry());
  dispatcher.register("ACTION_PLAY", async (p) =>
    actionPlay(p as Parameters<typeof actionPlay>[0]),
  );
  dispatcher.register("ACTION_LIST", async (p) =>
    actionList(p as Parameters<typeof actionList>[0]),
  );
  dispatcher.register("TEXT_CREATE", async (p) =>
    textCreate(p as Parameters<typeof textCreate>[0]),
  );
  dispatcher.register("TEXT_SET", async (p) => textSet(p as Parameters<typeof textSet>[0]));
  dispatcher.register("FONT_LIST", async () => fontList());
  dispatcher.register("PAINT_DAB", async (p) => paintDab(p as Parameters<typeof paintDab>[0]));
  dispatcher.register("MASK_DAB", async (p) => maskDab(p as Parameters<typeof maskDab>[0]));
  dispatcher.register("SMART_OBJECT_CONVERT", async (p) =>
    smartObjectConvert(p as Parameters<typeof smartObjectConvert>[0]),
  );
  dispatcher.register("DOCUMENT_FLATTEN", async () => documentFlatten());
  dispatcher.register("DOCUMENT_CLOSE", async (p) =>
    documentClose(p as Parameters<typeof documentClose>[0]),
  );
  dispatcher.register("CAPTURE_DOCUMENT", async (p) =>
    captureDocument(p as Parameters<typeof captureDocument>[0]),
  );
  dispatcher.register("CAPTURE_LAYER", async (p) =>
    captureLayer(p as Parameters<typeof captureLayer>[0]),
  );
  dispatcher.register("CAPTURE_SELECTION", async (p) =>
    captureSelection(p as Parameters<typeof captureSelection>[0]),
  );
  dispatcher.register("SELECTION_SAVE_CHANNEL", async (p) =>
    selectionSaveChannel(p as { name: string }),
  );
  dispatcher.register("SELECTION_LOAD_CHANNEL", async (p) =>
    selectionLoadChannel(p as { name: string; invert?: boolean }),
  );
  dispatcher.register("SELECTION_MODIFY", async (p) =>
    selectionModify(p as Parameters<typeof selectionModify>[0]),
  );
  dispatcher.register("SELECTION_COLOR_RANGE", async (p) =>
    selectionColorRange(p as Parameters<typeof selectionColorRange>[0]),
  );
  dispatcher.register("LAYER_STAMP_VISIBLE", async (p) =>
    layerStampVisible(p as { name?: string }),
  );
  dispatcher.register("MASK_GRADIENT", async (p) =>
    maskGradient(p as Parameters<typeof maskGradient>[0]),
  );
  dispatcher.register("LAYER_FROM_BACKGROUND", async (p) =>
    layerFromBackground(p as { name?: string }),
  );
  dispatcher.register("ADJUSTMENT_COLOR_BALANCE", async (p) =>
    adjustmentColorBalance(p as Parameters<typeof adjustmentColorBalance>[0]),
  );
  dispatcher.register("FILTER_HIGH_PASS", async (p) =>
    highPass(p as { layerId?: number; radius: number; asSmartFilter?: boolean }),
  );
  dispatcher.register("FILTER_MINIMUM_MAXIMUM", async (p) =>
    minimumMaximum(p as Parameters<typeof minimumMaximum>[0]),
  );

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
/** 액션 수 · Extension 수를 한 요소에 적는다. UXP 가 flex `gap` 을 무시한다. */
let countsElement: HTMLElement | null = null;
let urlElement: HTMLElement | null = null;

/**
 * 패널 조작이 낸 오류. Bridge 오류와 **같은 박스**에 낸다.
 *
 * 예전에는 상태 줄에 써 넣었는데, 바로 뒤따르는 `render*()` 가 같은 틱에
 * 덮어써서 **사용자가 볼 수 없었다.** 오류를 낸다고 적어 두고 안 내는 것이
 * 안 내는 것보다 나쁘다 — 그 자리를 다시 보지 않게 된다.
 */
let panelError: string | null = null;

/** 오류 박스를 다시 그린다. 패널 조작 오류가 Bridge 오류보다 앞선다. */
function renderError(): void {
  if (errorElement === null) {
    return;
  }
  const message = panelError ?? client.lastError;
  errorElement.textContent = message ?? "";
  errorElement.style.display = message === null ? "none" : "block";
}

/** 패널 조작을 감싼다. 성공하면 앞선 오류를 지운다. */
function afterAction(run: () => Promise<unknown>, redraw: () => void): void {
  void run()
    .then(() => {
      panelError = null;
    })
    .catch((error: unknown) => {
      panelError = describeError(error);
    })
    .then(() => {
      redraw();
      renderError();
    });
}

function renderState(state: ClientState): void {
  const label = STATE_LABEL[state];
  const detail =
    state === "retrying" ? `${label} (in ${Math.round(client.retryDelayMs / 1000)}s)` : label;

  console.log(`[photoshop-mcp] state: ${detail}`);

  // 연결되면 구독 상태를 다시 보낸다. 로드 시점에는 보낼 곳이 없었다.
  if (state === "connected" && notificationStatus !== null) {
    client.sendEvent(notificationStatus.event, notificationStatus.payload);
  }

  if (statusElement !== null) {
    /* **상태와 주소를 나눈다.** 한 줄에 합쳤더니 좁은 패널에서 줄 하나를 다
     * 먹었다. 상태는 짧고 자주 보고, 주소는 길고 가끔 본다. */
    statusElement.textContent = `${state === "connected" ? "●" : "○"} ${detail}`;
    statusElement.style.color =
      state === "connected" ? "#5aa469" : state === "retrying" ? "#e8a33d" : "";
  }
  if (urlElement !== null) {
    /* 연결되면 주소는 알 필요가 없다. 막혔을 때만 진단에 쓰인다 —
     * 좁은 패널에서 한 줄이 아깝다. */
    urlElement.textContent = client.url;
    urlElement.style.display = state === "connected" ? "none" : "block";
  }
  // 접속 실패 사유를 패널에 그대로 노출한다.
  // UXP Developer Tool 콘솔을 열지 않고도 원인을 확인할 수 있어야 한다.
  renderError();
}

const client = createClient();

/**
 * 액션 수와 등록된 Extension 수를 한 줄에 그린다.
 *
 * 액션 0 이면 `action.run` 이 아무것도 못 한다 — 그것이 기본이라는 것을 보여준다.
 *
 * **Extension 수는 등록 수지 적재 수가 아니다.** 서버가 namespace 충돌 등으로
 * 거부해도 여기는 줄지 않는다. 적재 결과는 `photoshop.diagnostics` 가 안다.
 */
async function renderCounts(): Promise<void> {
  if (countsElement === null) {
    return;
  }
  const parts: string[] = [];
  try {
    parts.push(`Actions ${String((await actionAllowlist()).total)}`);
  } catch (error) {
    parts.push(`Actions ?(${describeError(error)})`);
  }
  try {
    const status = await extensionRegistry();
    parts.push(`Extensions ${String(status.total)}${status.persisted ? "" : " (session)"}`);
  } catch (error) {
    parts.push(`Extensions ?(${describeError(error)})`);
  }
  countsElement.textContent = parts.join(" · ");
}

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
    /* **앞을 자른다.** CSS `ellipsis` 는 뒤를 자르는데 경로에서 구분되는
     * 정보는 끝이다. `shortenPath` 가 앞을 줄이고, 그래도 넘치면 CSS 가
     * 한 번 더 줄인다. */
    workspaceElement.textContent = status.approved
      ? `Folder: ${status.path === null ? "(no path)" : shortenPath(status.path)}`
      : "Folder: not approved";
  } catch (error) {
    workspaceElement.textContent = `Folder check failed: ${describeError(error)}`;
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
  /* **flex 골격에 고정 footer.**
   *
   * 내용이 늘어도 버튼이 밀려나지 않는다. 패널을 줄이면 가운데만 스크롤된다.
   * `absolute` 를 쓰지 않는 이유는 그러면 스크롤 영역과 겹치기 때문이다.
   *
   * `min-height:0` 이 핵심이다 — 없으면 flex 자식이 내용만큼 커져서
   * 부모를 넘고 footer 가 화면 밖으로 밀린다.
   *
   * `100vh` 대신 `100%` 를 쓴다. 패널은 문서 전체가 아니라 호스트가 준
   * 요소 안이고, `%` 는 동작이 확인된 쪽이다. */
  root.style.cssText =
    "height:100vh;min-height:0;display:flex;flex-direction:column;" +
    "font-family:sans-serif;font-size:11px";

  /* **`<sp-action-button>` 을 쓴다.** plain `<button>` 은 "스타일링 부담을
   * 직접 진다" 고 UXP 문서가 명시하는데 실기에서 그 대가를 치렀다 —
   * `min-width:0` 으로 줄지 않아 2글자짜리가 90px 을 먹었고, 폭을 명시하니
   * 이번에는 글자가 잘렸다(`폴더 승인` → `폴더...`).
   *
   * **`gap` 은 쓸 수 없다.** UXP CSS 지원 목록에 `gap`·`row-gap`·`column-gap`
   * 이 셋 다 없다. 간격은 margin 으로 준다. */
  /* `cursor` 는 UXP CSS 지원 목록에 **없다.** 다만 알려진 문제에 "커서를
   * 바꾸면 원래대로 돌아오지 않을 수 있다(UWP)" 가 있어 바꿀 수는 있는
   * 모양이다. 실기로 재 본다 — 눌어붙으면 빼는 것이 낫다. */
  const BTN = "margin:0 6px 0 0;font-size:11px;cursor:pointer";

  /** 한 줄에 다 안 들어가면 꼬리를 자른다. 줄바꿈으로 높이가 늘지 않게. */
  const ELLIPSIS = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

  root.innerHTML = [
    /* header — 줄어들지 않는다.
     *
     * Bridge 상태는 가장 자주 보는 것인데, 스크롤되는 쪽에 두었더니 패널을
     * 줄였을 때 위로 밀려 안 보였다. 실기 캡처에서 확인했다. */
    '<div style="flex-shrink:0;padding:6px 6px 0">',
    '<span id="photoshop-mcp-state">-</span>',
    // UXP 에 `gap` 이 없다. 간격은 margin 으로 준다.
    /* **`nowrap` 을 준다.** 영어로 바꾸니 헤더가 길어져 `Actions 1 ·` 에서
     * 끊겼다 — 한 문장이 두 줄로 쪼개지면 읽는 사람이 한 번 멈춘다. 이걸로
     * 넓으면 상태 옆에 붙고 좁으면 통째로 다음 줄로 내려간다. */
    '<span id="photoshop-mcp-counts" style="margin-left:6px;white-space:nowrap;',
    'color:var(--uxp-host-text-color-secondary, #b0b0b0)"></span>',
    "</div>",
    /* 내용 — 늘어나고 스크롤된다.
     *
     * **짧고 늘 필요한 것은 header 에 있다.** Bridge 상태와 액션·확장 수는
     * 한 줄에 들어가고 길이가 변하지 않는다. 여기 남는 것은 길이를 알 수 없는
     * 폴더 경로와 오류다 — 그래서 이쪽이 스크롤된다.
     *
     * 주소는 거의 늘 `ws://127.0.0.1:8765` 라 볼 일이 없다. 연결이 안 됐을
     * 때만 낸다 — 좁은 패널에서 한 줄이 아깝다. */
    '<div style="flex:1;min-height:0;overflow-y:auto;padding:0 6px 6px">',
    '<div id="photoshop-mcp-workspace" style="',
    `${ELLIPSIS}">Folder: checking…</div>`,
    `<div id="photoshop-mcp-url" style="margin-top:3px;display:none;`,
    `color:var(--uxp-host-text-color-secondary, #b0b0b0);${ELLIPSIS}"></div>`,
    /* 오류는 길어질 수 있으므로 스크롤되는 쪽에 둔다.
     * 색으로 눈에 띄어야 하지만 테마가 넷이라 글자색은 변수로 둔다. */
    '<div id="photoshop-mcp-error" style="margin-top:5px;padding:4px;',
    "background:#a33;color:var(--uxp-host-text-color, #e8e8e8);",
    'word-break:break-all;display:none"></div>',
    "</div>",
    // footer — 줄어들지 않는다. 패널을 아무리 줄여도 버튼은 남는다.
    '<div style="flex-shrink:0;display:flex;flex-wrap:wrap;padding:5px 6px;',
    'border-top:1px solid var(--uxp-host-border-color, #6a6a6a)">',
    `<sp-action-button size="s" id="photoshop-mcp-approve" style="${BTN}">Folder…</sp-action-button>`,
    `<sp-action-button size="s" id="photoshop-mcp-actions" style="${BTN}">Actions</sp-action-button>`,
    `<sp-action-button size="s" id="photoshop-mcp-extensions" style="${BTN}">Extensions</sp-action-button>`,
    "</div>",
  ].join("");

  statusElement = root.querySelector("#photoshop-mcp-state");
  urlElement = root.querySelector("#photoshop-mcp-url");
  countsElement = root.querySelector("#photoshop-mcp-counts");
  errorElement = root.querySelector("#photoshop-mcp-error");
  workspaceElement = root.querySelector("#photoshop-mcp-workspace");

  root.querySelector("#photoshop-mcp-approve")?.addEventListener("click", () => {
    afterAction(approveFolder, () => void renderWorkspace());
  });
  root.querySelector("#photoshop-mcp-actions")?.addEventListener("click", () => {
    afterAction(openActionPicker, () => void renderCounts());
  });
  root.querySelector("#photoshop-mcp-extensions")?.addEventListener("click", () => {
    afterAction(openExtensionPicker, () => void renderCounts());
  });

  refreshPanel();
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

/**
 * 이미 꾸며 둔 루트.
 *
 * **`show` 에서 다시 만들지 않는다.** `entrypoints` 는 `create` 와 `show` 양쪽에
 * 같은 함수를 걸 수 있는데, `show` 마다 `innerHTML` 을 다시 쓰면 **클릭이 시작된
 * 요소가 사라져 첫 클릭이 먹지 않는다.** 실기에서 "처음 버튼이 한 번에 안 된다"
 * 로 드러났다.
 *
 * 다시 만드는 대신 값만 새로 고친다.
 */
let mountedRoot: HTMLElement | null = null;

function onPanel(arg: unknown): void {
  const root = resolveRoot(arg);
  if (root === null) {
    return;
  }
  if (root === mountedRoot) {
    // 이미 꾸며져 있다. 값만 새로 고친다 — 그 사이 폴더나 액션이 바뀌었을 수 있다.
    refreshPanel();
    return;
  }
  mountPanel(root);
  mountedRoot = root;
}

/** 패널의 값만 다시 읽는다. DOM 은 건드리지 않는다. */
function refreshPanel(): void {
  renderState(client.state);
  void renderWorkspace();
  void renderCounts();
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
    afterAction(approveFolder, () => void renderWorkspace());
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
        { id: MENU_APPROVE, label: "Approve output folder…" },
        { id: MENU_REVOKE, label: "Revoke output folder" },
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
  console.error(`[photoshop-mcp] notification subscription failed: ${describeError(error)}`);
}

export { client };
