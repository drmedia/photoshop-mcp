import {
  DOCUMENT_EXPORT,
  DOCUMENT_GET,
  LAYER_LIST,
  LAYER_PLACE,
  LAYER_SELECT,
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
      "**활성 레이어 전체를 처리한다 — 하늘만 고르지 않는다.** 지상 풍경이 든 사진은 " +
      "산·나무가 배경 모델을 끌어당기므로, 하늘에만 적용하려면 photoshop.selection.sky 로 " +
      "고른 뒤 결과 레이어에 photoshop.mask.create { from: 'fromSelection' } 를 씌운다. " +
      "격리가 필요한지는 photoshop.document.statistics 로 재서 판단한다. " +
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
    job.report(25, `${spec.label} 처리 중`);
    const output = `${stem}_out.tif`;
    await capabilities.execute(
      spec.capability,
      { input: exported.filename, output, provider: spec.provider, params: spec.params },
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

    logger.info(`${spec.label} 완료: ${placed.name}`);
    job.report(100, "완료");
    return {
      layer: placed,
      /* 중간 파일을 알려 준다. 한 번 돌 때마다 140MB 가 둘 생긴다 —
       * photoshop.workspace.usage 로 확인하고 delete 로 지운다. */
      files: [exported.filename, output],
      provider: spec.provider,
    };
  }

  logger.info(`GraXpert Extension 적재됨 (${manifest.version})`);
}
