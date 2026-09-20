import {
  DOCUMENT_GET,
  LAYER_LIST,
  SELECTION_GET,
  type DocumentInfo,
  type ExtensionContext,
  type LayerInfo,
} from "@photoshop-mcp/extension-sdk";
import { z } from "zod";
import { explainRejection, requestRun, type PanelAck } from "./panel.js";

/**
 * GraXpert 패널 Extension.
 *
 * Core 는 Photoshop 을 알고, 이 Extension 은 GraXpert 패널이라는 도메인을 안다.
 * (ARCHITECTURE §1) 명령 파일 형식·패널의 버릇은 전부 여기 갇혀 있다.
 *
 * **왜 Core Tool 이 아닌가.** 이건 Photoshop 기능이 아니라 특정 서드파티 패널을
 * 부리는 일이다. Core 에 넣으면 그 패널을 안 쓰는 사람에게도 목록에 보인다.
 *
 * 통로의 근거와 제약은 `panel.ts` 에 적어 두었다.
 */

/** 모두 0–1 범위다. 패널 슬라이더와 같다. */
const Unit = z.number().min(0).max(1);

/**
 * 그래디언트 제거 입력.
 *
 * **`method` 를 받지 않는다. 언제나 AI 다.**
 *
 * 패널의 다른 방식(`sample`)은 사용자가 배경 포인트를 화면에서 찍는 작업이다.
 * 미리보기를 보며 점을 옮기는 UX 는 MCP 로 옮길 수 없고 옮길 이유도 없다 —
 * MilkyScape 패널을 사람 도구로 남겨 둔 것과 같은 판단이다.
 *
 * 고를 수 있게 열어 두면 `sample` 을 준 호출이 포인트 없이 돌아 엉뚱한 결과를
 * 낸다. 열지 않는 편이 낫다.
 */
const RunBackgroundInput = z
  .object({
    correction: z.enum(["Subtraction", "Division"]).optional(),
    smoothing: Unit.optional(),
    /** 결과를 하늘에만 합성할지. AI 모드에서만 뜻이 있다. */
    mergeSky: z.boolean().optional(),
    /** 배경 모델 레이어를 함께 만들지. GraXpert 의 `-bg` 다. */
    addBackgroundLayer: z.boolean().optional(),
    gpu: z.boolean().optional(),
  })
  .strict();

const RunDenoiseInput = z
  .object({
    strength: Unit.optional(),
    batchSize: z.number().int().positive().optional(),
    gpu: z.boolean().optional(),
  })
  .strict();

const Empty = z.object({}).strict();

/** 처리가 끝났는지 확인하는 주기. */
const LAYER_POLL_MS = 3_000;

/**
 * 결과를 기다리는 한도.
 *
 * GraXpert 는 이미지 크기와 GPU 유무에 따라 크게 다르다. 실기에서 4032×6048
 * AI 그래디언트가 30초 안쪽이었지만 CPU 로 돌면 훨씬 길어진다.
 */
const RESULT_TIMEOUT_MS = 20 * 60 * 1000;

export function activate(context: ExtensionContext): void {
  const { commands, tools, jobs, logger, manifest } = context;

  const exec = <T>(type: string, params: unknown, requestId: string): Promise<T> =>
    commands.execute<T>({ type, params: params as Record<string, unknown> }, { requestId });

  const listLayers = (requestId: string): Promise<LayerInfo[]> =>
    exec<LayerInfo[]>(LAYER_LIST, {}, requestId);

  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 하늘 선택이 있는지 확인한다. **Job 을 띄우기 전에** 부른다.
   *
   * 즉시 알 수 있는 것을 Job 으로 넘기면 호출자가 status 를 한 번 더 물어야
   * 안다. 반환 타입은 그대로 jobId 다 — 바뀌는 것은 실패 시점뿐이다.
   *
   * **하늘은 사용자가 고른다.** 패널이 하늘을 스스로 찾지 않고 활성 선택
   * 영역(없으면 활성 레이어의 마스크)을 하늘로 삼는다.
   *
   * 선택이 없으면 패널은 오류를 내지 않고 **말없이 일반 처리로 떨어진다**
   * (`if (skyAI && !maskToken) { skyAI = false; }`). 레이어가 생기고 진행
   * 막대도 끝까지 가서 성공처럼 보인다. 실기에서 걸렸고, 결과 레이어 이름에
   * ` - Sky Merged` 가 없는 것만이 유일한 단서였다.
   *
   * 막기만 하고 선택을 대신 만들지는 않는다 — 무엇을 하늘로 볼지는 이
   * Extension 이 정할 일이 아니다.
   */
  async function requireSkySelection(requestId: string): Promise<void> {
    const selection = await exec<{ hasSelection: boolean }>(SELECTION_GET, {}, requestId);
    if (selection.hasSelection) {
      return;
    }
    throw new Error(
      "선택 영역이 없습니다. GraXpert 의 AI 그래디언트 제거는 **선택 영역을 하늘로 삼습니다** — " +
        "패널이 하늘을 스스로 찾지 않습니다. " +
        "photoshop.selection.sky 로 하늘을 고른 뒤 다시 부르세요. " +
        "이대로 두면 패널이 오류 없이 일반 처리로 떨어져 성공처럼 보입니다.",
    );
  }

  /**
   * 실행을 요청하고 **새 레이어가 나타날 때까지** 기다린다.
   *
   * 패널은 끝났다고 알려주지 않는다 — 응답은 "명령을 받았다" 까지다. 그래서
   * 완료 판정을 Photoshop 쪽에서 한다. 패널이 만드는 것은 새 레이어이므로,
   * 실행 **전에** id 목록을 떠 두고 없던 id 를 찾는다.
   *
   * 위치나 이름으로 찾지 않는다. 이름은 여러 장이 같고(`GraXpert - AI Gradient -
   * Sky Merged` 가 열 장 쌓인 문서를 실기에서 봤다), 위치는 활성 레이어에 따라
   * 달라진다. (`mutation-result.ts` 와 같은 원칙)
   */
  async function runPanel(
    mode: "background" | "denoise",
    input: Record<string, unknown>,
    requestId: string,
    job: { report: (percent: number | null, message: string) => void; signal: AbortSignal },
  ): Promise<unknown> {
    job.report(5, "문서 확인");
    const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);

    const before = new Set((await listLayers(requestId)).map((layer) => layer.id));

    job.report(10, "GraXpert 패널에 실행 요청");
    // method 는 고정이다. 패널 라디오가 딴 값으로 남아 있을 수 있어 매번 준다.
    const command =
      mode === "background"
        ? { action: "run", mode, method: "AI", ...input }
        : { action: "run", mode, ...input };
    const ack: PanelAck = await requestRun(command, job.signal);
    if (!ack.accepted) {
      throw new Error(explainRejection(ack));
    }
    logger.info(`GraXpert ${mode} 시작: ${JSON.stringify(ack.settings)}`);

    job.report(20, `GraXpert ${mode === "background" ? "그래디언트 제거" : "노이즈 감소"} 처리 중`);
    const deadline = Date.now() + RESULT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (job.signal.aborted) {
        // 패널 쪽 처리는 멈추지 않는다. 우리가 기다리기를 그만둘 뿐이다 —
        // 그 사실을 감추지 않는다.
        throw new Error(
          "기다리기를 취소했습니다. **GraXpert 패널의 처리는 계속 돕니다** — " +
            "패널의 취소 버튼으로 멈추세요.",
        );
      }
      await wait(LAYER_POLL_MS);
      const layers = await listLayers(requestId);
      const created = layers.filter((layer) => !before.has(layer.id));
      if (created.length > 0) {
        job.report(100, "완료");

        /* **하늘 경로를 실제로 탔는지는 레이어 이름으로 확인한다.**
         *
         * 패널이 이름 끝에 ` - Sky Merged` 또는 ` - Sky Masked` 를 붙이는데,
         * 그 분기가 곧 `skyAI` 다. 설정값을 되읽으면 "AI 로 요청했다" 까지만
         * 알 수 있고 "AI 로 돌았다" 는 알 수 없다. */
        const skyApplied =
          mode === "background" &&
          created.some((layer) => / - Sky (Merged|Masked)$/u.test(layer.name));

        return {
          mode: ack.mode,
          // 요청값이 아니라 패널에 실제로 들어간 값이다. 범위를 벗어난
          // 요청은 잘려서 들어가므로 여기서 그 사실이 드러난다.
          settings: ack.settings,
          ...(mode === "background"
            ? {
                skyApplied,
                ...(skyApplied
                  ? {}
                  : {
                      warning:
                        "**하늘 경로를 타지 않았습니다.** 결과 레이어 이름에 ' - Sky Merged' 가 " +
                        "없습니다 — 패널이 선택 영역에서 마스크를 만들지 못해 일반 그래디언트 " +
                        "제거로 처리했습니다. 선택 영역을 확인하고 다시 부르세요.",
                    }),
              }
            : {}),
          document: { name: document.name, size: `${document.width}x${document.height}` },
          layers: created.map((layer) => ({ id: layer.id, name: layer.name })),
        };
      }
    }

    throw new Error(
      `GraXpert 가 ${Math.round(RESULT_TIMEOUT_MS / 60000)}분 동안 결과를 내놓지 않았습니다. ` +
        "패널을 확인하세요 — photoshop.window.capture 로 화면을 보면 대화상자 여부까지 알 수 있습니다.",
    );
  }

  // ---------------------------------------------------------------------------

  tools.register({
    name: "gx.status",
    description:
      "GraXpert 패널을 부를 수 있는 상태인지 확인한다. " +
      "패널이 열려 있는지, 지금 처리 중인지, 처리 중이라면 얼마나 오래됐는지를 보고한다. " +
      "**아무것도 실행하지 않는다.** gx.run_* 이 거절당할 때 먼저 부른다.",
    permission: "read",
    inputSchema: Empty,
    handler: async (_input, toolContext) => {
      const { requestId } = toolContext;
      const layers = await listLayers(requestId);
      // mode 를 주지 않으면 패널이 거절하면서 상태만 돌려준다. 실행되지 않는다.
      // 응답 대기가 10초 한도라 취소 통로 없이 불러도 MCP 타임아웃 안에서 끝난다.
      const ack = await requestRun({ action: "run" }, new AbortController().signal);
      return {
        extension: { id: manifest.id, version: manifest.version },
        panelResponding: true,
        mode: ack.mode,
        busy: ack.panelBusy,
        busyForMs: ack.busyForMs,
        busyLabel: ack.busyLabel,
        settings: ack.settings,
        layerCount: layers.length,
      };
    },
  });

  tools.register({
    name: "gx.run_gradient",
    description:
      "GraXpert 패널의 AI 그래디언트 제거를 실행한다. " +
      "**활성 선택 영역을 하늘로 삼는다** — 먼저 photoshop.selection.sky 등으로 하늘을 고른다. " +
      "선택이 없으면 실행하지 않고 거절한다(패널은 조용히 일반 처리로 떨어진다). " +
      "지상부를 합성 평면으로 덮은 뒤 GraXpert 에 넣으므로 CLI 에 원본을 그대로 넣는 것과 결과가 다르다. " +
      "생략한 값은 패널에 지금 설정된 것을 그대로 쓴다. " +
      "**즉시 jobId 를 반환한다.** 수 분 걸릴 수 있어 MCP 요청 안에서 끝낼 수 없다. " +
      "photoshop.job.status 로 확인하고, completed 가 되면 result.layers 에 새 레이어가 담긴다.",
    permission: "external",
    inputSchema: RunBackgroundInput,
    handler: async (input, toolContext) => {
      const { requestId } = toolContext;
      // 즉시 알 수 있는 것은 Job 으로 미루지 않는다.
      await requireSkySelection(requestId);
      const jobId = jobs.start("gx.run_gradient", async (job) =>
        runPanel("background", input as Record<string, unknown>, requestId, job),
      );
      return Promise.resolve({
        jobId,
        note: "photoshop.job.status 로 진행 상황을 확인하세요.",
      });
    },
  });

  tools.register({
    name: "gx.run_denoise",
    description:
      "GraXpert 패널의 Noise Reduction 을 실행한다. " +
      "그래디언트 제거와는 GraXpert 를 아예 다른 명령으로 부른다(-cmd denoising). " +
      "생략한 값은 패널에 지금 설정된 것을 그대로 쓴다. " +
      "**즉시 jobId 를 반환한다.** photoshop.job.status 로 확인한다.",
    permission: "external",
    inputSchema: RunDenoiseInput,
    handler: (input, toolContext) => {
      const { requestId } = toolContext;
      const jobId = jobs.start("gx.run_denoise", async (job) =>
        runPanel("denoise", input as Record<string, unknown>, requestId, job),
      );
      return Promise.resolve({
        jobId,
        note: "photoshop.job.status 로 진행 상황을 확인하세요.",
      });
    },
  });

  logger.info(`GraXpert Extension 적재됨 (${manifest.version})`);
}
