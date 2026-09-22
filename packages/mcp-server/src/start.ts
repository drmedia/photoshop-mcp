import { join } from "node:path";
import type {
  CreatePhotoshopMcpOptions,
  LoadedExtension,
  PhotoshopMcp,
} from "@photoshop-mcp/mcp-core";
import { createPhotoshopMcp } from "@photoshop-mcp/mcp-core";
import type { BridgeTransport, ConnectionState } from "@photoshop-mcp/photoshop-bridge";
import {
  DEFAULT_PORT,
  isTerminal,
  MockPhotoshopBridge,
  UXPPhotoshopBridge,
  WebSocketBridgeTransport,
} from "@photoshop-mcp/photoshop-bridge";
import { planPanelExtensionSync } from "./panel-extensions.js";

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
   * 적재할 Extension namespace. 생략하면 디렉터리에 있는 것을 **전부** 적재한다.
   *
   * 번들된 Extension 은 Core 가 아니다 — `example` 은 예제이고 나머지는 특정
   * 도구용이다. 쓰지 않는 사람에게 Tool 목록에 보이면 무엇이 이 서버의 능력인지
   * 흐려진다.
   */
  enabledExtensions?: readonly string[];
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
    enabledExtensions,
    capabilityConfig,
    workflowConfig,
    ...coreOptions
  } = options;

  let bridgeTransport: BridgeTransport | null = null;
  let bridge = coreOptions.bridge;
  let pendingEvents: ((event: string, payload: unknown) => void) | null = null;

  /**
   * Bridge 가 붙었을 때 부를 곳. Core 를 아직 조립하지 않아 나중에 채운다.
   * (`pendingEvents` 와 같은 지연 연결)
   */
  let pendingConnected: (() => void) | null = null;

  /**
   * **수신 대기를 나중에 시작한다.**
   *
   * 예전에는 Bridge 전송을 만들자마자 열었다. 그러면 Core 를 조립하는 동안
   * 이미 열려 있던 Photoshop 패널이 붙을 수 있고, 그 사이에 온 것은 받을
   * 곳이 없어 사라진다. 이벤트 하나가 사라지는 것은 그나마 넘어갈 수 있지만
   * `connected` 를 놓치면 **사용자가 패널에서 등록한 Extension 이 붙지 않고
   * 그 이유도 어디에도 안 보인다**(ROADMAP §18.3).
   *
   * 걸쇠를 두는 대신 문을 늦게 연다. 놓칠 틈이 없어야 놓쳤는지 따질 일도 없다.
   */
  let openBridge: (() => Promise<void>) | null = null;

  /**
   * 붙어 있는 Plugin 이 등록한 Command 목록. 핸드셰이크가 싣고 온다.
   * Mock 모드나 주입된 Bridge 에는 없으므로 `null` 이다.
   */
  let pluginCommands: (() => string[] | null) | null = null;

  if (bridge === undefined) {
    if (mode === "mock") {
      bridge = new MockPhotoshopBridge();
    } else {
      // Plugin 이 보낸 것을 받아둘 곳. Core 를 아직 조립하지 않았으므로
      // 나중에 채워 넣는다. 그 전에는 열지 않으므로 놓치는 것도 없다.
      const wsTransport = new WebSocketBridgeTransport({
        port: port ?? DEFAULT_PORT,
        onStateChange: (state) => {
          onBridgeStateChange?.(state);
          if (state === "connected") {
            pendingConnected?.();
          }
        },
        onEvent: (event, payload) => {
          pendingEvents?.(event, payload);
        },
      });
      bridgeTransport = wsTransport;
      bridge = new UXPPhotoshopBridge(wsTransport);
      // Photoshop 이 실행 중이 아니어도 수신 대기는 시작한다. (PROTOCOL.md §1)
      // 다만 받을 곳이 다 준비된 뒤다 — 위 `openBridge` 참조.
      openBridge = async () => {
        await wsTransport.start();
      };
      pluginCommands = () => wsTransport.plugin?.commands ?? null;
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

  // Tool 목록을 노출하기 전에 적재한다.
  const loadedExtensions =
    extensionsDir === undefined
      ? []
      : await mcp.extensions.loadAll(extensionsDir, enabledExtensions);

  /* **사용자가 패널에서 등록한 Extension 을 Bridge 가 붙은 뒤 적재한다.**
   * (ROADMAP §18.3)
   *
   * 기본은 "아무 패널도 안 깔려 있다" 다. 저장소에 넣어 두면 그것을 안 쓰는
   * 사람에게도 Tool 이 보인다. 사용자가 설치하고 패널에서 고른 것만 붙인다.
   *
   * 기동 시점에는 물어볼 수 없다 — Bridge 는 서버가 뜬 뒤에 붙는다. 그래서
   * `tools/list_changed` 가 필요했다(§18.3).
   *
   * **재연결마다 다시 적재하지 않는다.** Photoshop 이 끊겼다 붙으면 이 콜백이
   * 다시 오는데, 이미 적재한 것을 또 넣으면 namespace 충돌로 거부된다.
   *
   * **빠진 것은 해제한다.** 한동안 추가만 했더니 패널에서 제거해도 돌고 있는
   * 서버에는 그대로 남았다 — 문서에는 "짝이 맞는다" 고 적혀 있었는데 아니었다.
   * 무엇을 적재하고 무엇을 해제할지는 `planPanelExtensionSync` 가 정한다. */
  const loadedFromPanel = new Map<string, string>();
  pendingConnected = () => {
    void (async () => {
      /* **지원한다고 말한 것만 묻는다.**
       *
       * 옛 플러그인에는 이 Command 가 없다. 그냥 불러 보고 실패를 삼키면
       * Command Engine 이 붙을 때마다 경고를 한 줄씩 낸다 — 정상 동작인데
       * 무언가 잘못된 것처럼 보이고, 진짜 경고가 그 사이에 묻힌다.
       *
       * 핸드셰이크가 이미 목록을 싣고 온다(PROTOCOL.md §3.2). 짐작할 일이 아니다. */
      const supported = pluginCommands?.();
      if (
        supported !== null &&
        supported !== undefined &&
        !supported.includes("EXTENSION_REGISTRY")
      ) {
        return;
      }

      let registry: { extensions: { path: string }[] };
      try {
        registry = await mcp.engine.execute<{ extensions: { path: string }[] }>({
          type: "EXTENSION_REGISTRY",
          params: {},
        });
      } catch (error) {
        /* 목록이 있다고 했는데 실패했다면 그것은 알려야 한다. 위에서 없는
         * 경우는 이미 걸러졌으므로 여기 오는 것은 진짜 문제다. */
        mcp.logger.warn(
          "등록된 Extension 목록을 읽지 못했습니다 — " +
            (error instanceof Error ? error.message : String(error)),
        );
        return;
      }

      const plan = planPanelExtensionSync(
        registry.extensions.map((entry) => entry.path),
        loadedFromPanel,
      );

      for (const directory of plan.load) {
        try {
          const loaded = await mcp.extensions.load({
            directory,
            manifestPath: join(directory, "extension.json"),
          });
          /* **성공한 뒤에 표시한다.** 실패했으면 적재된 것이 없으므로 다음
           * 연결에서 다시 시도하는 것이 맞다. 미리 표시하면 한 번의 실패가
           * 세션 끝까지 굳는다. */
          loadedFromPanel.set(directory, loaded.manifest.namespace);
          mcp.logger.info(
            `패널에서 등록한 Extension 적재: ${loaded.manifest.name} (${loaded.manifest.namespace})`,
          );
        } catch (error) {
          /* **실패를 조용히 넘기지 않는다.** 사용자는 패널에서 등록했는데
           * Tool 이 안 붙는 이유를 알 수 없다. namespace 충돌이 가장 흔하다. */
          mcp.logger.warn(
            `패널에서 등록한 Extension 적재 실패: ${directory} — ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }

      for (const { path, namespace } of plan.unload) {
        /* **도는 Job 이 있으면 미룬다. 취소하지 않는다.**
         *
         * Job 은 이미 `owner` 를 들고 있으므로 물어볼 수 있다. 패널에서 버튼
         * 하나 눌렀다고 70초짜리 외부 처리기를 죽이는 것은 과하다 — 그 작업의
         * 결과를 기다리는 사람이 있고, 취소하면 중간 파일만 남는다.
         *
         * 미뤄도 잃는 것이 없다. 다음 연결에서 다시 본다. */
        const live = mcp.jobs.list({ owner: namespace }).filter((job) => !isTerminal(job.state));
        if (live.length > 0) {
          mcp.logger.warn(
            `Extension 해제를 미룹니다: ${namespace} — Job ${String(live.length)}개가 아직 돌고 있습니다.`,
          );
          continue;
        }

        try {
          await mcp.extensions.unload(namespace);
          loadedFromPanel.delete(path);
          mcp.logger.info(`패널에서 제거한 Extension 해제: ${namespace}`);
        } catch (error) {
          /* 해제에 실패하면 표시를 지우지 않는다. 지웠는데 Tool 이 남아 있으면
           * 다음 연결에서 다시 적재하려다 namespace 충돌로 거부된다. */
          mcp.logger.warn(
            `Extension 해제 실패: ${namespace} — ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }
    })();
  };

  // 받을 곳이 모두 준비되었다. 이제 연다. (위 `openBridge` 참조)
  try {
    await openBridge?.();
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
