import {
  DOCUMENT_EXPORT,
  DOCUMENT_GET,
  LAYER_LIST,
  LAYER_PLACE,
  LAYER_SELECT,
  SELECTION_EXPORT_MASK,
  SELECTION_GET,
  type DocumentInfo,
  type ExtensionContext,
  type LayerInfo,
  type SaveResult,
} from "@photoshop-mcp/extension-api";
import { z } from "zod";
import { nextLayerName, runStem } from "./naming.js";

/**
 * GraXpert Extension — **CLI 로 부른다.**
 *
 * 예전에는 GraXpert 의 Photoshop CEP 패널을 명령 파일로 구동했다. 그쪽은
 * 전제가 둘이었고 **둘 다 사람만 할 수 있었다** — 패널을 열어 두는 것과
 * 패널 설정에서 `Allow External Automation` 을 켜는 것.
 *
 * 열기를 자동화할 수 있는지 재 봤다. **패널을 여는 것은 Photoshop 알림을
 * 하나도 남기지 않는다** — `["all"]` 로 듣는 동안 손으로 열었는데 잡힌
 * `photoshop.*` 이벤트가 우리 Command 가 만든 `modalJavaScriptScopeEnter/Exit`
 * 뿐이었다. descriptor 가 없으니 액션으로 녹화할 수도, 재생할 수도 없다.
 *
 * 그래서 패널을 뗐다. CLI 는 같은 실행 파일이고 왕복이 이미 실기에서
 * 검증되어 있다 — `export(tiff) → GraXpert 7초 → FITS→TIFF → place`.
 *
 * ## 하늘 격리는 여기서 하지 않는다
 *
 * 패널은 선택 영역을 하늘로 삼아 지상부를 덮은 뒤 넣었다. 지상 풍경이 든
 * 사진에서 산·나무가 그래디언트 모델을 끌어당기기 때문이다.
 *
 * **그 판단은 호출자가 한다.** Tool 은 활성 레이어에 GraXpert 를 걸 뿐이다.
 * 하늘만 보정하려면 `photoshop.selection.sky` 로 고르고 결과 레이어에
 * `photoshop.mask.create { from: "fromSelection" }` 를 씌우면 된다. 격리가
 * 실제로 필요한지는 `photoshop.document.statistics` 로 재서 안다.
 *
 * 흐름을 Tool 안에 박으면 호출자가 그 결정을 못 바꾼다.
 */

/** Capability 가 받는 값. 파라미터는 argv 로 조립되므로 원시값만 간다. */
type ProviderParams = Record<string, string | number | boolean>;

/** GraXpert 의 `-smoothing` 은 0~1 이다. */
const Unit = z.number().min(0).max(1);

const RunGradientInput = z
  .object({
    /** `-correction`. 가산 그래디언트면 Subtraction, 곱셈이면 Division. */
    correction: z.enum(["Subtraction", "Division"]).optional(),
    /** `-smoothing`. 클수록 배경 모델이 부드러워진다. */
    smoothing: Unit.optional(),
    /** `-gpu`. 끄면 느리지만 GPU 문제를 피한다. */
    gpu: z.boolean().optional(),
  })
  .strict();

/**
 * 노이즈 감소 입력.
 *
 * **강도와 배치 크기는 없다.** `GraXpert.exe -h` 에 `-cmd denoising` 용
 * 플래그가 하나도 없다 — `-smoothing` · `-correction` 은 배경 추출 전용이다.
 * 값을 주려면 `-preferences_file` 로 GraXpert 의 설정 파일을 통째로 넘겨야
 * 하는데, Extension 은 승인된 작업 폴더 밖에 파일을 쓸 수 없다.
 *
 * 없는 파라미터를 스키마에 두고 조용히 무시하느니 **빼고 그 이유를 적는다.**
 */
const RunDenoiseInput = z
  .object({
    gpu: z.boolean().optional(),
  })
  .strict();

export function activate(context: ExtensionContext): void {
  const { commands, tools, capabilities, jobs, logger, manifest } = context;

  const exec = <T>(type: string, params: unknown, requestId: string): Promise<T> =>
    commands.execute<T>({ type, params: params as Record<string, unknown> }, { requestId });

  tools.register({
    name: "gx.run_gradient",
    description:
      "그래디언트(빛 공해·배경 기울기)를 제거한다 — GraXpert. 현재 문서를 16비트 TIFF 로 " +
      "내보내 처리한 뒤 **픽셀 레이어 한 장**으로 가져온다. 기존 레이어를 바꾸지 않는다. " +
      "**활성 선택 영역이 있으면 그것을 하늘로 삼는다** — 지상부를 하늘의 연장 평면으로 " +
      "덮어서 넣고, 결과를 그 선택에만 씌운다. 지상 풍경이 든 사진은 선택이 없으면 " +
      "산·나무가 배경 모델을 끌어당겨 하늘에서 뺄 것을 거의 못 찾는다. " +
      "하늘을 고르려면 먼저 photoshop.selection.sky 를 부른다. " +
      "선택이 없으면 활성 레이어 전체를 처리한다 — 어느 쪽으로 갔는지는 결과의 " +
      "selectionAtStart 와 skyApplied 에 담긴다. " +
      "**결과는 언제나 마스크 없는 통짜 픽셀 레이어 한 장이다.** 하늘 경로에서도 " +
      "합성을 파일에서 끝내므로 투명한 곳이 없다 — 바로 이어서 재거나 " +
      "필터를 걸 수 있다. " +
      "**즉시 jobId 를 반환한다.** photoshop.job.status 로 확인한다.",
    permission: "external",
    inputSchema: RunGradientInput,
    handler: (input, toolContext) => {
      const blocked = explainMissing("gradientRemoval", "graxpert");
      if (blocked !== null) {
        throw new Error(blocked);
      }
      const requestId = toolContext.requestId;
      const jobId = jobs.start("gx.run_gradient", async (job) =>
        run(
          {
            capability: "gradientRemoval",
            provider: "graxpert",
            kind: "gradient",
            label: "GraXpert",
            params: pick(input, ["correction", "smoothing", "gpu"]),
          },
          requestId,
          job,
        ),
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
      "노이즈를 줄인다 — GraXpert. 현재 문서를 16비트 TIFF 로 내보내 처리한 뒤 " +
      "**픽셀 레이어 한 장**으로 가져온다. 기존 레이어를 바꾸지 않는다. " +
      "**강도를 지정할 수 없다** — GraXpert CLI 에 `-cmd denoising` 용 플래그가 없어 " +
      "GraXpert 설정에 저장된 값을 쓴다. 강도를 조절하려면 rcastro.nxt 또는 " +
      "photoshop.camera_raw.apply 쪽이 낫다. " +
      "**즉시 jobId 를 반환한다.** photoshop.job.status 로 확인한다.",
    permission: "external",
    inputSchema: RunDenoiseInput,
    handler: (input, toolContext) => {
      const blocked = explainMissing("noiseReduction", "graxpert-denoise");
      if (blocked !== null) {
        throw new Error(blocked);
      }
      const requestId = toolContext.requestId;
      const jobId = jobs.start("gx.run_denoise", async (job) =>
        run(
          {
            capability: "noiseReduction",
            provider: "graxpert-denoise",
            kind: "denoise",
            label: "GraXpert Denoise",
            params: pick(input, ["gpu"]),
          },
          requestId,
          job,
        ),
      );
      return Promise.resolve({
        jobId,
        note: "photoshop.job.status 로 진행 상황을 확인하세요.",
      });
    },
  });

  /**
   * 왜 못 쓰는지. 쓸 수 있으면 `null`.
   *
   * **Job 을 띄우기 전에 본다.** 띄운 뒤에 실패하면 호출자가 jobId 를 받아
   * 들고 status 를 한 번 더 불러야 이유를 안다.
   */
  function explainMissing(capability: string, provider: string): string | null {
    if (!capabilities.has(capability)) {
      return (
        `GraXpert 가 설정되지 않았습니다. capabilities.example.json 을 ` +
        `capabilities.json 으로 복사하고 '${provider}' Provider 의 executable 경로를 ` +
        `확인하세요 (보통 %LOCALAPPDATA%/Programs/GraXpert/GraXpert.exe). ` +
        `npx photoshop-mcp init 이 찾아서 만들어 주기도 합니다.`
      );
    }
    const found = capabilities.describe(capability).find((entry) => entry.id === provider);
    if (found === undefined) {
      return (
        `${capability} 처리기는 있지만 '${provider}' Provider 가 아닙니다. ` +
        `capabilities.json 에 '${provider}' 를 더하세요.`
      );
    }
    if (!found.available) {
      return `'${provider}' 를 쓸 수 없습니다: ${found.reason ?? "이유를 알 수 없습니다"}`;
    }
    return null;
  }

  /** 준 것만 넘긴다 — 여기서 기본값을 겹쳐 두면 Provider 와 두 곳이 갈라진다. */
  function pick(input: unknown, keys: readonly string[]): ProviderParams {
    const source = input as Record<string, ProviderParams[string] | undefined>;
    const out: ProviderParams = {};
    for (const key of keys) {
      if (source[key] !== undefined) {
        out[key] = source[key];
      }
    }
    return out;
  }

  interface RunSpec {
    capability: string;
    provider: string;
    kind: "gradient" | "denoise";
    label: string;
    params: ProviderParams;
  }

  /** 본문. Job 안에서 돈다. */
  async function run(
    spec: RunSpec,
    requestId: string,
    job: { report: (percent: number | null, message: string) => void; signal: AbortSignal },
  ): Promise<unknown> {
    job.report(5, "문서 확인");
    const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);
    const before = await exec<LayerInfo[]>(LAYER_LIST, {}, requestId);

    /* **선택이 있으면 그것을 하늘로 삼는다.** 판단은 호출자가 한다 — 여기서
     * 고르지 않고 있는 그대로 읽어 결과에 담는다. 지상 풍경이 든 사진은
     * 선택이 없으면 산·나무가 배경 모델을 끌어당긴다(ROADMAP §19). */
    const selection =
      spec.kind === "gradient"
        ? await exec<{ hasSelection: boolean }>(SELECTION_GET, {}, requestId)
        : { hasSelection: false };

    const prefix = spec.kind === "gradient" ? "GraXpert" : "GraXpert NR";
    const name = nextLayerName(before, prefix);
    const stem = runStem(document.name, spec.kind === "gradient" ? "graxpert" : "graxpert-nr");

    /* **16비트로 내보낸다.** 8비트로 떨어지면 계조가 무너진다 — 그래디언트
     * 제거는 어두운 배경의 미세한 차이를 다루는 작업이다. */
    job.report(10, "16비트 TIFF 내보내기");
    const exported = await exec<SaveResult>(
      DOCUMENT_EXPORT,
      { filename: stem, format: "tiff", bitDepth: 16 },
      requestId,
    );
    if (exported.bitDepth !== 16) {
      logger.warn(`16비트로 내보내지 못했습니다: ${String(exported.bitDepth)}`);
    }

    /* GraXpert 3.x 는 `-output out.tif` 를 줘도 `out.tif.fits` 를 만든다.
     * 그 버릇은 `outputSuffix` · `convert` 로 설정에 선언되어 있고 Registry 가
     * 찾아 변환한다. 여기서는 요청한 파일이 나온다고만 알면 된다. */
    /* 하늘 선택이 있으면 마스크를 파일로 내보내 지상부를 덮게 한다.
     * 덮는 것은 Capability 가 한다 — 파일 수준 작업이고 서버 쪽에 있다. */
    let maskFile: string | null = null;
    if (selection.hasSelection) {
      job.report(18, "하늘 마스크 내보내기");
      const mask = await exec<SaveResult>(
        SELECTION_EXPORT_MASK,
        { filename: `${stem}_mask` },
        requestId,
      );
      maskFile = mask.filename;
    }

    job.report(25, `${spec.label} 처리 중`);
    const output = `${stem}_out.tif`;
    const run = await capabilities.execute(
      spec.capability,
      {
        input: exported.filename,
        output,
        provider: spec.provider,
        params: spec.params,
        /* 들어갈 때는 지상을 하늘의 연장 평면으로 덮고, 나올 때는 그 가짜를
         * **원본 지상으로 되돌린다.** 둘이 짝이라 언제나 함께 간다. */
        ...(maskFile === null
          ? {}
          : {
              prepare: { kind: "extendSkyPlane" as const, mask: maskFile },
              finish: { kind: "restoreOutsideMask" as const, mask: maskFile },
            }),
      },
      // 취소하면 프로세스를 실제로 죽인다.
      { signal: job.signal },
    );

    /* **맨 위 레이어를 먼저 선택한다.** `layer.place` 는 문서 맨 위가 아니라
     * 활성 레이어 바로 위에 놓는다. (CLAUDE.md — Capability) */
    job.report(85, "레이어로 가져오는 중");
    const top = before[0];
    if (top !== undefined) {
      await exec(LAYER_SELECT, { layerId: top.id }, requestId);
    }

    /* **픽셀로 받는다.** 구워 돌려받은 결과라 스마트 오브젝트가 얻는 것이 없다. */
    const placed = await exec<LayerInfo>(
      LAYER_PLACE,
      { filename: output, name, rasterize: true },
      requestId,
    );

    /* **Photoshop 마스크를 씌우지 않는다.** 합성은 이미 파일에서 끝났다.
     *
     * 처음에는 결과를 그대로 놓고 `mask.create fromSelection` 을 걸었다.
     * 합성 화면은 같지만 **그 레이어 하나는 지상이 투명하다.** 투명은 뒤따르는
     * 작업마다 걸린다 — `document.statistics` 가 알파를 안 보고 RGB 만 읽어
     * 투명한 곳이 0 으로 섞였고, 실기에서 첫 측정이 바로 그것에 걸렸다.
     * 통짜 한 장이면 뒤따르는 Tool 이 아무것도 몰라도 된다. (ROADMAP §19) */
    const masked = run.finished === "restoreOutsideMask";

    logger.info(`${spec.label} 완료: ${placed.name}${masked ? " (하늘만)" : ""}`);
    job.report(100, "완료");
    return {
      layer: placed,
      /* **어느 경로로 갔는지 담는다.** 선택이 있었는지와 실제로 하늘에만
       * 걸었는지는 다른 사실이다 — 설정값이 아니라 Capability 가 보고한
       * `finished` 로 판정한다. */
      selectionAtStart: selection.hasSelection,
      skyApplied: masked,
      /* 중간 파일을 알려 준다. 한 번 돌 때마다 140MB 가 여럿 생긴다 —
       * photoshop.workspace.usage 로 확인하고 delete 로 지운다. */
      files: [
        exported.filename,
        output,
        ...(maskFile === null ? [] : [maskFile]),
        ...(run.preparedPath === undefined ? [] : [run.preparedPath]),
      ],
      provider: spec.provider,
    };
  }

  logger.info(`GraXpert Extension 적재됨 (${manifest.version})`);
}
