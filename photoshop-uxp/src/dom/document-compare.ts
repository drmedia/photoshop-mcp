import { imaging } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import {
  compareProfiles,
  composePanels,
  gridFor,
  heatDiff,
  panelSize,
  profileOf,
  type Rgb8,
  type SourceProfile,
} from "./image-compare.js";
import { runModal } from "./modal.js";
import { readPixels, readPreviewRgb8, type PixelSourceParams } from "./pixel-source.js";

/**
 * 보정 전후 비교. (ROADMAP §91)
 *
 * 보정 뒤 미리보기를 LLM 에게 돌려주되 **무엇이 얼마나 어디서 변했는지**를 함께 준다. 눈만으로는
 * 틀린 것을 통과시킨 적이 있다(MEASUREMENT.md §2). 그림은 보라고, 수치는 재라고 둘을 한 응답에 담는다.
 *
 * ## 수치는 전체 해상도에서, 한 번에 하나씩
 *
 * 전·후를 한꺼번에 들고 있으면 2400만 픽셀 16비트가 두 배(약 290MB)다. 그래서 하나를 읽어 요약
 * (`SourceProfile`)만 남기고 놓은 뒤 다음을 읽는다. 그림은 따로 **축소해서** 읽는다.
 *
 * ## 보정 전은 레이어로 준다
 *
 * 이 프로젝트의 보정은 비파괴다(복제 → 스마트 오브젝트 → Camera Raw). 원본은 아래에 그대로 있다.
 * 그 레이어가 "보정 전"이고, 생략한 "보정 후"는 보이는 그대로의 합성이다.
 */

const DEFAULT_LONG_EDGE = 1280;
const GAP = 8;
const DIFF_GAIN = 4;

interface CompareParams extends Pick<PixelSourceParams, "region"> {
  beforeLayerId: number;
  afterLayerId?: number;
  grid?: number;
  longEdge?: number;
  diff?: boolean;
  quality?: number;
}

interface Measured {
  profile: SourceProfile;
  source: string;
  width: number;
  height: number;
}

/** 하나를 전체 해상도로 읽어 요약하고 바로 놓는다. */
async function measure(params: PixelSourceParams, gridTiles: number): Promise<Measured> {
  const pixelData = await readPixels(params);
  try {
    if (pixelData.width <= 0 || pixelData.height <= 0) {
      throw new DispatchError("COMMAND_FAILED", "가로 폭을 알 수 없어 비교할 수 없습니다.", {
        recoverable: true,
        details: { source: pixelData.source },
      });
    }
    const grid = gridFor(pixelData.width, pixelData.height, gridTiles);
    const profile = profileOf(
      {
        data: pixelData.data,
        width: pixelData.width,
        height: pixelData.height,
        components: pixelData.components,
        maxValue: pixelData.maxValue,
      },
      grid,
    );
    return {
      profile,
      source: pixelData.source,
      width: pixelData.width,
      height: pixelData.height,
    };
  } finally {
    pixelData.dispose();
  }
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
    const base64 = await api.encodeImageData({
      imageData,
      base64: true,
      format: "jpeg",
      quality,
    });
    return String(base64);
  } finally {
    imageData.dispose?.();
  }
}

export async function documentCompare(params: CompareParams): Promise<unknown> {
  return runModal("Document compare", async () => {
    const started = Date.now();
    const tiles = params.grid ?? 8;
    const beforeParams: PixelSourceParams = {
      layerId: params.beforeLayerId,
      region: params.region,
    };
    const afterParams: PixelSourceParams = { layerId: params.afterLayerId, region: params.region };

    // 수치. 한 번에 하나씩 읽는다.
    const before = await measure(beforeParams, tiles);
    const after = await measure(afterParams, tiles);
    if (before.width !== after.width || before.height !== after.height) {
      throw new DispatchError(
        "INVALID_PARAMETER",
        `보정 전(${before.source}, ${String(before.width)}×${String(before.height)})과 ` +
          `후(${after.source}, ${String(after.width)}×${String(after.height)})의 크기가 다릅니다. ` +
          "보정 전 레이어는 캔버스 전체를 덮어야 합니다.",
        { recoverable: true, details: { before: before.source, after: after.source } },
      );
    }
    const area = { width: before.width, height: before.height };
    const grid = gridFor(area.width, area.height, tiles);
    const metrics = compareProfiles(before.profile, after.profile, area, grid);

    // 그림. 같은 크기로 축소해 읽는다.
    const wantsDiff = params.diff === true;
    const panelCount = wantsDiff ? 3 : 2;
    const size = panelSize(
      area.width,
      area.height,
      panelCount,
      params.longEdge ?? DEFAULT_LONG_EDGE,
      GAP,
    );
    const beforePreview = await readPreviewRgb8(beforeParams, size);
    const afterPreview = await readPreviewRgb8(afterParams, size);
    if (
      beforePreview.rgb.width !== afterPreview.rgb.width ||
      beforePreview.rgb.height !== afterPreview.rgb.height
    ) {
      throw new DispatchError(
        "COMMAND_FAILED",
        "전후 미리보기의 크기가 달라 나란히 붙일 수 없습니다.",
        {
          recoverable: true,
        },
      );
    }
    const panels = [beforePreview.rgb, afterPreview.rgb];
    const names = ["before", "after"];
    if (wantsDiff) {
      panels.push(heatDiff(beforePreview.rgb, afterPreview.rgb, DIFF_GAIN));
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
      source: `compare:before=${before.source} after=${after.source}`,
      // 왼쪽부터의 순서. 그림에는 글자가 없으므로 이 순서가 유일한 표식이다.
      panels: names,
      area,
      grid,
      ...metrics,
      elapsedMs: Date.now() - started,
    };
  });
}
