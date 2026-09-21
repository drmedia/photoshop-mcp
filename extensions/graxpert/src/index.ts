import {
  DOCUMENT_GET,
  LAYER_LIST,
  SELECTION_GET,
  type DocumentInfo,
  type ExtensionContext,
  type LayerInfo,
} from "@photoshop-mcp/extension-sdk";
import { z } from "zod";
import {
  explainRejection,
  readStatus,
  requestRun,
  type PanelMode,
  type PanelResponse,
} from "./panel.js";

/**
 * GraXpert 패널 Extension.
 *
 * Core 는 Photoshop 을 알고, 이 Extension 은 GraXpert 패널이라는 도메인을 안다.
 * (ARCHITECTURE §1) 통로 형식과 패널의 버릇은 전부 `panel.ts` 에 갇혀 있다.
 *
 * **왜 Core Tool 이 아닌가.** 이건 Photoshop 기능이 아니라 특정 패널을 부리는
 * 일이다. Core 에 넣으면 그 패널을 안 쓰는 사람에게도 목록에 보인다.
 *
 * 계약은 패널 저장소의 `docs/EXTERNAL_AUTOMATION.md` 다.
 */

/** 패널이 0–1 밖을 거절한다. 여기서 먼저 막아 왕복을 아낀다. */
const Unit = z.number().min(0).max(1);

/**
 * 그래디언트 제거 입력.
 *
 * **`method` 를 받지 않는다.** 외부 자동화의 Background Extraction 은 언제나
 * AI Auto 다 — 패널이 `method` 를 top-level 에서도 옵션에서도 받지 않고
 * `unsupported_parameter` 로 거절한다.
 *
 * Sample Point 방식은 사용자가 배경 포인트를 화면에서 찍는 작업이라 통로 자체가
 * 열려 있지 않다. 미리보기를 보며 점을 옮기는 UX 는 MCP 로 옮길 수 없다.
 */
const RunBackgroundInput = z
  .object({
    correction: z.enum(["Subtraction", "Division"]).optional(),
    smoothing: Unit.optional(),
    /** 보정한 하늘을 원본 전경과 합쳐 새 픽셀 레이어로 만들지. */
    mergeSky: z.boolean().optional(),
    /** 배경 모델 레이어를 함께 만들지. GraXpert 의 `-bg` 다. */
    addBackgroundLayer: z.boolean().optional(),
    gpu: z.boolean().optional(),
  })
  .strict();

const RunDenoiseInput = z
  .object({
    strength: Unit.optional(),
    /** 패널이 이 여섯 값만 받는다. */
    batchSize: z
      .union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16), z.literal(32)])
      .optional(),
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
 * 노이즈 감소가 75초, 사용자 환경에서 2분을 넘은 적이 있다.
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
   * 패널이 명령을 받을 수 있는 상태인지 미리 본다.
   *
   * **Job 을 띄우기 전에** 부른다. 상태 파일을 읽을 뿐이라 명령을 보내지 않고,
   * 즉시 알 수 있는 거절을 `job.status` 로 미루지 않는다. 반환 타입은 그대로
   * `jobId` 이고 바뀌는 것은 실패 시점뿐이다.
   */
  function requirePanelReady(): void {
    const current = readStatus();
    if (current === null) {
      throw new Error(
        "GraXpert 패널의 상태 파일이 없습니다. 패널을 한 번도 열지 않았거나 설치되어 있지 않습니다.",
      );
    }
    if (!current.fresh) {
      throw new Error(
        "GraXpert 패널이 떠 있지 않습니다. 상태 파일이 갱신되지 않고 있습니다 — " +
          "Photoshop 에서 GraXpert 패널을 여세요.",
      );
    }
    if (!current.status.enabled) {
      throw new Error(
        "GraXpert 패널의 외부 자동화가 꺼져 있습니다. " +
          "패널 설정에서 **Allow External Automation** 을 켜세요. 기본이 꺼짐입니다.",
      );
    }
  }

  /**
   * 실행을 요청하고 **새 레이어가 나타날 때까지** 기다린다.
   *
   * 패널은 끝났다고 알려주지 않는다 — 응답은 "명령을 받았다" 까지다. 그래서
   * 완료 판정을 Photoshop 쪽에서 한다. 실행 **전에** id 목록을 떠 두고 없던
   * id 를 찾는다.
   *
   * 위치나 이름으로 찾지 않는다. 이름은 여러 장이 같고(`GraXpert - AI Gradient -
   * Sky Merged` 가 열 장 쌓인 문서를 실기에서 봤다), 위치는 활성 레이어에 따라
   * 달라진다. (`mutation-result.ts` 와 같은 원칙)
   */
  async function runPanel(
    mode: PanelMode,
    options: Record<string, unknown>,
    requestId: string,
    job: { report: (percent: number | null, message: string) => void; signal: AbortSignal },
  ): Promise<unknown> {
    job.report(5, "문서 확인");
    const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);

    /* 선택 유무를 **막지 않고 기록한다.**
     *
     * 패널은 선택이 있으면 하늘 워크플로로, 없으면 활성 레이어 전체로 간다.
     * 둘 다 의도된 동작이므로 한쪽을 거절하면 멀쩡한 호출을 막게 된다.
     *
     * 다만 어느 쪽으로 갔는지는 호출자가 알아야 한다. 실기에서 노이즈 감소를
     * 두 번 돌리는 사이 선택이 사라졌고, 그다음 그래디언트 제거가 하늘 경로를
     * 타지 않았는데도 성공으로 보였다. */
    const selection =
      mode === "background"
        ? await exec<{ hasSelection: boolean }>(SELECTION_GET, {}, requestId)
        : { hasSelection: false };

    const before = new Set((await listLayers(requestId)).map((layer) => layer.id));

    job.report(10, "GraXpert 패널에 실행 요청");
    const response: PanelResponse = await requestRun(mode, options, job.signal);
    if (!response.accepted) {
      throw new Error(explainRejection(response));
    }
    logger.info(`GraXpert ${mode} 시작: ${JSON.stringify(response.settings)}`);

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
      if (created.length === 0) {
        continue;
      }
      job.report(100, "완료");

      /* **하늘 경로를 실제로 탔는지는 레이어 이름으로 확인한다.**
       *
       * 패널이 이름 끝에 ` - Sky Merged` 또는 ` - Sky Masked` 를 붙이는데
       * 그 분기가 곧 하늘 워크플로다. 응답의 `settings` 를 되읽으면 "AI 로
       * 요청했다" 까지만 알 수 있고 "하늘로 돌았다" 는 알 수 없다. */
      const skyApplied =
        mode === "background" &&
        created.some((layer) => / - Sky (Merged|Masked)$/u.test(layer.name));

      return {
        mode: response.mode,
        // 요청값이 아니라 패널에 실제로 들어간 값이다.
        settings: response.settings,
        ...(mode === "background" ? { selectionAtStart: selection.hasSelection, skyApplied } : {}),
        document: { name: document.name, size: `${document.width}x${document.height}` },
        layers: created.map((layer) => ({ id: layer.id, name: layer.name })),
      };
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
      "패널이 떠 있는지, 외부 자동화가 켜져 있는지, 지금 처리 중인지를 보고한다. " +
      "**명령을 보내지 않는다** — 패널이 1초마다 쓰는 상태 파일을 읽을 뿐이다. " +
      "gx.run_* 이 거절당하면 먼저 부른다.",
    permission: "read",
    inputSchema: Empty,
    handler: (_input, _toolContext) => {
      const extension = { id: manifest.id, version: manifest.version };
      const current = readStatus();
      if (current === null) {
        return Promise.resolve({
          extension,
          panelRunning: false,
          // 상태 파일이 없으면 나머지를 지어내지 않는다. 모르는 것은 null 이다.
          automationEnabled: null,
          mode: null,
          busy: null,
          gradientResultBusy: null,
          statusAgeMs: null,
          blocked:
            "상태 파일이 없습니다. GraXpert 패널을 한 번도 열지 않았거나 설치되어 있지 않습니다.",
        });
      }
      const { status, fresh } = current;
      return Promise.resolve({
        extension,
        // 파일이 낡았으면 패널이 닫힌 것이다. 남은 값을 현재 상태로 보고하지 않는다.
        panelRunning: fresh,
        automationEnabled: status.enabled as boolean | null,
        mode: status.mode as string | null,
        busy: status.panelBusy as boolean | null,
        gradientResultBusy: status.gradientResultBusy as boolean | null,
        statusAgeMs: (Date.now() - status.at) as number | null,
        blocked: !fresh
          ? "패널이 떠 있지 않습니다. Photoshop 에서 GraXpert 패널을 여세요."
          : !status.enabled
            ? "패널 설정에서 **Allow External Automation** 을 켜세요. 기본이 꺼짐입니다."
            : null,
      });
    },
  });

  tools.register({
    name: "gx.run_gradient",
    description:
      "GraXpert 패널의 그래디언트 제거를 실행한다. 외부 자동화는 **언제나 AI Auto** 다. " +
      "**활성 선택 영역이 있으면 그것을 하늘로 삼아** 전경을 가상 하늘로 덮고 계산한 뒤 " +
      "보정된 하늘만 합성한다. 선택이 없으면 활성 레이어 전체를 처리한다 — " +
      "어느 쪽으로 갔는지는 결과의 skyApplied 에 담긴다. " +
      "지상 풍경이 든 사진은 선택이 있어야 산·나무가 그래디언트 모델을 끌어당기지 않는다. " +
      "**즉시 jobId 를 반환한다.** 수 분 걸릴 수 있어 MCP 요청 안에서 끝낼 수 없다. " +
      "photoshop.job.status 로 확인하고, completed 가 되면 result.layers 에 새 레이어가 담긴다.",
    permission: "external",
    inputSchema: RunBackgroundInput,
    handler: (input, toolContext) => {
      const { requestId } = toolContext;
      requirePanelReady();
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
      "GraXpert 패널의 노이즈 감소를 실행한다. " +
      "그래디언트 제거와는 GraXpert 를 아예 다른 명령으로 부른다(-cmd denoising). " +
      "생략한 값은 패널에 지금 설정된 것을 그대로 쓴다. " +
      "**즉시 jobId 를 반환한다.** photoshop.job.status 로 확인한다.",
    permission: "external",
    inputSchema: RunDenoiseInput,
    handler: (input, toolContext) => {
      const { requestId } = toolContext;
      requirePanelReady();
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
