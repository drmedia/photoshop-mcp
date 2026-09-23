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
 * StarNet2 Extension.
 *
 * Core 는 Photoshop 을 알고, 이 Extension 은 StarNet2 CLI 의 어휘를 안다.
 * (ARCHITECTURE §1)
 *
 * **`milky.remove_stars` 에서 옮겨 왔다**(`extensions/milkyscape`, 제거됨).
 * 그쪽은 은하수 도메인에 묶여 있었는데, 별 분리는 대상과 무관하다.
 *
 * **왜 `rcastro` 와 합치지 않는가.** 실행 파일이 다르다 — `starnet2.exe` 와
 * `rc-astro.exe` 는 따로 설치하고 따로 산다. 한쪽만 깐 사람에게 다른 쪽 Tool 이
 * 보이면 안 된다. `rcastro` 안에 `bxt`·`nxt`·`sxt` 를 함께 둔 것은 **한 실행
 * 파일**이기 때문이다.
 *
 * `rcastro.sxt`(StarXTerminator)도 별을 분리한다. 둘 다 `starRemoval` Capability
 * 지만 결과가 다르고, 어느 쪽을 쓸지는 사용자가 정한다. 그래서 각 Tool 이
 * `provider` 를 못 박는다.
 */

/**
 * 별 분리 입력 — `starnet2 --help` 와 `--machine-info` 의 실제 값이다
 * (StarNet2 2.6.0 build 0231). 짐작한 것이 없다.
 *
 * **`--upsample` · `--linear` 은 노출하지 않는다.** 값 없는 플래그인데
 * `buildArgs` 는 선언한 파라미터를 **항상 전부** 보내므로 "끄는 방법" 이 없다.
 * StarNet2 는 `=` 형식도 받지 않는다 — RC-Astro 와 정반대다.
 *
 * ```text
 * RC-Astro    불리언은 `=` 만 받는다. 값 옵션은 공백도 된다
 * StarNet2    `=` 를 아예 안 받는다. 불리언은 값 없는 플래그다
 * ```
 *
 * `--shadows-clipping` · `--target-background` 는 `--linear` 을 요구하므로
 * 함께 빠진다. `--mask` 는 세 번째 출력이라 지금 범위 밖이다.
 */
const RemoveStarsInput = z
  .object({
    /**
     * 타일 보폭. **생략하면 256 이고 그것이 대부분 맞다.**
     *
     * 작을수록 이음매가 줄지만 **연산량이 제곱으로 는다.** 실기에서 같은
     * 4032×6048 문서가 이렇게 갈렸다.
     *
     * ```text
     * 256 (기본)   67초
     * 64           15분을 넘겨 취소했다   — 타일이 축마다 4배, 연산 약 16배
     * ```
     *
     * 실기에서 호출자가 이 값을 두 번 연속 64 로 넣어 두 번 다 취소했다.
     * "작을수록 이음매가 준다" 만 적어 두었고 **그 대가를 안 적었기**
     * 때문이다. 고르는 쪽이 대가를 모르면 언제나 작은 값을 고른다.
     *
     * **짝수여야 한다** — CLI 가 "Stride should be even!" 으로 거절한다.
     * 여기서 먼저 막아 내보내기까지 간 뒤에 실패하지 않게 한다.
     */
    stride: z.number().int().min(2).max(512).multipleOf(2).optional(),
  })
  .strict();

export function activate(context: ExtensionContext): void {
  const { commands, tools, capabilities, jobs, logger, manifest } = context;

  const exec = <T>(type: string, params: unknown, requestId: string): Promise<T> =>
    commands.execute<T>({ type, params: params as Record<string, unknown> }, { requestId });

  tools.register({
    name: "starnet.remove_stars",
    description:
      "별을 분리한다 — StarNet2. 현재 문서를 16비트 TIFF 로 내보내 처리한 뒤 " +
      "**픽셀 레이어 두 장**으로 가져온다 — 별 없는 것과 별만 있는 것. " +
      "별 레이어에는 Screen 이 걸려 있어 둘을 함께 켜면 원본이 된다. " +
      "성운·은하를 별과 따로 보정할 때 쓴다. 기존 레이어를 바꾸지 않는다. " +
      "**즉시 jobId 를 반환한다.** 실기에서 4032×6048 이 67초였다 — " +
      "MCP 요청 안에서 끝낼 수 없다. photoshop.job.status 로 상태를 확인한다. " +
      "**stride 는 주지 않는 것이 기본이다**(256). 낮추면 이음매가 줄지만 " +
      "연산량이 제곱으로 늘어 64 는 같은 문서에서 15분을 넘긴다. " +
      "결과에 이음매가 실제로 보일 때만 낮춘다.",
    permission: "external",
    inputSchema: RemoveStarsInput,
    handler: (input, toolContext) => {
      /* **Capability 가 준비됐는지 먼저 본다.** Job 을 띄운 뒤에 실패하면
       * 호출자가 jobId 를 받아 들고 status 를 한 번 더 불러야 이유를 안다. */
      const blocked = explainMissing();
      if (blocked !== null) {
        throw new Error(blocked);
      }

      const requestId = toolContext.requestId;
      // 주지 않으면 Provider 기본값(256)이 쓰인다. 여기서 겹쳐 두면 두 곳이 갈라진다.
      const params: Record<string, number> = {};
      if (input.stride !== undefined) {
        params["stride"] = input.stride;
      }
      const jobId = jobs.start("starnet.remove_stars", async (job) => run(params, requestId, job));
      return Promise.resolve({
        jobId,
        note: "photoshop.job.status 로 진행 상황을 확인하세요. 큰 이미지는 1분을 넘습니다.",
      });
    },
  });

  /** 왜 못 쓰는지. 쓸 수 있으면 `null`. */
  function explainMissing(): string | null {
    if (!capabilities.has("starRemoval")) {
      return (
        "StarNet2 가 설정되지 않았습니다. capabilities.example.json 을 " +
        "capabilities.json 으로 복사하고 'starnet2' Provider 의 executable 경로를 " +
        "확인하세요 (보통 C:/Program Files/StarNet2/bin/starnet2.exe). " +
        "npx photoshop-mcp init 이 찾아서 만들어 주기도 합니다."
      );
    }
    const found = capabilities.describe("starRemoval").find((entry) => entry.id === "starnet2");
    if (found === undefined) {
      return (
        "starRemoval 처리기는 있지만 'starnet2' Provider 가 아닙니다. " +
        "StarXTerminator 를 쓰려면 rcastro.sxt 입니다. capabilities.json 을 확인하세요."
      );
    }
    if (!found.available) {
      return `'starnet2' 를 쓸 수 없습니다: ${found.reason ?? "이유를 알 수 없습니다"}`;
    }
    return null;
  }

  /**
   * 본문. Job 안에서 돈다.
   *
   * **실기에서 4032×6048 이 67초였다** — MCP 기본 타임아웃 60초를 넘겨
   * 실제 클라이언트에서 `-32001 Request timed out` 이 났던 그 경우다.
   */
  async function run(
    params: Record<string, number>,
    requestId: string,
    job: { report: (percent: number | null, message: string) => void; signal: AbortSignal },
  ): Promise<unknown> {
    job.report(5, "문서 확인");
    const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);
    const before = await exec<LayerInfo[]>(LAYER_LIST, {}, requestId);

    const name = nextLayerName(before, "StarNet");
    const stem = runStem(document.name, "starnet");

    /* **16비트로 내보낸다.** 8비트로 떨어지면 계조가 무너진다. */
    job.report(10, "16비트 TIFF 내보내기");
    const exported = await exec<SaveResult>(
      DOCUMENT_EXPORT,
      { filename: stem, format: "tiff", bitDepth: 16 },
      requestId,
    );
    if (exported.bitDepth !== 16) {
      logger.warn(`16비트로 내보내지 못했습니다: ${String(exported.bitDepth)}`);
    }

    /* StarNet2 는 **출력 경로를 둘 다 받는다** — 별 제거본과 별 이미지.
     * StarXTerminator 와 다른 점이다. 그쪽은 별 이미지 이름을 스스로 정해
     * `outputs` 로 선언할 수 없다. 이 단계가 대부분의 시간을 먹는다. */
    job.report(25, "StarNet2 로 별 분리 중");
    const processed = await capabilities.execute(
      "starRemoval",
      {
        input: exported.filename,
        output: `${stem}_starless.tif`,
        outputs: { stars: `${stem}_stars.tif` },
        provider: "starnet2",
        params,
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
    const starless = await exec<LayerInfo>(
      LAYER_PLACE,
      { filename: `${stem}_starless.tif`, name, rasterize: true },
      requestId,
    );
    const stars = await exec<LayerInfo>(
      LAYER_PLACE,
      { filename: `${stem}_stars.tif`, name: `${name} 별`, rasterize: true },
      requestId,
    );

    /* **Screen 을 걸어 둔다.** StarNet2 의 `--unscreen` 출력은 Screen 으로
     * 얹어야 원래 밝기가 복원된다. 걸지 않으면 별 이미지가 검은 배경째 위를
     * 덮어 문서가 온통 검게 보인다 — 무엇이 잘못됐는지 알 수 없다. */
    const blended = await exec<LayerInfo>(
      LAYER_BLEND_MODE,
      { layerId: stars.id, blendMode: "screen" },
      requestId,
    );

    logger.info(`별 분리 완료: ${name} · ${blended.name}`);
    job.report(100, "완료");

    return {
      starless: { id: starless.id, name: starless.name },
      stars: { id: blended.id, name: blended.name, blendMode: blended.blendMode },
      provider: processed.provider,
      seconds: Math.round(processed.durationMs / 1000),
      /* **중간 파일을 알려준다.** 한 번에 140MB 짜리가 셋 생긴다.
       * 지우지 않는다 — 사용자 폴더의 파일을 말없이 지우지 않는다.
       * `photoshop.workspace.usage` 로 확인하고 `delete` 로 지운다. */
      files: Object.values(processed.outputPaths),
    };
  }

  logger.info(`${manifest.name} 활성화됨 — Tool 1개 등록`);
}
