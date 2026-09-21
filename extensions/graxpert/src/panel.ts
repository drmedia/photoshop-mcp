import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * GraXpert Photoshop 패널의 **External Automation API**.
 *
 * 패널 저장소의 `docs/EXTERNAL_AUTOMATION.md` 가 계약이다. 이 파일은 그 계약을
 * 옮긴 것이고, 어긋나면 그쪽이 맞다.
 *
 * ## 왜 파일 통로인가
 *
 * 이 패널의 처리는 **Photoshop 에 descriptor 를 남기지 않는다.** 실기에서
 * `addNotificationListener(["all"])` 로 들어 보니 레이어를 두 장 만드는 동안
 * `make` 가 하나도 오지 않았다. 온 것은 `hostFocusChanged` 와 `invokeCommand`
 * 뿐이고 전부 `_isCommand: false` 였다.
 *
 * 액션이 기록하는 것이 바로 그 descriptor 경로다. 그래서 **액션으로 녹화되지
 * 않고**, `photoshop.action.run` 으로도 부를 수 없다.
 *
 * 필터 플러그인(StarXTerminator 등)은 메뉴 descriptor 를 거치므로 녹화된다.
 * 갈리는 기준은 "플러그인이냐" 가 아니라 **"메뉴를 거치느냐"** 다.
 *
 * ## CLI Capability 로 대체할 수 없다
 *
 * GraXpert 실행 자체는 CLI 와 **같은 인자**다. 다른 것은 입력이다 — 선택 영역이
 * 있으면 하늘 마스크를 만들어 지상부를 합성 평면으로 덮은 뒤 넣고, 결과를
 * 하늘에만 합성한다. 원본을 그대로 CLI 에 넣으면 산·나무가 그래디언트 모델을
 * 끌어당긴다.
 */

/** 패널이 `os.tmpdir()/GraXpert_Photoshop` 을 쓴다. 이 경로는 패널이 정한다. */
const DIR = join(tmpdir(), "GraXpert_Photoshop");
const COMMAND_FILE = join(DIR, "automation_command.json");
const RESPONSE_FILE = join(DIR, "automation_response.json");
const STATUS_FILE = join(DIR, "automation_status.json");

/** 패널이 검사하는 값. 맞지 않으면 `unsupported_schema` 로 거절한다. */
const SCHEMA_VERSION = 1;

/** 패널 명령 파일 확인 주기가 350ms 다. 그보다 촘촘히 볼 이유가 없다. */
const POLL_MS = 250;

/** 응답을 기다리는 한도. 패널이 닫혀 있으면 영원히 안 온다. */
const RESPONSE_TIMEOUT_MS = 10_000;

/**
 * 상태 파일을 믿을 수 있는 한도.
 *
 * 패널이 1초마다 다시 쓴다. 그보다 오래됐으면 패널이 떠 있지 않은 것이다 —
 * 남아 있는 파일을 현재 상태로 읽으면 닫힌 패널을 열려 있다고 보고하게 된다.
 */
const STATUS_FRESH_MS = 5_000;

export type PanelMode = "background" | "denoise";

export interface BackgroundOptions {
  gpu?: boolean;
  smoothing?: number;
  correction?: "Subtraction" | "Division";
  mergeSky?: boolean;
  addBackgroundLayer?: boolean;
}

export interface DenoiseOptions {
  gpu?: boolean;
  strength?: number;
  batchSize?: 1 | 2 | 4 | 8 | 16 | 32;
}

/** 패널이 실제로 쓴 설정. **요청값이 아니라 패널에 들어간 값**이다. */
export interface PanelSettings {
  gpu: boolean;
  method?: string;
  correction?: string;
  smoothing?: number;
  mergeSky?: boolean;
  addBackgroundLayer?: boolean;
  strength?: number;
  batchSize?: number;
}

export interface PanelResponse {
  schemaVersion: number;
  id: string;
  client: string;
  at: number;
  accepted: boolean;
  /** 기계가 가리는 사유. `accepted` · `automation_disabled` · `panel_busy` 등. */
  code: string;
  reason: string;
  mode: PanelMode | "";
  settings: PanelSettings;
  panelBusy: boolean;
  gradientResultBusy: boolean;
  busySince: number | null;
  busyForMs: number | null;
  busyLabel: string;
  busyFrom: string;
}

export interface PanelStatus {
  schemaVersion: number;
  at: number;
  /** 패널 설정의 **Allow External Automation**. 꺼져 있으면 아무 명령도 안 받는다. */
  enabled: boolean;
  panelBusy: boolean;
  gradientResultBusy: boolean;
  mode: PanelMode;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    // 패널이 쓰는 도중일 수 있다. 호출자가 다시 본다.
    return null;
  }
}

/**
 * 패널 상태를 읽는다. **명령을 보내지 않는다.**
 *
 * 패널이 1초마다 쓰는 파일을 읽을 뿐이라 `id` 를 태우지 않는다. 상태를 보려고
 * 더미 명령을 보내면 `duplicate_id` 방지용 id 를 쓰게 되고, 켜져 있지 않으면
 * `automation_disabled` 응답만 받는다.
 */
export function readStatus(): { status: PanelStatus; fresh: boolean } | null {
  if (!existsSync(STATUS_FILE)) {
    return null;
  }
  const status = readJson<PanelStatus>(STATUS_FILE);
  if (status === null) {
    return null;
  }
  // 파일의 `at` 이 아니라 mtime 으로 본다 — `at` 은 패널 시계이고 우리와
  // 다를 수 있다. 둘 중 새것을 쓴다.
  let writtenAt = status.at;
  try {
    writtenAt = Math.max(writtenAt, statSync(STATUS_FILE).mtimeMs);
  } catch {
    // mtime 을 못 읽으면 `at` 만 쓴다.
  }
  return { status, fresh: Date.now() - writtenAt <= STATUS_FRESH_MS };
}

/**
 * 실행을 요청하고 응답을 받는다.
 *
 * 응답은 **받았다는 신호이지 끝났다는 신호가 아니다.** 처리는 그 뒤로 몇 분
 * 걸린다. 완료 판정은 호출자가 레이어로 한다.
 *
 * **명령 파일을 우리가 지우지 않는다.** 패널이 소비하면서 지운다 — 거절한
 * 경우에도 지운다. 우리가 같이 지우면 패널이 아직 안 읽은 것을 뺏을 수 있다.
 */
export async function requestRun(
  mode: PanelMode,
  options: BackgroundOptions | DenoiseOptions,
  signal: AbortSignal,
): Promise<PanelResponse> {
  mkdirSync(DIR, { recursive: true });

  const id = `photoshop-mcp-${mode}-${Date.now()}`;
  writeFileSync(
    COMMAND_FILE,
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      id,
      client: "PhotoshopMCP",
      // 패널이 10초보다 오래된 명령을 거절한다. 쓰기 직전에 찍는다.
      createdAt: Date.now(),
      action: "run",
      mode,
      options,
    }),
    "utf8",
  );

  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new Error("취소되었습니다.");
    }
    await wait(POLL_MS);
    if (!existsSync(RESPONSE_FILE)) {
      continue;
    }
    const response = readJson<PanelResponse>(RESPONSE_FILE);
    // **id 로 가린다.** 옛 응답 파일이 남아 있을 수 있고, 지우고 시작하면
    // 패널이 쓰는 중과 겹친다. 에코된 id 가 그래서 있는 것이다.
    if (response !== null && response.id === id) {
      return response;
    }
  }

  throw new Error(
    "GraXpert 패널이 10초 동안 응답하지 않았습니다. " +
      "패널이 열려 있는지 확인하세요 — 닫혀 있으면 명령 파일을 읽는 쪽이 없습니다. " +
      "gx.status 로 패널이 살아 있는지 볼 수 있습니다.",
  );
}

/** 거절 사유를 고칠 방법과 함께 푼다. */
export function explainRejection(response: PanelResponse): string {
  const guide: Record<string, string> = {
    automation_disabled:
      "패널 설정에서 **Allow External Automation** 을 켜세요. 기본이 꺼짐입니다.",
    panel_busy: "패널이 다른 처리를 하고 있습니다. 끝난 뒤 다시 부르세요.",
    stale_command:
      "명령이 패널에 닿기까지 10초가 넘었습니다. 패널이 멈춰 있거나 시계가 어긋난 것입니다.",
    future_command: "이 기계의 시계가 패널보다 앞서 있습니다.",
    duplicate_id: "같은 요청 ID 를 두 번 보냈습니다. 이 Extension 의 버그입니다.",
    unsupported_schema: `이 Extension 은 schemaVersion ${SCHEMA_VERSION} 을 씁니다. 패널 버전이 다릅니다.`,
  };

  const lines = [`GraXpert 패널이 거절했습니다 [${response.code}]: ${response.reason}`];
  const hint = guide[response.code];
  if (hint !== undefined) {
    lines.push(hint);
  }
  if (response.busySince !== null && response.busyForMs !== null) {
    const seconds = Math.round(response.busyForMs / 1000);
    lines.push(`${seconds}초째 "${response.busyLabel}" 상태입니다.`);
    // 오래 켜져 있는데 진행이 없으면 패널의 setBusy(false) 가 빠진 것이다.
    // 임계를 정해 못 박지 않는다 — 느린 처리를 버그로 읽게 된다.
    lines.push(`상태를 켠 곳: ${response.busyFrom}`);
  }
  return lines.join(" ");
}
