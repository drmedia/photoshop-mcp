import { imaging } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { findLayerById } from "./layer-edit.js";
import { toLayerType } from "./mappings.js";
import { runModal } from "./modal.js";
import { findEdge, theilSen, thin, type EdgeSample } from "./tilt.js";

/**
 * 경계선 기울기 측정. (ROADMAP §17.21)
 *
 * ## 왜 필요했나
 *
 * `document.rotate`(§17.19)를 만들어 놓고 **그 입력을 만들 방법이 저장소 안에
 * 없었다.** 수평선 기울기를 잴 때마다 캡처를 밖으로 내보내 PowerShell 로
 * Theil-Sen 을 돌렸다. 세 번 반복했고, 그때마다 코드를 새로 썼다.
 *
 * ## 전체 해상도에서 잰다
 *
 * `document.statistics` 와 같은 이유다. 축소본에서 재면 서브픽셀 정밀도가
 * 사라지고, 작은 각도일수록 그 손실이 결과를 지배한다.
 *
 * 다만 **줄 단위로 평균을 내지 않는다.** 경계를 찾는 일이라 각 줄의 프로파일이
 * 따로 필요하다. 그래서 메모리는 통계와 같게 쓰고 계산만 다르게 한다.
 */

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export async function documentTilt(params: {
  bounds: Bounds;
  direction?: "horizontal" | "vertical";
  minContrast?: number;
  layerId?: number;
}): Promise<unknown> {
  return runModal("Measure tilt", async () => {
    const api = imaging;
    if (api === undefined || typeof api.getPixels !== "function") {
      throw new DispatchError(
        "COMMAND_NOT_SUPPORTED",
        "이 Photoshop 버전에는 Imaging API 가 없어 기울기를 잴 수 없습니다.",
        { recoverable: false },
      );
    }

    const document = requireActiveDocument();
    const { bounds } = params;
    if (bounds.right > document.width || bounds.bottom > document.height) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `잴 영역이 문서(${document.width}×${document.height})를 벗어납니다.`,
        { recoverable: true, details: { bounds } },
      );
    }

    const direction = params.direction ?? "horizontal";
    const minContrast = params.minContrast ?? 20;
    const started = Date.now();

    const request: Record<string, unknown> = {
      documentID: document.id,
      sourceBounds: bounds,
    };

    // **보정이 쌓인 뒤에는 합성에서 경계가 흐려진다.**
    //
    // 실기에서 겪었다 — 톤을 올리고 광해를 뺀 문서에서 수평선을 재려 했더니
    // 1000열 중 83열만 경계를 찾았다. 원본 레이어를 지정하면 그 문제가 없다.
    // (`document.statistics` 와 같은 규칙: 조정 레이어와 그룹은 막는다)
    if (params.layerId !== undefined) {
      const layer = findLayerById(document.layers, params.layerId);
      if (layer === undefined || layer === null) {
        throw new DispatchError(
          "LAYER_NOT_FOUND",
          `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
          {
            recoverable: true,
            details: { layerId: params.layerId },
          },
        );
      }
      const kind = toLayerType(layer.kind).type;
      if (kind === "adjustment" || kind === "group") {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `${kind === "group" ? "그룹" : "조정 레이어"}에는 잴 픽셀이 없습니다.`,
          { recoverable: true, details: { layerId: layer.id, type: kind } },
        );
      }
      request["layerID"] = layer.id;
    }

    let pixelData;
    try {
      pixelData = await api.getPixels(request);
    } catch (error) {
      throw new DispatchError(
        "COMMAND_FAILED",
        `픽셀을 읽지 못했습니다: ${String((error as { message?: unknown })?.message ?? error)}`,
        { recoverable: true, details: { bounds } },
      );
    }

    try {
      const raw = pixelData.imageData as {
        componentSize?: number;
        components?: number;
        width?: number;
        height?: number;
        getData?: (options?: unknown) => Promise<ArrayBufferView>;
      };
      if (typeof raw.getData !== "function") {
        throw new DispatchError("COMMAND_NOT_SUPPORTED", "픽셀 버퍼를 읽을 수 없습니다.", {
          recoverable: false,
        });
      }

      const componentSize = raw.componentSize ?? 8;
      const components = raw.components ?? 3;
      // 16비트 문서의 최대값은 32768 이다. (§17.10 에서 덴 자리)
      const maxValue = componentSize > 8 ? 32768 : 255;
      const scale = 255 / maxValue;

      const buffer = (await raw.getData({ chunky: true })) as unknown as {
        length: number;
        [index: number]: number;
      };
      const width = raw.width ?? 0;
      const height = width > 0 ? Math.floor(buffer.length / components / width) : 0;
      if (width < 2 || height < 2) {
        throw new DispatchError("INVALID_PARAMETER", "잴 영역이 너무 작습니다.", {
          recoverable: true,
          details: { width, height },
        });
      }

      const luminanceAt = (x: number, y: number): number => {
        const at = (y * width + x) * components;
        const r = buffer[at] as number;
        const g = buffer[at + 1] as number;
        const b = buffer[at + 2] as number;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) * scale;
      };

      // 수평선을 찾을 때는 열마다 세로 프로파일을, 수직선은 행마다 가로 프로파일을 본다.
      const lines = direction === "horizontal" ? width : height;
      const depth = direction === "horizontal" ? height : width;
      const edgeMargin = Math.max(3, Math.min(20, Math.floor(depth / 8)));

      const samples: EdgeSample[] = [];
      const profile = new Array<number>(depth);
      for (let line = 0; line < lines; line += 1) {
        for (let i = 0; i < depth; i += 1) {
          profile[i] = direction === "horizontal" ? luminanceAt(line, i) : luminanceAt(i, line);
        }
        const edge = findEdge(profile, minContrast, edgeMargin);
        if (edge !== null) {
          samples.push({ index: line, position: edge });
        }
      }

      // 표본이 너무 적으면 기울기를 말하지 않는다. 두세 점으로 낸 각도를 돌려주면
      // 호출자는 그것이 측정이라고 믿는다.
      if (samples.length < 20) {
        throw new DispatchError(
          "COMMAND_FAILED",
          `경계를 찾은 줄이 ${samples.length}개뿐입니다(전체 ${lines}). ` +
            "대비가 충분한 경계가 영역 안에 없거나 minContrast 가 높습니다.",
          {
            recoverable: true,
            details: { found: samples.length, lines, minContrast, direction },
          },
        );
      }

      const used = thin(samples, 500);
      const span = (used[used.length - 1] as EdgeSample).index - (used[0] as EdgeSample).index;
      const result = theilSen(used, Math.max(1, Math.floor(span * 0.05)));
      if (result === null) {
        throw new DispatchError("COMMAND_FAILED", "기울기를 계산할 표본이 부족합니다.", {
          recoverable: true,
          details: { samples: used.length },
        });
      }

      return {
        ...result,
        direction,
        source: params.layerId === undefined ? "composite" : `layer:${String(params.layerId)}`,
        linesTotal: lines,
        linesWithEdge: samples.length,
        elapsedMs: Date.now() - started,
      };
    } finally {
      const disposable = pixelData.imageData as { dispose?: () => void };
      if (typeof disposable.dispose === "function") {
        disposable.dispose();
      }
    }
  });
}
