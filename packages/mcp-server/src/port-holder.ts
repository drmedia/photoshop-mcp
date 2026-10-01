import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * 포트를 쥐고 있는 프로세스를 찾는다. (ROADMAP §18.4)
 *
 * ## 왜 필요한가
 *
 * 포트가 막히면 이 한 줄만 나왔다.
 *
 * ```text
 * 시작 실패: listen EADDRINUSE: address already in use 127.0.0.1:8765
 * ```
 *
 * 그런데 사용자에게 보이는 증상은 **"Photoshop 이 안 붙는다"** 다. 둘을 잇는
 * 데 매번 시간이 들었고, 실기에서 하루에 세 번 그랬다. `doctor` 가 같은 말을
 * 하고 있었지만 **부르지 않으면 못 본다** — §18 에서 이미 겪은 구조다.
 *
 * 무엇보다 **PID 를 알아야 끝낼 수 있다.** 포트가 막혔다는 것만으로는 사용자가
 * 다음에 할 일이 없다.
 *
 * ## 왜 외부 명령을 쓰는가
 *
 * Node 에 "이 포트를 누가 쓰는가" 를 묻는 API 가 없다. 진단 경로에서만,
 * **기동에 이미 실패한 뒤에만** 부른다. `shell: false` 이고 인자는 고정이다 —
 * 포트 숫자만 들어가고 그것도 우리가 만든 값이다.
 *
 * 못 찾으면 `null` 이다. 짐작한 PID 를 내놓으면 사용자가 엉뚱한 프로세스를
 * 죽인다.
 */

const run = promisify(execFile);

/**
 * `netstat -ano -p TCP` 출력에서 이 포트를 LISTENING 하는 PID.
 *
 * ```text
 *   TCP    127.0.0.1:8765         0.0.0.0:0              LISTENING       39560
 * ```
 */
export function parseNetstat(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    if (columns.length < 5 || columns[0] !== "TCP") {
      continue;
    }
    // 마지막 콜론 뒤가 포트다. IPv6 는 주소 안에도 콜론이 있다.
    const local = columns[1] ?? "";
    const colon = local.lastIndexOf(":");
    if (colon < 0 || local.slice(colon + 1) !== String(port)) {
      continue;
    }
    if (columns[3] !== "LISTENING") {
      continue;
    }
    const pid = Number.parseInt(columns[4] ?? "", 10);
    return Number.isInteger(pid) ? pid : null;
  }
  return null;
}

/** `lsof -t` 출력. 한 줄에 PID 하나다. */
export function parseLsof(output: string): number | null {
  for (const line of output.split(/\r?\n/u)) {
    const pid = Number.parseInt(line.trim(), 10);
    if (Number.isInteger(pid)) {
      return pid;
    }
  }
  return null;
}

/** 이 포트를 쥔 프로세스의 PID. 못 찾으면 `null`. */
export async function findPortHolder(port: number): Promise<number | null> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("netstat", ["-ano", "-p", "TCP"], { windowsHide: true });
      return parseNetstat(stdout, port);
    }
    const { stdout } = await run("lsof", ["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-t"]);
    return parseLsof(stdout);
  } catch {
    // 명령이 없거나 권한이 없을 수 있다. 모르는 것은 모른다고 한다.
    return null;
  }
}

/** 오류가 포트 충돌인가. */
export function isPortInUse(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "EADDRINUSE") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("EADDRINUSE");
}

/**
 * 사용자가 다음에 할 일까지 담은 문장.
 *
 * **세 갈래를 모두 말한다.** 이미 뜬 서버를 쓰거나, 그것을 끝내거나, 포트를
 * 바꾸거나다. 하나만 말하면 나머지 둘을 아는 사람만 빠져나온다.
 */
export function portConflictMessage(port: number, pid: number | null, count = 1): string {
  const who = pid === null ? "다른 프로세스" : `다른 프로세스 (PID ${String(pid)})`;
  /* 범위를 다 훑었는데도 없는 경우다. 첫 포트를 쥔 프로세스만 말한다 — 나머지를 다 찾으면 길어지고
   * 보통 같은 서버가 여럿 남은 경우다. */
  const head =
    count > 1
      ? `포트 ${String(port)}~${String(port + count - 1)} 를 모두 다른 프로세스가 쓰고 있어 Bridge 를 열지 못했습니다. ` +
        `${String(port)} 는 ${who}가 쓰고 있습니다.`
      : `포트 ${String(port)} 를 ${who}가 이미 쓰고 있어 Bridge 를 열지 못했습니다.`;
  return [
    head,
    "  PhotoshopMCP 서버가 이미 떠 있다면 그것을 쓰십시오 — 두 개를 띄울 수 없습니다.",
    pid === null
      ? "  누가 쓰는지는 확인하지 못했습니다. netstat 로 찾아 끝내십시오."
      : `  남은 서버라면 끝내십시오. Windows: taskkill /PID ${String(pid)} /F`,
    count > 1
      ? "  남은 서버를 끝내면 빈 포트를 다시 찾습니다."
      : `  다른 포트를 쓰려면 PHOTOSHOP_MCP_PORT 를 바꾸십시오 (지금 ${String(port)}).`,
  ].join("\n");
}
