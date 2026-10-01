import {
  DOCUMENT_EXPORT,
  DOCUMENT_GET,
  LAYER_BLEND_MODE,
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
 * RC-Astro CLI Extension.
 *
 * Core 는 Photoshop 을 알고, 이 Extension 은 RC-Astro CLI 의 파라미터 어휘를
 * 안다. (ARCHITECTURE §1)
 *
 * **왜 Core Tool 이 아닌가.** RC-Astro 는 Photoshop 기능이 아니라 별도 제품이다.
 * Core 에 넣으면 그것을 설치하지 않은 사람에게도 목록에 보인다.
 *
 * **왜 액션이 아닌가.** RC-Astro 는 Photoshop 플러그인으로도 있고 그쪽은
 * `필터 > RC-Astro` 메뉴를 거치므로 `photoshop.action.run` 으로 돌아간다
 * (CLAUDE.md — GraXpert 패널). 그러나 액션은 **무엇을 하는지 알 수 없어
 * `destructive`** 이고, 녹화된 값이 고정이라 파라미터를 바꿀 수 없다.
 *
 * **왜 프로세스를 직접 띄우지 않는가.** Extension 은 임의의 프로그램을 실행할
 * 수 없다 (ARCHITECTURE §23). 실행 파일은 `capabilities.json` 에서만 오고 argv 는
 * 선언된 파라미터로만 조립된다. 그래서 Capability 를 요청한다.
 *
 * **왜 제품별로 폴더를 나누지 않는가.** `rc-astro.exe` 하나가 `bxt` · `nxt` 를
 * 다 가진다. 한 제품 · 한 설치이므로 사용자가 패널에서 한 번만 등록하면 된다.
 */

/**
 * 선명화 입력 — `rc-astro bxt` 의 실제 옵션이다 (CLI 2.6.9 build 727).
 *
 * **생략한 것이 있다.** `--nonstellar-diameter` 는 `--auto-nonstellar-psf` 가
 * 거짓일 때만 쓸 수 있는 짝이고, `--device` · `--depth` · `--overlap` ·
 * `--ml-version` 은 처리기 설정에 속한다. 안 쓰는 파라미터가 스키마에 있으면
 * 호출자가 무엇이 중요한지 모른다.
 *
 * 값을 주지 않으면 **Provider 의 기본값**이 쓰인다. 여기서 기본값을 겹쳐 두면
 * 두 곳이 갈라진다.
 */
const SharpenInput = z
  .object({
    /** 별의 선명화 정도. 기본 0.5 */
    sharpenStars: z.number().min(0).max(0.7).optional(),
    /** 성운·은하 등 별이 아닌 것의 선명화 정도. 기본 0.5 */
    sharpenNonstellar: z.number().min(0).max(1).optional(),
    /** 별 헤일로. 음수는 줄이고 양수는 키운다. 기본 0 */
    starHalos: z.number().min(-0.5).max(0.5).optional(),
    /** 달·행성 모드. 별이 없는 대상에 쓴다. */
    lunarPlanetary: z.boolean().optional(),
    /** PSF 수차만 보정하고 **선명화는 하지 않는다.** 위 값들은 효과가 없어진다. */
    correctOnly: z.boolean().optional(),
  })
  .strict();

/**
 * 노이즈 감소 입력 — `rc-astro nxt` 의 실제 옵션이다.
 *
 * **CLI 가 겹치는 강도 옵션을 거절한다.**
 *
 * ```text
 * Error: Conflicting denoise options: Denoise (denoise) and
 *        Denoise Intensity (denoise-intensity) both control
 *        the intensity, high-frequency noise band.
 * ```
 *
 * Provider 는 겹치지 않는 **intensity + color 쌍**만 선언한다 — `buildArgs` 가
 * 선언한 파라미터를 항상 전부 보내므로, 상위 `--denoise` 를 함께 두면 모든
 * 호출이 실패한다.
 *
 * `denoise` 는 그 둘을 한 번에 주는 **편의 입력**이며 여기서 풀어 넘긴다.
 * 천체사진에서는 색 노이즈를 휘도보다 세게 잡는 일이 흔해 나눠 둘 값이 있다.
 *
 * **생략한 것.** 주파수 대역별 네 개(`--denoise-*-high-freq` 등)와
 * `--frequency-scale` 은 그 넷을 쓸 때만 뜻이 있다. 함께 노출하면 "어느 것이
 * 어느 것과 겹치는가" 를 호출자가 외워야 한다.
 */
const DenoiseInput = z
  .object({
    /** 전체 강도. `denoiseIntensity` · `denoiseColor` 를 함께 정한다. 기본 0.9 */
    denoise: z.number().min(0).max(1).optional(),
    /** 휘도 노이즈 강도. 주면 `denoise` 보다 우선한다. */
    denoiseIntensity: z.number().min(0).max(1).optional(),
    /** 색 노이즈 강도. 주면 `denoise` 보다 우선한다. */
    denoiseColor: z.number().min(0).max(1).optional(),
    /** 반복 횟수. 기본 2 */
    iterations: z.number().min(1).max(5).optional(),
  })
  .strict();

/**
 * 별 제거 입력 — `rc-astro sxt` 의 실제 옵션이다.
 *
 * **`--output-stars` 를 노출하지 않는다.** 언제나 켠다 — 별 이미지가 없으면
 * 되돌릴 수 없고, `--unscreen` 이 그것을 요구한다. 둘 다 노출하면 `buildArgs` 가
 * 항상 전부 보내므로 조합에 따라 CLI 가 거절한다.
 *
 * ```text
 * Error: Conflicting options: Unscreen Stars (unscreen) must ...
 * ```
 */
const RemoveStarsInput = z
  .object({
    /**
     * 별 이미지를 unscreen 한다.
     *
     * 켜면 별 레이어를 **Screen** 으로 얹었을 때 원본이 복원된다.
     * 이 Tool 이 별 레이어에 Screen 을 걸어 두므로 보통 켜는 쪽이 맞다.
     */
    unscreen: z.boolean().optional(),
  })
  .strict();

type Params = Record<string, string | number | boolean>;

/** 주어진 것만 넘긴다. 생략한 것은 Provider 기본값이 쓰인다. */
function definedOnly(input: Record<string, unknown>): Params {
  const params: Params = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      params[key] = value as string | number | boolean;
    }
  }
  return params;
}

/** `denoise` 를 Provider 가 아는 두 파라미터로 푼다. */
function toDenoiseParams(input: z.infer<typeof DenoiseInput>): Params {
  const intensity = input.denoiseIntensity ?? input.denoise;
  const color = input.denoiseColor ?? input.denoise;
  return definedOnly({
    denoiseIntensity: intensity,
    denoiseColor: color,
    iterations: input.iterations,
  });
}

export function activate(context: ExtensionContext): void {
  const { commands, tools, capabilities, jobs, logger, manifest } = context;

  const exec = <T>(type: string, params: unknown, requestId: string): Promise<T> =>
    commands.execute<T>({ type, params: params as Record<string, unknown> }, { requestId });

  /** 제품 하나의 설정. 흐름은 같고 이것만 다르다. */
  interface Product {
    /** `capabilities.json` 의 capability 이름. */
    capability: string;
    /** Provider id. 파라미터 이름을 그대로 넘기므로 못 박는다. */
    provider: string;
    /** 레이어 이름 접두사이자 임시 파일 토큰. */
    code: string;
    /** 사람이 읽는 이름. 오류 메시지에 쓴다. */
    label: string;
    progress: string;
    /**
     * 처리기가 **스스로 이름을 정해** 함께 만드는 출력의 접미사.
     *
     * SXT 는 별 이미지를 `--output` 옆에 `<stem>-stars.<ext>` 로 쓴다.
     * 경로를 받지 않으므로 Provider 의 `outputs` 로 선언할 수 없다 —
     * `assertConfigConsistent` 가 `{{output.<이름>}}` 을 args 에 넣으라고 요구하는데
     * 넣을 인자가 없다.
     *
     * 그래서 이 Extension 이 이름을 안다. **제품 전용 어댑터라 허용되는 결합이다** —
     * 도메인 코드(대상별 워크플로)가 알면 처리기를 바꿀 때 도메인이 따라 바뀐다.
     * Registry 가 확인해 주지 않으므로 없으면 `layer.place` 가 FILE_NOT_FOUND 로 막는다.
     */
    sideOutput?: { suffix: string; layerSuffix: string; blendMode: string };
  }

  const BXT: Product = {
    capability: "deconvolution",
    provider: "bxt",
    code: "BXT",
    label: "BlurXTerminator",
    progress: "BlurXTerminator 처리 중",
  };

  const SXT: Product = {
    capability: "starRemoval",
    provider: "sxt",
    code: "SXT",
    label: "StarXTerminator",
    progress: "StarXTerminator 처리 중",
    sideOutput: { suffix: "-stars", layerSuffix: " 별", blendMode: "screen" },
  };

  const NXT: Product = {
    capability: "noiseReduction",
    provider: "nxt",
    code: "NXT",
    label: "NoiseXTerminator",
    progress: "NoiseXTerminator 처리 중",
  };

  tools.register({
    /* **이름이 CLI 서브커맨드와 같다.** `rc-astro bxt` 다. 레이어 이름(`BXT 01`)과
     * Job kind 도 같아 한 낱말로 이어진다.
     *
     * 동작 낱말(`sharpen`)을 쓰지 않은 대신 **설명이 그것으로 시작한다** —
     * 이름만으로는 무엇을 하는지 알 수 없기 때문이다. */
    name: "rcastro.bxt",
    description:
      "선명화한다 — BlurXTerminator(RC-Astro CLI). 현재 문서를 16비트 TIFF 로 " +
      "내보내 처리한 뒤 **픽셀 레이어**로 가져온다. 기존 레이어를 바꾸지 않는다. " +
      "달·행성은 lunarPlanetary 를 켠다. PSF 수차만 잡으려면 correctOnly 를 켠다. " +
      "**즉시 jobId 를 반환한다.** 큰 이미지는 MCP 요청 안에서 끝낼 수 없다. " +
      "photoshop.job.status 로 상태를 확인하고, completed 가 되면 result 에 결과가 담긴다.",
    permission: "external",
    inputSchema: SharpenInput,
    handler: (input, toolContext) => start(BXT, definedOnly(input), toolContext.requestId),
  });

  tools.register({
    /* 노이즈 감소 경로가 셋이라(`graxpert.run_denoise` · `camera_raw.apply` · 이것)
     * 제품 이름이 모호함을 없앤다. */
    name: "rcastro.nxt",
    description:
      "노이즈를 줄인다 — NoiseXTerminator(RC-Astro CLI). 현재 문서를 16비트 TIFF 로 " +
      "내보내 처리한 뒤 **픽셀 레이어**로 가져온다. 기존 레이어를 바꾸지 않는다. " +
      "denoise 로 전체 강도를 주거나, denoiseIntensity(휘도) · denoiseColor(색) 를 " +
      "따로 준다 — 천체사진은 색 노이즈를 더 세게 잡는 일이 흔하다. " +
      "**즉시 jobId 를 반환한다.** photoshop.job.status 로 상태를 확인한다.",
    permission: "external",
    inputSchema: DenoiseInput,
    handler: (input, toolContext) => start(NXT, toDenoiseParams(input), toolContext.requestId),
  });

  tools.register({
    name: "rcastro.sxt",
    description:
      "별을 분리한다 — StarXTerminator(RC-Astro CLI). 현재 문서를 16비트 TIFF 로 " +
      "내보내 처리한 뒤 **픽셀 레이어 두 장**으로 가져온다 — 별 없는 것과 별만 있는 것. " +
      "별 레이어에는 Screen 이 걸려 있어 둘을 함께 켜면 원본이 된다. " +
      "성운·은하를 별과 따로 보정할 때 쓴다. 기존 레이어를 바꾸지 않는다. " +
      "**즉시 jobId 를 반환한다.** photoshop.job.status 로 상태를 확인한다.",
    permission: "external",
    inputSchema: RemoveStarsInput,
    handler: (input, toolContext) => start(SXT, definedOnly(input), toolContext.requestId),
  });

  /**
   * Job 을 띄우고 즉시 ID 를 돌려준다.
   *
   * **Capability 가 준비됐는지 먼저 본다.** Job 을 띄운 뒤에 실패하면 호출자가
   * jobId 를 받아 들고 `photoshop.job.status` 를 한 번 더 불러야 이유를 안다.
   * 준비 문제는 부르는 자리에서 말한다.
   */
  function start(product: Product, params: Params, requestId: string): Promise<unknown> {
    const blocked = explainMissing(product);
    if (blocked !== null) {
      throw new Error(blocked);
    }

    const jobId = jobs.start(`rcastro.${product.provider}`, async (job) =>
      run(product, params, requestId, job),
    );
    return Promise.resolve({
      jobId,
      note: "photoshop.job.status 로 진행 상황을 확인하세요. 큰 이미지는 수 분 걸립니다.",
    });
  }

  /**
   * 왜 못 쓰는지. 쓸 수 있으면 `null`.
   *
   * 무엇이 왜 안 되는지 말해주지 않으면 사용자가 고칠 수 없다.
   */
  function explainMissing(product: Product): string | null {
    if (!capabilities.has(product.capability)) {
      return (
        `${product.label} 처리기가 설정되지 않았습니다. capabilities.example.json 을 ` +
        `capabilities.json 으로 복사하고 '${product.provider}' Provider 의 executable ` +
        "경로를 확인하세요 (보통 C:/Program Files/RC-Astro/CLI/rc-astro.exe). " +
        "npx photoshop-mcp init 이 찾아서 만들어 주기도 합니다."
      );
    }
    const found = capabilities
      .describe(product.capability)
      .find((entry) => entry.id === product.provider);
    if (found === undefined) {
      return (
        `${product.capability} 처리기는 있지만 '${product.provider}' Provider 가 아닙니다. ` +
        `이 Tool 은 ${product.label} 의 파라미터 이름을 그대로 넘기므로 ` +
        "다른 처리기로는 동작하지 않습니다. capabilities.json 을 확인하세요."
      );
    }
    if (!found.available) {
      return `'${product.provider}' Provider 를 쓸 수 없습니다: ${found.reason ?? "이유를 알 수 없습니다"}`;
    }
    return null;
  }

  /**
   * 본문. Job 안에서 돈다.
   *
   * 짧게 끝나도 jobId 를 돌려주므로 여기까지 오는 경로는 하나다. 실기에서
   * BXT 는 10초 · NXT 는 7초였지만 **처리 시간은 이미지 크기에 따라 변한다** —
   * StarNet2 가 4032×6048 에서 67초로 MCP 기본 타임아웃 60초를 넘겼다.
   */
  async function run(
    product: Product,
    params: Params,
    requestId: string,
    job: { report: (percent: number | null, message: string) => void; signal: AbortSignal },
  ): Promise<unknown> {
    job.report(5, "문서 확인");
    const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);
    const before = await exec<LayerInfo[]>(LAYER_LIST, {}, requestId);

    const name = nextLayerName(before, product.code);
    const stem = runStem(document.name, product.code);

    /* **16비트로 내보낸다.** RC-Astro 의 `--depth` 기본값이 "입력과 같음" 이라
     * 8비트로 넣으면 8비트로 나온다. 천체사진의 계조가 무너진다. */
    job.report(10, "16비트 TIFF 내보내기");
    const exported = await exec<SaveResult>(
      DOCUMENT_EXPORT,
      { filename: stem, format: "tiff", bitDepth: 16 },
      requestId,
    );

    job.report(25, product.progress);
    const processed = await capabilities.execute(
      product.capability,
      {
        input: exported.filename,
        output: `${stem}_out.tif`,
        // 파라미터 이름을 그대로 넘기므로 Provider 를 못 박는다.
        provider: product.provider,
        params,
      },
      { signal: job.signal },
    );

    /* **맨 위 레이어를 먼저 선택한다.**
     *
     * `layer.place` 는 문서 맨 위가 아니라 **활성 레이어 바로 위**에 놓고,
     * 활성 레이어가 그룹 안이면 같은 그룹으로 들어간다. (CLAUDE.md — Capability) */
    job.report(85, "레이어로 가져오는 중");
    const top = before[0];
    if (top !== undefined) {
      await exec(LAYER_SELECT, { layerId: top.id }, requestId);
    }

    /* **픽셀로 받는다.** 구워 돌려받은 결과라 스마트 오브젝트가 얻는 것이 없다 —
     * 더블클릭해도 처리기가 다시 돌지 않고 구워진 TIFF 가 열릴 뿐이다.
     * 나중에 굽는 길이 마땅치 않아 **안 만드는 것이 낫다.** */
    const placed = await exec<LayerInfo>(
      LAYER_PLACE,
      { filename: `${stem}_out.tif`, name, rasterize: true },
      requestId,
    );
    const layers = [{ id: placed.id, name: placed.name }];
    const files = Object.values(processed.outputPaths);

    /* 처리기가 함께 만든 출력을 그 위에 올린다. `layer.place` 가 활성 레이어
     * 바로 위에 놓으므로, 방금 놓은 것이 활성이라 자연히 그 위가 된다. */
    const side = product.sideOutput;
    if (side !== undefined) {
      job.report(92, "별 레이어 가져오는 중");
      const sideName = `${name}${side.layerSuffix}`;
      const sidePlaced = await exec<LayerInfo>(
        LAYER_PLACE,
        { filename: `${stem}_out${side.suffix}.tif`, name: sideName, rasterize: true },
        requestId,
      );

      /* **Screen 을 걸어 둔다.** 걸지 않으면 별 이미지가 검은 배경째 위를 덮어
       * 문서가 온통 검게 보인다 — 무엇이 잘못됐는지 알 수 없다. */
      await exec(
        LAYER_BLEND_MODE,
        { layerId: sidePlaced.id, blendMode: side.blendMode },
        requestId,
      );
      layers.push({ id: sidePlaced.id, name: sidePlaced.name });
      files.push(`${stem}_out${side.suffix}.tif`);
    }

    logger.info(`${product.label} 완료: ${name}`);
    job.report(100, "완료");

    return {
      layer: layers[0],
      /** 만들어진 레이어 전부. 아래에서 위 순서다. */
      layers,
      provider: processed.provider,
      seconds: Math.round(processed.durationMs / 1000),
      /* **중간 파일을 알려준다.** 한 번에 140MB 짜리가 여럿 생긴다.
       * `photoshop.workspace.usage` 로 확인하고 `delete` 로 지운다. */
      files,
    };
  }

  logger.info(`${manifest.name} 활성화됨 — Tool 3개 등록`);
}
