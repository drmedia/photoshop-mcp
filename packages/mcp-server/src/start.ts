import type {
  CreatePhotoshopMcpOptions,
  LoadedExtension,
  PhotoshopMcp,
} from "@photoshop-mcp/mcp-core";
import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import type { BridgeTransport, ConnectionState } from "@photoshop-mcp/photoshop-bridge";
import {
  DEFAULT_PORT,
  MockPhotoshopBridge,
  UXPPhotoshopBridge,
  WebSocketBridgeTransport,
} from "@photoshop-mcp/photoshop-bridge";

/** Bridge 선택. */
export type BridgeMode = "uxp" | "mock";

export interface StartOptions extends CreatePhotoshopMcpOptions {
  /**
   * 사용할 Bridge.
   *
   * - `uxp` (기본) — WebSocket 전송 + UXP Plugin. Photoshop 이 없어도 기동한다.
   * - `mock` — {@link MockPhotoshopBridge}. Photoshop 없이 응답을 만든다.
   *
   * `bridge` 를 직접 주입하면 이 값은 무시된다.
   */
  mode?: BridgeMode;
  /** `uxp` 모드에서 사용할 WebSocket 포트. */
  port?: number;
  /** Bridge 연결 상태 변화 알림. */
  onBridgeStateChange?: (state: ConnectionState) => void;
  /**
   * Extension 을 훑을 디렉터리. (ROADMAP §9.2)
   *
   * 생략하면 Extension 을 적재하지 않는다. 디렉터리가 없어도 오류가 아니다.
   * 하나가 잘못되어도 나머지 Extension 과 서버는 계속 기동한다.
   *
   * 서버가 Tool 목록을 노출하기 전에 적재하므로, Extension 의 Tool 도
   * 첫 `tools/list` 응답에 포함된다.
   */
  extensionsDir?: string;
  /**
   * Capability Provider 설정 파일. (ROADMAP §12)
   *
   * 생략하면 외부 처리기를 등록하지 않는다. 파일이 없어도 오류가 아니다 —
   * 외부 처리기가 없는 것은 정상이다.
   */
  capabilityConfig?: string;
  /**
   * 워크플로 설정 파일. (ROADMAP §11)
   *
   * 생략하면 등록하지 않는다. 파일이 없어도 오류가 아니다.
   */
  workflowConfig?: string;
  /**
   * 액션 허용 목록 경로. (ROADMAP §17.35)
   *
   * 없으면 조용히 넘어간다 — 액션을 안 쓰는 것은 정상이다.
   */
  actionConfig?: string;
  /**
   * 사용할 transport. 생략하면 stdio 를 사용한다.
   * 테스트에서 in-memory transport 를 주입할 때 사용한다.
   */
  transport?: Parameters<PhotoshopMcp["server"]["start"]>[0];
}

/** 기동된 서버와, `uxp` 모드일 때 함께 기동된 Bridge 전송. */
export interface StartedPhotoshopMcp extends PhotoshopMcp {
  /** `uxp` 모드에서만 존재한다. `mock` 모드면 `null`. */
  bridgeTransport: BridgeTransport | null;
  /** 적재에 성공한 Extension. `extensionsDir` 를 주지 않았으면 빈 배열. */
  loadedExtensions: LoadedExtension[];
  /** 등록된 Capability Provider 수. */
  loadedProviders: number;
  /** 등록된 워크플로 수. */
  loadedWorkflows: number;
  /** 적재한 액션 선언 수. (ROADMAP §17.35) */
  loadedActions: number;
  /** MCP 서버와 Bridge 전송을 함께 정지한다. */
  stop(): Promise<void>;
}

/**
 * Core 를 조립하고 서버를 기동한다.
 *
 * 프로그램적으로 임베드할 때 사용하는 public API 다.
 * 로그를 출력하거나 `process` 를 건드리지 않는다. 그런 처리는 `run.ts` 의 책임이다.
 */
export async function startPhotoshopMcpServer(
  options: StartOptions = {},
): Promise<StartedPhotoshopMcp> {
  const {
    mode = "uxp",
    port,
    onBridgeStateChange,
    transport,
    extensionsDir,
    capabilityConfig,
    workflowConfig,
    actionConfig,
    ...coreOptions
  } = options;

  let bridgeTransport: BridgeTransport | null = null;
  let bridge = coreOptions.bridge;
  let pendingEvents: ((event: string, payload: unknown) => void) | null = null;

  if (bridge === undefined) {
    if (mode === "mock") {
      bridge = new MockPhotoshopBridge();
    } else {
      // Plugin 이 보낸 이벤트를 받아둘 곳. Core 를 아직 조립하지 않았으므로
      // 나중에 채워 넣는다. 그 전에 온 이벤트는 버린다 — 받을 곳이 없다.
      const wsTransport = new WebSocketBridgeTransport({
        port: port ?? DEFAULT_PORT,
        ...(onBridgeStateChange === undefined ? {} : { onStateChange: onBridgeStateChange }),
        onEvent: (event, payload) => {
          pendingEvents?.(event, payload);
        },
      });
      // Photoshop 이 실행 중이 아니어도 수신 대기는 시작한다. (PROTOCOL.md §1)
      await wsTransport.start();
      bridgeTransport = wsTransport;
      bridge = new UXPPhotoshopBridge(wsTransport);
    }
  }

  const mcp = createPhotoshopMcp({ ...coreOptions, bridge });

  // 이제 받을 곳이 생겼다. 이름 해석은 EventBus 가 한다 —
  // 전송 계층은 이벤트의 의미를 알지 못한다.
  pendingEvents = (event, payload) => {
    mcp.events.emitFromPlugin(event, payload);
  };

  // Extension 이 Capability 를 쓸 수 있으려면 먼저 등록되어 있어야 한다.
  const loadedProviders =
    capabilityConfig === undefined ? 0 : await mcp.capabilities.loadConfig(capabilityConfig);

  // 워크플로는 Tool 을 부르므로 Tool 이 다 등록된 뒤여야 한다.
  const loadedWorkflows =
    workflowConfig === undefined ? 0 : await mcp.workflows.loadConfig(workflowConfig);
  // 액션 허용 목록. 없으면 action.run 이 아무것도 못 한다 — 그것이 기본이다.
  const loadedActions = actionConfig === undefined ? 0 : await mcp.actions.loadConfig(actionConfig);

  // Tool 목록을 노출하기 전에 적재한다.
  const loadedExtensions =
    extensionsDir === undefined ? [] : await mcp.extensions.loadAll(extensionsDir);

  try {
    await mcp.server.start(transport);
  } catch (error) {
    await bridgeTransport?.stop();
    throw error;
  }

  return {
    ...mcp,
    bridgeTransport,
    loadedExtensions,
    loadedProviders,
    loadedWorkflows,
    loadedActions,
    stop: async () => {
      // 진행 중인 Job 을 먼저 취소한다. 그러지 않으면 외부 처리기 프로세스가
      // 서버보다 오래 살고, 결과를 받을 곳도 없이 몇 분씩 CPU 를 먹는다.
      const cancelled = mcp.jobs.cancelAll();
      if (cancelled > 0) {
        mcp.logger.info(`정지 중 Job ${cancelled}개를 취소했습니다.`);
      }
      await mcp.server.stop();
      for (const extension of loadedExtensions) {
        await mcp.extensions.unload(extension.manifest.namespace);
      }
      await bridgeTransport?.stop();
    },
  };
}
