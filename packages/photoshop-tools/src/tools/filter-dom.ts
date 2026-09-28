import type { CommandEngine } from "@photoshop-mcp/command-engine";
import type { LayerInfo, ToolDefinition } from "@photoshop-mcp/photoshop-bridge";
import {
  FILTER_DUST_AND_SCRATCHES,
  FILTER_MOTION_BLUR,
  FILTER_SHARPEN,
  FILTER_UNSHARP_MASK,
  FilterDustAndScratchesParamsSchema,
  FilterMotionBlurParamsSchema,
  FilterSharpenParamsSchema,
  FilterUnsharpMaskParamsSchema,
  type FilterDustAndScratchesParams,
  type FilterMotionBlurParams,
  type FilterSharpenParams,
  type FilterUnsharpMaskParams,
} from "../commands/filter-dom.js";

/**
 * DOM `layer.apply*` 필터. (ROADMAP §53)
 *
 * 전부 `edit` 이다 — 기존 필터와 같다. 기본은 픽셀 직접 적용이고
 * `asSmartFilter: true` 로 재편집 가능하게 만든다.
 */

const COMMON =
  "layerId 를 생략하면 활성 레이어. **조정 레이어와 그룹에는 걸 수 없다.** " +
  "asSmartFilter: true 로 주면 스마트 오브젝트로 바꿔 스마트 필터로 붙이고 " +
  "나중에 값을 고칠 수 있다 — **그때 레이어 id 가 바뀌므로 결과의 id 를 이어 쓴다**. " +
  "기본은 픽셀 직접 적용이다. ";

function create<TParams>(
  name: string,
  description: string,
  schema: ToolDefinition<TParams, LayerInfo>["inputSchema"],
  type: string,
  engine: CommandEngine,
): ToolDefinition<TParams, LayerInfo> {
  return {
    name,
    description,
    permission: "edit",
    inputSchema: schema,
    handler: async (input, context) =>
      engine.execute<LayerInfo>({ type, params: input }, { requestId: context.requestId }),
  };
}

/** `photoshop.filter.sharpen` */
export function createFilterSharpenTool(
  engine: CommandEngine,
): ToolDefinition<FilterSharpenParams, LayerInfo> {
  return create(
    "photoshop.filter.sharpen",
    "선명하게. **강도를 조절할 수 없다** — Photoshop 의 이 세 필터가 원래 " +
      "파라미터를 받지 않는다. mode 는 sharpen(기본) · edges · more 다. " +
      "edges 는 가장자리만 건드려 평탄한 영역의 노이즈를 덜 키운다. " +
      "**조절이 필요하면 photoshop.filter.unsharp_mask 를 쓴다** — 그쪽이 강도 · " +
      "반경 · 한계값을 받는다. " +
      COMMON,
    FilterSharpenParamsSchema,
    FILTER_SHARPEN,
    engine,
  );
}

/** `photoshop.filter.unsharp_mask` */
export function createFilterUnsharpMaskTool(
  engine: CommandEngine,
): ToolDefinition<FilterUnsharpMaskParams, LayerInfo> {
  return create(
    "photoshop.filter.unsharp_mask",
    "언샵 마스크 — **조절 가능한 선명화**. amount 는 강도(%, 1~500), radius 는 " +
      "반경(px, 0.1~1000), threshold 는 한계값(0~255)이다. " +
      "**threshold 를 0 으로 두면 배경 노이즈까지 선명해진다** — 천체사진에서는 " +
      "올려서 튀는 곳만 잡는다. radius 가 크면 가장자리에 흰 테가 생긴다. " +
      "**Smart Sharpen 은 UXP DOM 에 없다**(레퍼런스의 apply* 서른여덟 개에 " +
      "applySmartSharpen 이 없다). 조절 가능한 선명화는 이것이 그 자리다. " +
      "**국소 대비를 올리려는 것이면 photoshop.filter.high_pass** 를 Soft Light 로 " +
      "겹치거나 camera_raw.apply 의 texture · clarity 쪽이 낫다. " +
      COMMON,
    FilterUnsharpMaskParamsSchema,
    FILTER_UNSHARP_MASK,
    engine,
  );
}

/** `photoshop.filter.motion_blur` */
export function createFilterMotionBlurTool(
  engine: CommandEngine,
): ToolDefinition<FilterMotionBlurParams, LayerInfo> {
  return create(
    "photoshop.filter.motion_blur",
    "모션 블러. angle 은 **도**(−360~360), distance 는 **픽셀**(1~2000)이다. " +
      "한 방향으로만 흐려 움직임을 만든다 — 사방으로 흐리려면 " +
      "photoshop.filter.gaussian_blur 다. " +
      COMMON,
    FilterMotionBlurParamsSchema,
    FILTER_MOTION_BLUR,
    engine,
  );
}

/** `photoshop.filter.dust_scratches` */
export function createFilterDustAndScratchesTool(
  engine: CommandEngine,
): ToolDefinition<FilterDustAndScratchesParams, LayerInfo> {
  return create(
    "photoshop.filter.dust_scratches",
    "먼지와 스크래치. radius(px, 1~100) 안에서 threshold(0~255)보다 튀는 픽셀을 " +
      "주변으로 덮는다. **threshold 를 0 으로 두면 전체가 뭉개진다** — 올릴수록 " +
      "튀는 것만 골라낸다. radius 는 지울 점보다 조금 크게 잡는다. " +
      "**photoshop.retouch.remove_spots 와 다른 물건이다** — 그쪽은 좌표를 받아 한 점을 " +
      "내용 인식으로 지우고, 이쪽은 레이어 전체에 건다. 천체사진에서 전체에 걸면 " +
      "**별이 함께 사라진다** — 작은 점은 Photoshop 이 먼지와 구분하지 못한다. " +
      COMMON,
    FilterDustAndScratchesParamsSchema,
    FILTER_DUST_AND_SCRATCHES,
    engine,
  );
}
