import { app, imaging } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import {
  compareProfiles,
  composePanels,
  gridFor,
  heatDiff,
  panelSize,
  profileOf,
  type Rgb8,
} from "./image-compare.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";
import { readPreviewRgb8 } from "./pixel-source.js";

/**
 * **다른 문서와** 견준다. (ROADMAP §101)
 *
 * 두 문서를 **같은 크기의 미리보기**로 읽어 나란히 붙이고 그 미리보기에서 수치를 낸다. 크기와
 * 비율이 다른 문서끼리라 `document.compare` 처럼 전체 해상도로 1:1 견줄 수 없다. 그 대가로 클리핑은
 * 믿을 수 없다 — 서버의 도구 설명이 그렇게 말한다.
 *
 * 활성 문서를 옮기지 않는다. Imaging API 가 문서 id 를 받는다(`PixelSourceParams.documentId`).
 */

const DEFAULT_LONG_EDGE = 1280;
const GAP = 8;
const DIFF_GAIN = 4;

interface Params {
  documentId: number;
  layerId?: number;
  activeLayerId?: number;
  grid?: number;
  longEdge?: number;
  diff?: boolean;
  quality?: number;
}

async function encodeJpeg(rgb: Rgb8, quality: number): Promise<string> {
  const api = imaging;
  if (api === undefined || typeof api.createImageDataFromBuffer !== "function") {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 의 Imaging API 에 createImageDataFromBuffer 가 없어 비교 그림을 만들 수 없습니다.",
      { recoverable: false },
    );
  }
  const imageData = await api.createImageDataFromBuffer(rgb.data, {
    width: rgb.width,
    height: rgb.height,
    components: 3,
    componentSize: 8,
    chunky: true,
    colorSpace: "RGB",
  });
  try {
    const base64 = await api.encodeImageData({ imageData, base64: true, format: "jpeg", quality });
    return String(base64);
  } finally {
    imageData.dispose?.();
  }
}

export async function documentCompareWith(params: Params): Promise<unknown> {
  return runModal("Document compare with", async () => {
    const started = Date.now();
    const active = app.activeDocument;
    if (active === null || active === undefined) {
      throw new DispatchError("DOCUMENT_NOT_FOUND", "열려 있는 문서가 없습니다.", {
        recoverable: true,
      });
    }
    if (params.documentId === active.id) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        "활성 문서와 같은 문서입니다. 같은 문서의 전후는 photoshop.document.compare 로 견줍니다.",
        { recoverable: true, details: { documentId: params.documentId } },
      );
    }
    const other = toArray<{ id: number; name: string; width: number; height: number }>(
      app.documents,
    ).find((entry) => entry.id === params.documentId);
    if (other === undefined) {
      throw new DispatchError(
        "DOCUMENT_NOT_FOUND",
        `문서 ${params.documentId} 가 열려 있지 않습니다.`,
        {
          recoverable: true,
        },
      );
    }

    const activeSize = { width: Math.round(active.width), height: Math.round(active.height) };
    const otherSize = { width: Math.round(other.width), height: Math.round(other.height) };
    const activeAspect = activeSize.width / activeSize.height;
    const otherAspect = otherSize.width / otherSize.height;
    const differs = Math.abs(activeAspect / otherAspect - 1) > 0.01;

    // 두 문서를 같은 크기로 읽는다. 크기는 활성 문서의 비율을 따른다.
    const panelCount = params.diff === true ? 3 : 2;
    const size = panelSize(
      activeSize.width,
      activeSize.height,
      panelCount,
      params.longEdge ?? DEFAULT_LONG_EDGE,
      GAP,
    );
    const referenceRead = await readPreviewRgb8(
      { documentId: other.id, layerId: params.layerId },
      size,
    );
    const activeRead = await readPreviewRgb8(
      { documentId: active.id, layerId: params.activeLayerId },
      size,
    );
    if (
      referenceRead.rgb.width !== activeRead.rgb.width ||
      referenceRead.rgb.height !== activeRead.rgb.height
    ) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "두 문서의 미리보기 크기가 달라 나란히 붙일 수 없습니다.",
        { recoverable: true },
      );
    }

    // 수치. 미리보기에서 낸다.
    const area = { width: referenceRead.rgb.width, height: referenceRead.rgb.height };
    const grid = gridFor(area.width, area.height, params.grid ?? 8);
    const toInput = (rgb: Rgb8) => ({
      data: rgb.data,
      width: rgb.width,
      height: rgb.height,
      components: 3,
      maxValue: 255,
    });
    const metrics = compareProfiles(
      profileOf(toInput(referenceRead.rgb), grid),
      profileOf(toInput(activeRead.rgb), grid),
      area,
      grid,
    );

    const panels = [referenceRead.rgb, activeRead.rgb];
    const names = ["reference", "active"];
    if (params.diff === true) {
      panels.push(heatDiff(referenceRead.rgb, activeRead.rgb, DIFF_GAIN));
      names.push("difference");
    }
    const picture = composePanels(panels, GAP);
    const base64 = await encodeJpeg(picture, params.quality ?? 80);

    return {
      kind: "image",
      mimeType: "image/jpeg",
      base64,
      width: picture.width,
      height: picture.height,
      source: `compare_with:reference=${other.id}/${referenceRead.source} active=${active.id}/${activeRead.source}`,
      panels: names,
      area,
      grid,
      ...metrics,
      measuredFrom: "preview",
      reference: {
        documentId: other.id,
        name: String(other.name),
        ...otherSize,
        source: referenceRead.source,
      },
      active: {
        documentId: active.id,
        name: String(active.name),
        ...activeSize,
        source: activeRead.source,
      },
      aspect: {
        reference: Number(otherAspect.toFixed(4)),
        active: Number(activeAspect.toFixed(4)),
        differs,
      },
      elapsedMs: Date.now() - started,
    };
  });
}
