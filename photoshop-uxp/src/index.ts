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
import { documentGet } from "./dom/document.js";
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
};

/** Command 등록. Command 추가 시 이 함수만 수정한다. (ARCHITECTURE §12) */
export function createDispatcher(): CommandDispatcher {
  const dispatcher = new CommandDispatcher();
  dispatcher.register("DOCUMENT_GET", async () => documentGet());
  dispatcher.register("LAYER_LIST", async () => layerList());
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

function renderState(state: ClientState): void {
  const label = STATE_LABEL[state];
  console.log(`[photoshop-mcp] 상태: ${label}`);
  if (statusElement !== null) {
    statusElement.textContent = label;
  }
}

const client = createClient();

/** 패널이 열릴 때 상태 표시 요소를 잡아둔다. */
export function mountPanel(root: HTMLElement): void {
  root.innerHTML = [
    '<div style="padding:12px;font-family:sans-serif;font-size:12px">',
    '<div style="font-weight:600;margin-bottom:6px">Photoshop MCP</div>',
    '<div>Bridge: <span id="photoshop-mcp-state">-</span></div>',
    `<div style="margin-top:6px;opacity:.7;font-size:11px">${DEFAULT_URL}</div>`,
    "</div>",
  ].join("");
  statusElement = root.querySelector("#photoshop-mcp-state");
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
