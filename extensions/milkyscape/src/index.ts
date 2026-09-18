import {
  DOCUMENT_EXPORT,
  DOCUMENT_GET,
  LAYER_BLEND_MODE,
  LAYER_LIST,
  LAYER_OPACITY,
  LAYER_PLACE,
  LAYER_SELECT,
  WORKSPACE_STATUS,
  type DocumentInfo,
  type ExtensionContext,
  type LayerInfo,
  type SaveResult,
  type WorkspaceStatus,
} from "@photoshop-mcp/extension-sdk";
import { z } from "zod";
import { SHARPENED, STARLESS, STARS, findByKind, latestOfKind, nextName } from "./layers.js";

/**
 * MilkyScape Extension. (ROADMAP §10)
 *
 * 지상 풍경이 포함된 은하수 사진 편집 도메인. Core 는 Photoshop 을 알고,
 * 이 Extension 은 이 작업 도메인을 안다. (ARCHITECTURE §1)
 *
 * ## 기존 MilkyScape 패널에서 가져온 원칙
 *
 * - 매번 **새 결과 레이어**를 만든다. 기존 결과와 사용자 수정을 덮어쓰거나
 *   자동으로 지우지 않는다. (개발계획서 §2-8, §2-9)
 * - 결과 이름에 도구·기능·실행 번호를 넣는다. (§5.2)
 * - **자동 연쇄 처리하지 않는다.** 한 기능의 결과를 다음 기능이 알아서 먹지 않는다. (§5.2)
 * - 권장 순서는 있지만 선행 조건이 아니다. (§2-3)
 *
 * ## 이 버전에 없는 것
 *
 * - `remove_gradient` — GraXpert CLI 가 FITS 만 출력하고 Photoshop 이 못 읽는다.
 *   FITS → TIFF 변환이 필요하다.
 * - `create_sky_mask` · `create_foreground_mask` — 기존 MilkyScape 는 하늘 마스크를
 *   **만들지 않는다.** 사용자가 두 사진을 정렬해 만든 합성 마스크를 입력으로 받는다.
 *   Photoshop 자체 '하늘 선택' 은 Photoshop 기능이지 이 도메인의 지식이 아니므로
 *   Core 에 속한다.
 */

const Empty = z.object({}).strict();

/**
 * 인자를 받지 않는다.
 *
 * 그룹 묶기 옵션을 두려다 뺐다. 동작하지 않는 옵션을 선언하면 호출자가 있는 줄 알고
 * 쓴다. 필요하면 photoshop.group.create 로 직접 묶을 수 있다.
 */
const RemoveStarsInput = z.object({}).strict();

const RestoreStarsInput = z
  .object({
    /** 되살릴 별 레이어. 생략하면 가장 최근 것. */
    layerId: z.number().int().positive().optional(),
    /** 별 레이어의 불투명도 0–100. 생략하면 그대로 둔다. */
    opacity: z.number().min(0).max(100).optional(),
  })
  .strict();

const EnhanceInput = z
  .object({
    /** 비항성 선명화 강도 0–1. 생략하면 Provider 기본값. */
    nonstellar: z.number().min(0).max(1).optional(),
  })
  .strict();

/** 문서 이름에서 파일 이름에 쓸 수 있는 부분만 남긴다. */
function slug(name: string): string {
  const base = name.replace(/\.[^.]+$/u, "");
  const cleaned = base.replace(/[\\/:*?"<>|\s]+/gu, "-").slice(0, 40);
  return cleaned.length > 0 ? cleaned : "doc";
}

/**
 * 임시 파일 이름의 기준.
 *
 * 레이어 번호에서 파생하지 않는다. 실행이 중간에 실패하면 내보낸 파일은 남는데
 * 레이어는 만들어지지 않아 번호가 그대로다. 그러면 재시도할 때마다 같은 이름으로
 * 내보내려다 `FILE_ALREADY_EXISTS` 로 **영구히 막힌다.** 실기에서 확인했다.
 *
 * 임시 파일은 중간 산출물이고 레이어 이름은 사용자가 보는 결과다. 둘을 같은
 * 카운터에서 파생하면 하나의 실패가 다른 하나를 오염시킨다.
 */
function runStem(documentName: string, feature: string): string {
  const token = Date.now().toString(36).slice(-6);
  return `${slug(documentName)}-${feature}-${token}`;
}

export function activate(context: ExtensionContext): void {
  const { commands, tools, capabilities, logger, manifest } = context;

  const exec = <T>(type: string, params: unknown, requestId: string): Promise<T> =>
    commands.execute<T>({ type, params: params as Record<string, unknown> }, { requestId });

  const listLayers = (requestId: string): Promise<LayerInfo[]> =>
    exec<LayerInfo[]>(LAYER_LIST, {}, requestId);

  // ---------------------------------------------------------------------------

  tools.register({
    name: "milky.get_state",
    description:
      "은하수 사진 편집에 필요한 현재 상태를 요약한다. " +
      "문서 정보, 작업 폴더 승인 여부, 사용 가능한 외부 처리기, " +
      "이미 만들어진 MilkyScape 결과 레이어를 함께 보고한다. " +
      "무엇을 할 수 있고 무엇이 막혀 있는지 먼저 확인할 때 쓴다.",
    permission: "read",
    inputSchema: Empty,
    handler: async (_input, toolContext) => {
      const { requestId } = toolContext;
      const [document, layers, workspace] = await Promise.all([
        exec<DocumentInfo>(DOCUMENT_GET, {}, requestId),
        listLayers(requestId),
        exec<WorkspaceStatus>(WORKSPACE_STATUS, {}, requestId),
      ]);

      const providers = capabilities.describe();
      const starless = latestOfKind(layers, STARLESS);
      const stars = latestOfKind(layers, STARS);

      return {
        extension: { id: manifest.id, version: manifest.version },
        document: {
          name: document.name,
          size: `${document.width}x${document.height}`,
          bitDepth: document.bitDepth,
          colorMode: document.colorMode,
          layerCount: layers.length,
        },
        // 저장 폴더가 없으면 외부 처리기를 쓸 수 없다. 가장 흔한 막힘 원인이다.
        workspace,
        capabilities: {
          available: capabilities.list(),
          providers: providers.map((p) => ({ id: p.id, capability: p.capability })),
        },
        results: {
          starless: starless === null ? null : { id: starless.id, name: starless.name },
          stars: stars === null ? null : { id: stars.id, name: stars.name },
          starlessCount: findByKind(layers, STARLESS).length,
          sharpenedCount: findByKind(layers, SHARPENED).length,
        },
        blocked: blockedReasons(workspace, capabilities.list()),
      };
    },
  });

  // ---------------------------------------------------------------------------

  tools.register({
    name: "milky.remove_stars",
    description:
      "별을 분리한다. 현재 문서를 16비트 TIFF 로 내보내 StarNet2 로 처리한 뒤, " +
      "별을 지운 이미지와 별만 남긴 이미지를 **두 개의 새 레이어**로 가져온다. " +
      "별 레이어는 스크린 혼합으로 설정되어 바로 재합성할 수 있다. " +
      "기존 레이어를 바꾸지 않으며 여러 번 실행하면 번호가 올라간 새 결과가 쌓인다. " +
      "큰 이미지는 수 분 걸릴 수 있다.",
    permission: "external",
    inputSchema: RemoveStarsInput,
    handler: async (_input, toolContext) => {
      const { requestId } = toolContext;
      const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);
      const before = await listLayers(requestId);

      const starlessName = nextName(before, STARLESS);
      const starsName = nextName(before, STARS);
      const stem = runStem(document.name, "starnet");

      // 1) 16비트 TIFF 로 내보낸다. 8비트로 떨어지면 계조가 무너진다.
      const exported = await exec<SaveResult>(
        DOCUMENT_EXPORT,
        { filename: stem, format: "tiff", bitDepth: 16 },
        requestId,
      );
      if (exported.bitDepth !== 16) {
        logger.warn(`16비트로 내보내지 못했습니다: ${String(exported.bitDepth)}`);
      }

      // 2) StarNet2 는 출력이 둘이다 — 별 제거본과 별 이미지.
      const processed = await capabilities.execute("starRemoval", {
        input: exported.filename,
        output: `${stem}_starless.tif`,
        outputs: { stars: `${stem}_stars.tif` },
      });

      // 3) 둘 다 레이어로 가져온다. place 는 활성 레이어 바로 위에 놓이므로
      //    맨 위 레이어를 먼저 고른다. 그래야 결과가 예측 가능한 자리에 쌓인다.
      const top = before[0];
      if (top !== undefined) {
        await exec(LAYER_SELECT, { layerId: top.id }, requestId);
      }

      const starless = await exec<LayerInfo>(
        LAYER_PLACE,
        { filename: `${stem}_starless.tif`, name: starlessName },
        requestId,
      );
      const stars = await exec<LayerInfo>(
        LAYER_PLACE,
        { filename: `${stem}_stars.tif`, name: starsName },
        requestId,
      );

      // 4) 별 레이어는 스크린으로 겹쳐야 원래 밝기가 복원된다.
      const blended = await exec<LayerInfo>(
        LAYER_BLEND_MODE,
        { layerId: stars.id, blendMode: "screen" },
        requestId,
      );

      logger.info(`별 분리 완료: ${starlessName} · ${starsName} (${processed.provider})`);

      return {
        starless: { id: starless.id, name: starless.name },
        stars: { id: blended.id, name: blended.name, blendMode: blended.blendMode },
        provider: processed.provider,
        seconds: Math.round(processed.durationMs / 1000),
        // 임시 파일은 지우지 않는다. 사용자 폴더의 파일을 말없이 지우지 않는다는
        // 원칙이며, 다시 가져오거나 다른 도구에 넘길 수도 있다.
        files: Object.values(processed.outputPaths),
      };
    },
  });

  // ---------------------------------------------------------------------------

  tools.register({
    name: "milky.restore_stars",
    description:
      "분리해 둔 별 레이어를 다시 보이게 하고 스크린 혼합으로 겹친다. " +
      "layerId 를 생략하면 가장 최근 별 레이어를 쓴다. " +
      "먼저 milky.remove_stars 를 실행해 별 레이어가 있어야 한다.",
    permission: "edit",
    inputSchema: RestoreStarsInput,
    handler: async (input, toolContext) => {
      const { requestId } = toolContext;
      const layers = await listLayers(requestId);

      const target =
        input.layerId === undefined
          ? latestOfKind(layers, STARS)
          : (layers.find((layer) => layer.id === input.layerId) ?? null);

      if (target === null) {
        throw new Error(
          input.layerId === undefined
            ? "별 레이어가 없습니다. 먼저 milky.remove_stars 를 실행하세요."
            : `레이어 ${input.layerId} 를 찾을 수 없습니다.`,
        );
      }

      const blended = await exec<LayerInfo>(
        LAYER_BLEND_MODE,
        { layerId: target.id, blendMode: "screen" },
        requestId,
      );

      // 별이 과하면 불투명도로 줄인다. 스크린 위에서 자연스러운 조절 수단이다.
      const final =
        input.opacity === undefined
          ? blended
          : await exec<LayerInfo>(
              LAYER_OPACITY,
              { layerId: target.id, opacity: input.opacity },
              requestId,
            );

      return {
        id: final.id,
        name: final.name,
        blendMode: final.blendMode,
        opacity: final.opacity,
      };
    },
  });

  // ---------------------------------------------------------------------------

  tools.register({
    name: "milky.enhance",
    description:
      "BlurXTerminator 로 선명화한다. 현재 문서를 16비트 TIFF 로 내보내 처리한 뒤 " +
      "새 레이어로 가져온다. 별을 먼저 분리해 두면 별이 뭉치는 것을 줄일 수 있지만 " +
      "필수는 아니다. 기존 레이어를 바꾸지 않는다.",
    permission: "external",
    inputSchema: EnhanceInput,
    handler: async (input, toolContext) => {
      const { requestId } = toolContext;
      const document = await exec<DocumentInfo>(DOCUMENT_GET, {}, requestId);
      const before = await listLayers(requestId);

      const name = nextName(before, SHARPENED);
      const stem = runStem(document.name, "bxt");

      const exported = await exec<SaveResult>(
        DOCUMENT_EXPORT,
        { filename: stem, format: "tiff", bitDepth: 16 },
        requestId,
      );

      const processed = await capabilities.execute("deconvolution", {
        input: exported.filename,
        output: `${stem}_sharp.tif`,
        ...(input.nonstellar === undefined ? {} : { params: { nonstellar: input.nonstellar } }),
      });

      const top = before[0];
      if (top !== undefined) {
        await exec(LAYER_SELECT, { layerId: top.id }, requestId);
      }

      const placed = await exec<LayerInfo>(
        LAYER_PLACE,
        { filename: `${stem}_sharp.tif`, name },
        requestId,
      );

      logger.info(`선명화 완료: ${name} (${processed.provider})`);

      return {
        layer: { id: placed.id, name: placed.name },
        provider: processed.provider,
        seconds: Math.round(processed.durationMs / 1000),
        files: Object.values(processed.outputPaths),
      };
    },
  });
}

/**
 * 지금 막혀 있는 것과 이유.
 *
 * 무엇이 왜 안 되는지 말해주지 않으면 사용자가 고칠 수 없다.
 */
function blockedReasons(workspace: WorkspaceStatus, available: string[]): string[] {
  const reasons: string[] = [];

  if (!workspace.approved) {
    reasons.push(
      "작업 폴더가 승인되지 않아 외부 처리기를 쓸 수 없습니다. " +
        "Photoshop 의 'Photoshop MCP' 패널에서 폴더를 승인하세요.",
    );
  }
  if (!available.includes("starRemoval")) {
    reasons.push(
      "별 분리 처리기(StarNet2)가 설정되지 않았습니다. capabilities.json 을 확인하세요.",
    );
  }
  if (!available.includes("deconvolution")) {
    reasons.push("선명화 처리기(BlurXTerminator)가 설정되지 않았습니다.");
  }
  // 이 Phase 에 없는 것도 알려준다. 조용히 빠져 있으면 사용자가 찾는다.
  reasons.push(
    "그래디언트 제거는 아직 없습니다. GraXpert CLI 가 Photoshop 이 못 읽는 FITS 만 출력합니다.",
  );

  return reasons;
}
