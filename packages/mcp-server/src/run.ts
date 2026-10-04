/**
 * CLI 부트스트랩.
 *
 * 프로세스 수준의 관심사만 다룬다: 환경 변수 읽기, 시작 로그, 종료 시그널 처리,
 * 치명적 오류의 종료 코드.
 *
 * Tool 등록이나 Command Engine 구성 같은 조립은 `@photoshop-mcp/mcp-core` 가 담당하고,
 * 기동은 {@link startPhotoshopMcpServer} 가 담당한다.
 *
 * `stdout` 은 MCP stdio 전송이 점유하므로 로그는 반드시 `stderr` 로 출력한다.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_PORT,
  PORT_CANDIDATES,
  PermissionPolicy,
  parsePermissionLevels,
} from "@photoshop-mcp/photoshop-bridge";
import { parseToolProfile, type ToolProfile } from "@photoshop-mcp/mcp-core";
import { listBlockers } from "@photoshop-mcp/photoshop-tools";
import { findPortHolder, isPortInUse, portConflictMessage } from "./port-holder.js";
import { startPhotoshopMcpServer, type BridgeMode, type StartOptions } from "./start.js";

const STATE_LABEL: Record<string, string> = {
  disconnected: "연결 끊김",
  handshaking: "hello 대기",
  awaiting_ready: "ready 대기",
  connected: "연결됨",
};

function log(message: string): void {
  console.error(`[photoshop-mcp] ${message}`);
}

/**
 * 환경 변수에서 실행 옵션을 읽는다.
 *
 * - `PHOTOSHOP_MCP_PORT` — Bridge WebSocket 포트를 **고정**한다. 생략하면 8765 부터 빈 포트를 찾는다
 * - `PHOTOSHOP_MCP_BRIDGE` — `uxp` (기본) 또는 `mock`
 * - `PHOTOSHOP_MCP_EXTENSIONS` — Extension 디렉터리 (기본 `<cwd>/extensions`)
 * - `PHOTOSHOP_MCP_EXTENSIONS_ENABLED` — 적재할 namespace. 생략하면 전부,
 *   `none` 또는 빈 문자열이면 하나도 안 함
 * - `PHOTOSHOP_MCP_ALLOW` — 허용할 Permission Level (기본 `read,edit`)
 * - `PHOTOSHOP_MCP_PROFILE` — `tools/list` 에 보일 Tool 의 범위. `full`(기본) ·
 *   `retouch`(보정에 쓰는 것만) · `readonly`(조회만). 보이는 것만 줄이고 권한은 그대로다
 * - `PHOTOSHOP_MCP_CAPABILITIES` — 외부 처리기 설정 (기본 `<cwd>/capabilities.json`)
 * - `PHOTOSHOP_MCP_WORKFLOWS` — 워크플로 설정 (기본 `<cwd>/workflows.json`)
 */
export function readOptionsFromEnv(env: Record<string, string | undefined> = process.env): {
  mode: BridgeMode;
  port: number;
  /** 사용자가 포트를 정했는가. 아니면 서버가 `PORT_CANDIDATES` 개까지 빈 포트를 찾는다. */
  portPinned: boolean;
  extensionsDir: string;
  enabledExtensions: readonly string[] | undefined;
  capabilityConfig: string;
  workflowConfig: string;
  policy: PermissionPolicy;
  toolProfile: ToolProfile;
} {
  const mode: BridgeMode = env["PHOTOSHOP_MCP_BRIDGE"] === "mock" ? "mock" : "uxp";

  const rawPort = env["PHOTOSHOP_MCP_PORT"];
  const parsed = rawPort === undefined ? Number.NaN : Number.parseInt(rawPort, 10);
  const port = Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;

  if (rawPort !== undefined && port !== parsed) {
    log(`PHOTOSHOP_MCP_PORT 값이 올바르지 않습니다: ${rawPort} — 기본값 ${DEFAULT_PORT} 사용`);
  }
  const portPinned = rawPort !== undefined && port === parsed;
  /* **범위 밖으로 고정하면 Plugin 이 못 찾는다.** Plugin 은 8765 부터 PORT_CANDIDATES 개만 훑는다
   * (ROADMAP §93). 0(임의 포트)은 테스트용이라 말하지 않는다. */
  if (portPinned && port !== 0 && (port < DEFAULT_PORT || port >= DEFAULT_PORT + PORT_CANDIDATES)) {
    log(
      `PHOTOSHOP_MCP_PORT ${String(port)} 는 Plugin 이 찾는 범위(${String(DEFAULT_PORT)}~` +
        `${String(DEFAULT_PORT + PORT_CANDIDATES - 1)}) 밖입니다 — Photoshop 이 붙지 못합니다`,
    );
  }

  // 디렉터리가 없으면 조용히 건너뛴다. Extension 이 없는 것은 정상이다.
  const extensionsDir = resolve(env["PHOTOSHOP_MCP_EXTENSIONS"] ?? "extensions");

  /* 값을 주면 그것이 **전체 목록**이다. `PHOTOSHOP_MCP_ALLOW` 와 같은 규칙이다.
   *
   * 빈 문자열은 "하나도 적재하지 않는다" 다 — 생략(전부)과 구분한다. Core 만
   * 있는 서버를 만들 수 있어야 한다.
   *
   * **`none` 도 같은 뜻으로 받는다.** 빈 문자열만으로는 부족하다 — 실기에서
   * VS Code 를 거치자 빈 문자열 환경변수가 사라져 `undefined` 가 되었고,
   * "전부 적재" 로 떨어져 Extension 넷이 다 붙었다. 클라이언트가 빈 값을
   * 어떻게 다루는지는 우리가 통제할 수 없다.
   *
   * `PHOTOSHOP_MCP_ALLOW` 가 `none` 을 받는 것과 같은 이유이자 같은 낱말이다. */
  const rawEnabled = env["PHOTOSHOP_MCP_EXTENSIONS_ENABLED"];
  const enabledExtensions =
    rawEnabled === undefined
      ? undefined
      : rawEnabled.trim().toLowerCase() === "none"
        ? []
        : rawEnabled
            .split(",")
            .map((name) => name.trim())
            .filter((name) => name.length > 0);

  // 값을 주면 그것이 **전체 목록**이다. 기존 기본값에 더하지 않는다.
  // 그래야 `PHOTOSHOP_MCP_ALLOW=read` 로 읽기 전용 서버를 만들 수 있다.
  const { levels, unknown } = parsePermissionLevels(env["PHOTOSHOP_MCP_ALLOW"]);
  if (unknown.length > 0) {
    // 오타 때문에 권한이 빠진 것을 조용히 넘기지 않는다.
    log(`PHOTOSHOP_MCP_ALLOW 에 알 수 없는 값이 있습니다: ${unknown.join(", ")} — 무시합니다`);
  }

  // 모르는 값은 `full` 로 떨어뜨리되 알린다 — 오타로 목록이 줄거나 늘어난 것을 못 보면 안 된다.
  const { profile: toolProfile, unknown: unknownProfile } = parseToolProfile(
    env["PHOTOSHOP_MCP_PROFILE"],
  );
  if (unknownProfile !== null) {
    log(
      `PHOTOSHOP_MCP_PROFILE 값을 모릅니다: ${unknownProfile} — full 로 띄웁니다 ` +
        "(full · retouch · readonly)",
    );
  }

  // 파일이 없으면 조용히 넘어간다. 외부 처리기가 없는 것은 정상이다.
  const capabilityConfig = resolve(env["PHOTOSHOP_MCP_CAPABILITIES"] ?? "capabilities.json");

  const workflowConfig = resolve(env["PHOTOSHOP_MCP_WORKFLOWS"] ?? "workflows.json");

  return {
    mode,
    port,
    portPinned,
    extensionsDir,
    enabledExtensions,
    capabilityConfig,
    workflowConfig,
    policy: new PermissionPolicy(levels),
    toolProfile,
  };
}

/** CLI 진입점. 오류를 스스로 처리하며 예외를 던지지 않는다. */
export async function main(): Promise<void> {
  const {
    mode,
    port,
    portPinned,
    extensionsDir,
    enabledExtensions,
    capabilityConfig,
    workflowConfig,
    policy,
    toolProfile,
  } = readOptionsFromEnv();

  const options: StartOptions = {
    mode,
    port,
    portCount: portPinned ? 1 : PORT_CANDIDATES,
    extensionsDir,
    ...(enabledExtensions === undefined ? {} : { enabledExtensions }),
    capabilityConfig,
    workflowConfig,
    policy,
    profile: toolProfile,
    onBridgeStateChange: (state) => {
      log(`Bridge: ${STATE_LABEL[state] ?? state}`);
    },
  };

  try {
    const mcp = await startPhotoshopMcpServer(options);

    const names = mcp.tools
      .list()
      .map((tool) => tool.name)
      .join(", ");
    const bridgeLabel =
      mode === "mock"
        ? "Mock Bridge"
        : `UXP Bridge (ws://127.0.0.1:${String(mcp.bridgePort ?? port)} 대기 중)`;
    /* **부모 PID 를 남긴다.** 프로세스가 남은 것을 나중에 발견했을 때
     * "부모가 살아 있는가" 를 바로 볼 수 있어야 고아인지 아닌지 갈린다.
     * 실기에서 셋이 남았는데 그때 이 값이 없어 원인을 못 좁혔다. */
    log(`stdio 서버 시작. ${bridgeLabel} · pid ${process.pid} ← ${process.ppid}`);
    log(`Tool ${mcp.tools.size}개: ${names}`);
    log(`허용 권한: ${policy.allowed.join(", ") || "(없음)"}`);
    if (toolProfile !== "full") {
      log(`Tool 프로필: ${toolProfile} — tools/list 에 일부만 보입니다 (PHOTOSHOP_MCP_PROFILE)`);
    }
    if (mcp.loadedProviders > 0) {
      log(`외부 처리기 ${mcp.loadedProviders}개: ${mcp.capabilities.list().join(", ")}`);
    }
    if (mcp.loadedWorkflows > 0) {
      log(
        `워크플로 ${mcp.loadedWorkflows}개: ${mcp.workflows
          .list()
          .map((w) => w.id)
          .join(", ")}`,
      );
    }
    if (mcp.loadedExtensions.length > 0) {
      const extensionNames = mcp.loadedExtensions
        .map((extension) => `${extension.manifest.name}(${extension.manifest.namespace})`)
        .join(", ");
      log(`Extension ${mcp.loadedExtensions.length}개: ${extensionNames}`);
    }

    /* **막혀 있는 것을 붙는 순간 알린다.** (ROADMAP §18)
     *
     * 이 정보는 `photoshop.diagnostics` 에 이미 있었는데, 부르지 않으면 못 본다.
     * 실기에서 `.mcp.json` 에 `PHOTOSHOP_MCP_ALLOW` 가 없어 `external` Tool 이
     * 전부 막혀 있었고, 실제로 불러 보고 나서야 알았다 — 정보가 없어서가 아니라
     * 아무도 안 봐서 못 찾은 것이다.
     *
     * 로그는 조용한 것이 기본이지만 **실패는 디버그가 아니어도 남긴다**는
     * 규칙이 이미 있고, 기동 시 막힘은 거기에 해당한다.
     *
     * `connected: null` 이다 — Bridge 는 서버가 뜬 뒤에 붙으므로 이 시점의
     * "연결 안 됨" 은 정상이다. 연결 상태는 `onBridgeStateChange` 가 따로 낸다. */
    const blocked = listBlockers({
      connected: null,
      allowed: policy.allowed,
      providers: await mcp.capabilities.describeAsync(),
      extensions: mcp.loadedExtensions,
    });
    if (blocked.length > 0) {
      /* **짧은 이름만 나열한다.**
       *
       * 기동마다 설명을 네 줄씩 쏟으면 사람이 안 읽게 되고, 그러면 이 줄을
       * 넣은 이유가 사라진다. 무엇이 꺼져 있는지만 보이고 고치는 방법은
       * 물어볼 곳을 가리킨다. */
      log(`막힘 ${blocked.length}건: ${blocked.map((item) => item.label).join(" · ")}`);
      log("  고치는 방법은 photoshop.diagnostics 를 부르면 나옵니다");
    }

    // 잡히지 않은 오류를 알아볼 수 있게 남긴다. (ROADMAP §17 Crash recovery)
    //
    // 삼키지 않는다. MCP 서버는 클라이언트가 다시 띄우므로 죽는 편이 맞고,
    // 오류를 감추면 다음에 같은 문제가 또 난다. 다만 진행 중인 Job 은 정리한다 —
    // 그러지 않으면 외부 처리기 프로세스가 서버보다 오래 산다.
    const fatal = (kind: string) => (error: unknown) => {
      log(`${kind}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      try {
        const cancelled = mcp.jobs.cancelAll();
        if (cancelled > 0) {
          log(`진행 중이던 Job ${cancelled}개를 취소했습니다.`);
        }
      } catch {
        // 정리 중 또 실패해도 원래 오류를 덮지 않는다.
      }
      process.exitCode = 1;
      process.exit(1);
    };
    process.once("uncaughtException", fatal("처리되지 않은 예외"));
    process.once("unhandledRejection", fatal("처리되지 않은 Promise 거부"));

    /* **클라이언트가 사라지면 프로세스도 끝난다.** (ROADMAP §18.4)
     *
     * 예전에는 시그널만 봤다. 그런데 **Windows 에는 `SIGTERM` 이 오지 않는다** —
     * MCP 클라이언트가 파이프만 닫고 사라지면 자식은 stdin EOF 만 본다.
     * 그동안 Bridge WebSocket 서버가 이벤트 루프를 붙잡고 있어 프로세스가
     * 남고, **8765 를 쥔 채로 산다.** 실기에서 하루에 세 번 손으로 죽였고
     * 그때마다 다음 서버가 `EADDRINUSE` 로 못 떴다.
     *
     * stdin 이 닫히는 것이 "클라이언트가 갔다" 의 가장 직접적인 신호다.
     * 시그널은 오면 받고, 안 와도 이쪽으로 끝난다. */
    let shuttingDown = false;
    const shutdown = (reason: string): void => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      log(`${reason} 종료합니다.`);

      /* **정리가 끝나지 않아도 끝낸다.** 외부 프로세스가 `SIGKILL` 을 안 받거나
       * 소켓이 안 닫히면 여기서 영원히 기다리게 되고, 그러면 고치려던 증상이
       * 그대로 남는다. `unref` 라 정상 종료를 늦추지는 않는다. */
      const forced = setTimeout(() => {
        log("정리가 끝나지 않아 강제로 종료합니다.");
        process.exit(0);
      }, 3000);
      forced.unref();

      void mcp
        .stop()
        .catch((error: unknown) => {
          log(`정지 중 오류: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          clearTimeout(forced);
          process.exit(0);
        });
    };

    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => {
        shutdown(`${signal} 수신,`);
      });
    }

    /* `end` 는 stdio 전송이 stdin 을 다 읽은 뒤에 온다. `close` 는 파이프가
     * 끊어진 경우다 — 둘 다 받는다. `shutdown` 이 한 번만 돈다. */
    process.stdin.once("end", () => {
      shutdown("stdin 이 닫혔습니다 —");
    });
    process.stdin.once("close", () => {
      shutdown("stdin 이 끊어졌습니다 —");
    });
  } catch (error) {
    /* **포트 충돌은 따로 말한다.** `EADDRINUSE` 한 줄만 나오면 사용자에게
     * 보이는 증상은 "Photoshop 이 안 붙는다" 이고, 둘을 잇는 데 매번 시간이
     * 든다. 무엇보다 **PID 를 알아야 끝낼 수 있다.** */
    if (isPortInUse(error)) {
      const conflicted = options.port ?? DEFAULT_PORT;
      log(
        portConflictMessage(conflicted, await findPortHolder(conflicted), options.portCount ?? 1),
      );
    } else {
      log(`시작 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exitCode = 1;
  }
}

/**
 * 이 파일이 직접 실행된 경우에만 기동한다.
 *
 * `npm run dev` 는 이 파일을 tsx 로 직접 실행하고,
 * `bin/photoshop-mcp.js` 는 {@link main} 을 import 해서 호출한다.
 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  void main();
}
