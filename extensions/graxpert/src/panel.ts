import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * GraXpert Photoshop 패널과 주고받는 명령 파일.
 *
 * ## 왜 파일인가
 *
 * 이 패널의 처리는 **Photoshop 에 descriptor 를 남기지 않는다.** 실기에서
 * `addNotificationListener(["all"])` 로 들어 봤는데, 레이어를 두 장 만드는
 * 동안 `make` 가 하나도 오지 않았다. 온 것은 `hostFocusChanged` 와
 * `invokeCommand` 뿐이고 전부 `_isCommand: false` 였다.
 *
 * 액션이 기록하는 것이 바로 그 descriptor 경로다. 그래서 **액션으로 녹화되지
 * 않고**, `photoshop.action.run` 으로도 부를 수 없다. 패널이 원래 자기 샘플
 * 에디터 창과 쓰던 파일 통로가 유일한 길이다.
 *
 * 필터 플러그인(StarXTerminator 등)은 메뉴 descriptor 를 거치므로 녹화된다.
 * 갈리는 기준은 "플러그인이냐" 가 아니라 **"메뉴를 거치느냐"** 다.
 *
 * ## CLI 로 대체할 수 없는 이유
 *
 * GraXpert 실행 자체는 CLI 와 **같은 인자**다. 다른 것은 입력이다 — AI 모드는
 * 하늘 마스크를 만들어 지상부를 합성 평면으로 덮은 뒤 넣고, 결과를 하늘에만
 * 합성한다. 원본을 그대로 CLI 에 넣으면 산·나무가 그래디언트 모델을 끌어당긴다.
 */

/** 패널이 `os.tmpdir()/GraXpert_Photoshop` 을 쓴다. 이 경로는 패널이 정한다. */
const DIR = join(tmpdir(), "GraXpert_Photoshop");
const COMMAND_FILE = join(DIR, "gradient_editor_command.json");
const ACK_FILE = join(DIR, "mcp_run_ack.json");

/** 패널이 명령 파일을 읽는 주기. 그보다 촘촘히 확인할 이유가 없다. */
const POLL_MS = 250;

/** 패널 응답을 기다리는 한도. 패널이 닫혀 있으면 영원히 안 온다. */
const ACK_TIMEOUT_MS = 10_000;

export type PanelMode = "background" | "denoise";

/** 패널이 실제로 쓴 설정. **요청값이 아니라 패널에 들어간 값**이다. */
export interface PanelSettings {
  gpu: boolean;
  method?: string;
  correction?: string;
  smoothing?: number;
  mergeSky?: boolean | null;
  addBackgroundLayer?: boolean;
  strength?: number;
  batchSize?: string;
}

export interface PanelAck {
  at: number;
  accepted: boolean;
  reason: string;
  mode: PanelMode;
  settings: PanelSettings;
  panelBusy: boolean;
  gradientResultBusy: boolean;
  busySince: number | null;
  busyForMs: number | null;
  busyLabel: string;
  busyFrom: string;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 명령 파일을 치운다.
 *
 * **남기면 패널을 다시 열 때 옛 명령이 그대로 한 번 더 실행된다.** 재시작이
 * 중복 방지 상태(`lastSampleCommandId` · 파일 스탬프)를 지우는데 파일은 디스크에
 * 남아 있기 때문이다. 실기에서 겪었다 — 누르지 않은 실행이 한 번 더 돌았다.
 */
function clearCommand(): void {
  try {
    rmSync(COMMAND_FILE, { force: true });
  } catch {
    // 이미 없으면 그만이다.
  }
}

/**
 * 패널에 실행을 요청하고 응답을 받는다.
 *
 * 응답은 **받았다는 신호이지 끝났다는 신호가 아니다.** 처리는 그 뒤로 몇 분
 * 걸린다. 완료 판정은 호출자가 레이어로 한다.
 */
export async function requestRun(
  command: Record<string, unknown>,
  signal: AbortSignal,
): Promise<PanelAck> {
  mkdirSync(DIR, { recursive: true });

  // 옛 응답을 먼저 치운다. 남아 있으면 이번 요청의 답으로 읽는다.
  try {
    rmSync(ACK_FILE, { force: true });
  } catch {
    // 없으면 그만이다.
  }

  // id 를 매번 바꾼다. 패널이 같은 id 를 무시한다.
  writeFileSync(COMMAND_FILE, JSON.stringify({ ...command, id: `mcp-${Date.now()}` }), "utf8");

  const deadline = Date.now() + ACK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      clearCommand();
      throw new Error("취소되었습니다.");
    }
    await wait(POLL_MS);
    if (!existsSync(ACK_FILE)) {
      continue;
    }
    try {
      const ack = JSON.parse(readFileSync(ACK_FILE, "utf8")) as PanelAck;
      clearCommand();
      return ack;
    } catch {
      // 패널이 쓰는 도중에 읽었을 수 있다. 다음 주기에 다시 본다.
    }
  }

  clearCommand();
  throw new Error(
    "GraXpert 패널이 10초 동안 응답하지 않았습니다. " +
      "패널이 열려 있는지 확인하세요 — 닫혀 있으면 명령 파일을 읽는 쪽이 없습니다. " +
      "열려 있는데도 답이 없으면 MCP 통로 패치가 빠진 옛 버전입니다.",
  );
}

/** 거절 사유를 사람이 읽을 수 있게 푼다. */
export function explainRejection(ack: PanelAck): string {
  const lines = [`GraXpert 패널이 실행을 거절했습니다: ${ack.reason}`];
  if (ack.busySince !== null && ack.busyForMs !== null) {
    const seconds = Math.round(ack.busyForMs / 1000);
    lines.push(`${seconds}초째 "${ack.busyLabel}" 상태입니다.`);
    // 오래 켜져 있는데 진행이 없으면 setBusy(false) 가 빠진 것이다.
    // 그 판단은 사람이 한다 — 임계를 정해 못 박으면 느린 처리를 버그로 읽는다.
    lines.push(`상태를 켠 곳: ${ack.busyFrom}`);
  }
  return lines.join(" ");
}
