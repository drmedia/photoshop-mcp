import type { CommandRegistry } from "@photoshop-mcp/command-engine";
import {
  ADJUSTMENT_BRIGHTNESS_CONTRAST,
  ADJUSTMENT_CURVES,
  ADJUSTMENT_LEVELS,
  BrightnessContrastParamsSchema,
  CurvesParamsSchema,
  LevelsParamsSchema,
  brightnessContrastCommand,
  curvesCommand,
  levelsCommand,
} from "./adjustment.js";
import { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
import {
  DOCUMENT_CREATE,
  DocumentCreateParamsSchema,
  documentCreateCommand,
} from "./document-create.js";
import { DOCUMENT_LIST, DocumentListParamsSchema, documentListCommand } from "./document-list.js";
import {
  DOCUMENT_DUPLICATE,
  DocumentDuplicateParamsSchema,
  documentDuplicateCommand,
} from "./document-duplicate.js";
import { LAYER_GET, LayerGetParamsSchema, layerGetCommand } from "./layer-get.js";
import { LAYER_SET_LOCK, LayerSetLockParamsSchema, layerSetLockCommand } from "./layer-lock.js";
import { LAYER_FLIP, LayerFlipParamsSchema, layerFlipCommand } from "./layer-flip.js";
import { LAYER_MERGE, LayerMergeParamsSchema, layerMergeCommand } from "./layer-merge.js";
import {
  LAYER_LINK,
  LAYER_UNLINK,
  LayerLinkParamsSchema,
  LayerUnlinkParamsSchema,
  layerLinkCommand,
  layerUnlinkCommand,
} from "./layer-link.js";
import {
  LAYER_ROTATE,
  LAYER_SCALE,
  LAYER_TRANSLATE,
  LayerRotateParamsSchema,
  LayerScaleParamsSchema,
  LayerTranslateParamsSchema,
  layerRotateCommand,
  layerScaleCommand,
  layerTranslateCommand,
} from "./layer-transform.js";
import {
  LAYER_RASTERIZE,
  LayerRasterizeParamsSchema,
  layerRasterizeCommand,
} from "./layer-rasterize.js";
import {
  LAYER_SELECT_MULTIPLE,
  LayerSelectMultipleParamsSchema,
  layerSelectMultipleCommand,
} from "./layer-select-multiple.js";
import { FILTER_GAUSSIAN_BLUR, GaussianBlurParamsSchema, gaussianBlurCommand } from "./filter.js";
import {
  ADJUSTMENT_HUE_SATURATION,
  ADJUSTMENT_VIBRANCE,
  HueSaturationParamsSchema,
  LAYER_BLEND_MODE,
  LayerBlendModeParamsSchema,
  SELECTION_SET,
  SelectionSetParamsSchema,
  VibranceParamsSchema,
  hueSaturationCommand,
  layerBlendModeCommand,
  selectionSetCommand,
  vibranceCommand,
} from "./gap-tools.js";
import {
  MASK_CREATE,
  MASK_DISABLE,
  MASK_APPLY,
  MASK_DELETE,
  MASK_LINK,
  MASK_UNLINK,
  MASK_INVERT,
  MASK_SELECT,
  MASK_ENABLE,
  MaskCreateParamsSchema,
  MaskSelectParamsSchema,
  MaskToggleParamsSchema,
  SELECTION_CLEAR,
  SELECTION_INVERT,
  SelectionParamsSchema,
  maskCreateCommand,
  maskDisableCommand,
  maskApplyCommand,
  maskDeleteCommand,
  maskLinkCommand,
  maskUnlinkCommand,
  maskInvertCommand,
  maskSelectCommand,
  maskEnableCommand,
  selectionClearCommand,
  selectionInvertCommand,
} from "./mask-selection.js";
import {
  HISTORY_REDO,
  HISTORY_UNDO,
  HistoryRedoParamsSchema,
  HistoryUndoParamsSchema,
  historyRedoCommand,
  historyUndoCommand,
} from "./history.js";
import {
  GROUP_CREATE,
  GROUP_MOVE_LAYER,
  GroupCreateParamsSchema,
  GroupMoveLayerParamsSchema,
  groupCreateCommand,
  groupMoveLayerCommand,
} from "./group.js";
import {
  LAYER_CREATE,
  LAYER_DUPLICATE,
  LAYER_FILL_OPACITY,
  LAYER_OPACITY,
  LAYER_RENAME,
  LAYER_SELECT,
  LAYER_VISIBILITY,
  LayerCreateParamsSchema,
  LayerDuplicateParamsSchema,
  LayerFillOpacityParamsSchema,
  LayerOpacityParamsSchema,
  LayerRenameParamsSchema,
  LayerSelectParamsSchema,
  LayerVisibilityParamsSchema,
  layerCreateCommand,
  layerDuplicateCommand,
  layerFillOpacityCommand,
  layerOpacityCommand,
  layerRenameCommand,
  layerSelectCommand,
  layerVisibilityCommand,
} from "./layer-edit.js";
import {
  DOCUMENT_EXPORT,
  DOCUMENT_SAVE,
  DOCUMENT_SAVE_AS,
  ExportParamsSchema,
  SELECTION_EXPORT_MASK,
  SaveAsParamsSchema,
  SelectionExportMaskParamsSchema,
  WORKSPACE_STATUS,
  exportCommand,
  saveAsCommand,
  saveCommand,
  selectionExportMaskCommand,
  workspaceStatusCommand,
} from "./document-save.js";
import { LAYER_GET_ACTIVE, layerGetActiveCommand } from "./layer-active.js";
import { DOCUMENT_CROP, DocumentCropParamsSchema, documentCropCommand } from "./document-crop.js";
import { IMAGE_RESIZE, ImageResizeParamsSchema, imageResizeCommand } from "./image-resize.js";
import { CANVAS_RESIZE, CanvasResizeParamsSchema, canvasResizeCommand } from "./canvas-resize.js";
import { DOCUMENT_TRIM, DocumentTrimParamsSchema, documentTrimCommand } from "./document-trim.js";
import {
  DOCUMENT_PASTE,
  DocumentPasteParamsSchema,
  documentPasteCommand,
} from "./document-paste.js";
import {
  DOCUMENT_MERGE_VISIBLE,
  DocumentMergeVisibleParamsSchema,
  documentMergeVisibleCommand,
} from "./document-merge.js";
import {
  DOCUMENT_BIT_DEPTH_CONVERT,
  DocumentBitDepthParamsSchema,
  documentBitDepthConvertCommand,
} from "./document-bit-depth.js";
import {
  DOCUMENT_MODE_CONVERT,
  DocumentModeConvertParamsSchema,
  documentModeConvertCommand,
} from "./document-mode.js";
import { DOCUMENT_OPEN, DocumentOpenParamsSchema, documentOpenCommand } from "./document-open.js";
import {
  DOCUMENT_CLOSE,
  DOCUMENT_FLATTEN,
  DocumentCloseParamsSchema,
  DocumentFlattenParamsSchema,
  documentCloseCommand,
  documentFlattenCommand,
} from "./document-lifecycle.js";
import { DODGE_BURN_DAB, DodgeBurnParamsSchema, dodgeBurnDabCommand } from "./dodge-burn.js";
import {
  EXTENSION_REGISTRY,
  ExtensionRegistryParamsSchema,
  extensionRegistryCommand,
} from "./extension-registry.js";
import {
  ACTION_ALLOWLIST,
  ACTION_LIST,
  ACTION_PLAY,
  ActionAllowlistParamsSchema,
  ActionListParamsSchema,
  ActionPlayParamsSchema,
  actionAllowlistCommand,
  actionListCommand,
  actionPlayCommand,
} from "./action.js";
import {
  FONT_LIST,
  FontListParamsSchema,
  TEXT_CREATE,
  TEXT_SET,
  TextCreateParamsSchema,
  TextSetParamsSchema,
  fontListCommand,
  textCreateCommand,
  textSetCommand,
} from "./text.js";
import {
  MASK_DAB,
  MaskDabParamsSchema,
  PAINT_DAB,
  PaintDabParamsSchema,
  maskDabCommand,
  paintDabCommand,
} from "./paint.js";
import {
  SMART_OBJECT_CONVERT,
  SMART_OBJECT_GET_INFO,
  SMART_OBJECT_NEW_VIA_COPY,
  SMART_OBJECT_RELINK,
  SMART_OBJECT_UPDATE,
  SmartObjectConvertParamsSchema,
  SmartObjectGetInfoParamsSchema,
  SmartObjectNewViaCopyParamsSchema,
  SmartObjectRelinkParamsSchema,
  SmartObjectUpdateParamsSchema,
  smartObjectConvertCommand,
  smartObjectGetInfoCommand,
  smartObjectNewViaCopyCommand,
  smartObjectRelinkCommand,
  smartObjectUpdateCommand,
} from "./smart-object.js";
import { LAYER_REORDER, LayerReorderParamsSchema, layerReorderCommand } from "./layer-reorder.js";
import { MEASURE_TILT, MeasureTiltParamsSchema, measureTiltCommand } from "./measure-tilt.js";
import {
  DOCUMENT_ROTATE,
  DocumentRotateParamsSchema,
  documentRotateCommand,
} from "./document-rotate.js";
import { CAMERA_RAW_APPLY, CameraRawParamsSchema, cameraRawApplyCommand } from "./camera-raw.js";
import { HOST_GET, HostGetParamsSchema, hostGetCommand } from "./host.js";
import { METADATA_GET, MetadataGetParamsSchema, metadataGetCommand } from "./metadata.js";
import { LAYER_DELETE, LayerDeleteParamsSchema, layerDeleteCommand } from "./layer-delete.js";
import {
  RETOUCH_REMOVE_SPOTS,
  RemoveSpotsParamsSchema,
  retouchRemoveSpotsCommand,
} from "./retouch.js";
import {
  DOCUMENT_STATISTICS,
  DocumentStatisticsParamsSchema,
  documentStatisticsCommand,
} from "./document-statistics.js";
import {
  DOCUMENT_ANALYZE,
  DocumentAnalyzeParamsSchema,
  documentAnalyzeCommand,
} from "./document-analyze.js";
import {
  DOCUMENT_COMPARE,
  DocumentCompareParamsSchema,
  documentCompareCommand,
} from "./document-compare.js";
import {
  ADJUSTMENT_GET,
  AdjustmentGetParamsSchema,
  adjustmentGetCommand,
} from "./adjustment-get.js";
import { MASK_SUMMARY, MaskSummaryParamsSchema, maskSummaryCommand } from "./mask-summary.js";
import {
  CAPTURE_DOCUMENT,
  CAPTURE_LAYER,
  CAPTURE_SELECTION,
  CaptureDocumentParams,
  CaptureLayerParams,
  CaptureSelectionParams,
  captureDocumentCommand,
  captureLayerCommand,
  captureSelectionCommand,
} from "./capture.js";
import {
  SELECTION_SKY,
  SELECTION_SUBJECT,
  selectionSkyCommand,
  selectionSubjectCommand,
} from "./selection-auto.js";
import {
  ADJUSTMENT_COLOR_BALANCE,
  ColorBalanceParams,
  FILTER_HIGH_PASS,
  FILTER_MINIMUM_MAXIMUM,
  HighPassParams,
  LAYER_FROM_BACKGROUND,
  LayerFromBackgroundParams,
  MinimumMaximumParams,
  ColorRangeParams,
  SelectionLuminosityParams,
  LAYER_STAMP_VISIBLE,
  MASK_GRADIENT,
  MaskGradientParams,
  LoadChannelParams,
  SELECTION_COLOR_RANGE,
  SELECTION_LUMINOSITY,
  SELECTION_LOAD_CHANNEL,
  SELECTION_MODIFY,
  SELECTION_SAVE_CHANNEL,
  SaveChannelParams,
  SelectionModifyParams,
  StampVisibleParams,
  adjustmentColorBalanceCommand,
  filterHighPassCommand,
  filterMinimumMaximumCommand,
  layerFromBackgroundCommand,
  layerStampVisibleCommand,
  maskGradientCommand,
  selectionColorRangeCommand,
  selectionLuminosityCommand,
  selectionLoadChannelCommand,
  selectionModifyCommand,
  selectionSaveChannelCommand,
} from "./workflow-gaps.js";
import {
  SELECTION_POLYGON,
  SELECTION_ROTATE_BOUNDARY,
  SELECTION_SCALE_BOUNDARY,
  SELECTION_TRANSLATE_BOUNDARY,
  SelectionPolygonParamsSchema,
  SelectionRotateBoundaryParamsSchema,
  SelectionScaleBoundaryParamsSchema,
  SelectionTranslateBoundaryParamsSchema,
  selectionPolygonCommand,
  selectionRotateBoundaryCommand,
  selectionScaleBoundaryCommand,
  selectionTranslateBoundaryCommand,
} from "./selection-dom.js";
import { LAYER_LIST, layerListCommand } from "./layer-list.js";
import { LAYER_PLACE, LayerPlaceParamsSchema, layerPlaceCommand } from "./layer-place.js";
import {
  HISTORY_LIST,
  SELECTION_GET,
  historyListCommand,
  selectionGetCommand,
} from "./state-read.js";
import {
  WORKSPACE_DELETE,
  WORKSPACE_USAGE,
  WorkspaceDeleteParamsSchema,
  WorkspaceUsageParamsSchema,
  workspaceDeleteCommand,
  workspaceUsageCommand,
} from "./workspace-files.js";
import { PING, pingCommand } from "./ping.js";

export { DOCUMENT_GET, documentGetCommand } from "./document-get.js";
export * from "./document-save.js";
export * from "./layer-place.js";
export * from "./state-read.js";
export * from "./workspace-files.js";
export * from "./extension-registry.js";
export * from "./adjustment.js";
export * from "./adjustment-extra.js";
export * from "./channel.js";
export * from "./layer-comp.js";
export * from "./path.js";
export * from "./guide.js";
export * from "./metadata.js";
export * from "./text-style.js";
export * from "./app-info.js";
export * from "./filter.js";
export * from "./filter-dom.js";
export * from "./gap-tools.js";
export * from "./group.js";
export * from "./mask-selection.js";
export * from "./history.js";
export * from "./layer-edit.js";
export * from "./layer-lock.js";
export * from "./layer-flip.js";
export * from "./layer-rasterize.js";
export * from "./layer-merge.js";
export * from "./layer-transform.js";
export * from "./layer-link.js";
export * from "./selection-dom.js";
export {
  LAYER_GET_ACTIVE,
  LayerGetActiveParams,
  layerGetActiveCommand,
  type ActiveLayerState,
} from "./layer-active.js";
export { LAYER_LIST, layerListCommand } from "./layer-list.js";
export * from "./capture.js";
export * from "./document-crop.js";
export * from "./document-duplicate.js";
export * from "./image-resize.js";
export * from "./canvas-resize.js";
export * from "./document-trim.js";
export * from "./document-mode.js";
export * from "./document-bit-depth.js";
export * from "./document-merge.js";
export * from "./document-paste.js";
export * from "./document-rotate.js";
export * from "./measure-tilt.js";
export * from "./layer-reorder.js";
export * from "./document-lifecycle.js";
export * from "./document-open.js";
export * from "./smart-object.js";
export * from "./dodge-burn.js";
export * from "./paint.js";
export * from "./text.js";
export * from "./action.js";
export * from "./document-statistics.js";
export * from "./document-analyze.js";
export * from "./document-compare.js";
export * from "./adjustment-get.js";
export * from "./adjustment-settings.js";
export * from "./mask-summary.js";
export * from "./retouch.js";
export * from "./camera-raw.js";
export * from "./layer-delete.js";
export * from "./workflow-gaps.js";
export {
  SELECTION_SKY,
  SelectionAutoParams,
  selectionSkyCommand,
  type SelectionResult,
} from "./selection-auto.js";
import {
  ADJUSTMENT_BLACK_WHITE,
  ADJUSTMENT_CHANNEL_MIXER,
  ADJUSTMENT_EXPOSURE,
  ADJUSTMENT_PHOTO_FILTER,
  AdjustmentBlackWhiteParamsSchema,
  AdjustmentChannelMixerParamsSchema,
  AdjustmentExposureParamsSchema,
  AdjustmentPhotoFilterParamsSchema,
  adjustmentBlackWhiteCommand,
  adjustmentChannelMixerCommand,
  adjustmentExposureCommand,
  adjustmentPhotoFilterCommand,
} from "./adjustment-extra.js";
import {
  FILTER_DUST_AND_SCRATCHES,
  FILTER_MOTION_BLUR,
  FILTER_SHARPEN,
  FILTER_UNSHARP_MASK,
  FilterDustAndScratchesParamsSchema,
  FilterMotionBlurParamsSchema,
  FilterSharpenParamsSchema,
  FilterUnsharpMaskParamsSchema,
  filterDustAndScratchesCommand,
  filterMotionBlurCommand,
  filterSharpenCommand,
  filterUnsharpMaskCommand,
} from "./filter-dom.js";
import {
  CHANNEL_CREATE,
  CHANNEL_DELETE,
  CHANNEL_DUPLICATE,
  CHANNEL_GET,
  CHANNEL_LIST,
  CHANNEL_SELECT,
  ChannelCreateParamsSchema,
  ChannelDeleteParamsSchema,
  ChannelDuplicateParamsSchema,
  ChannelGetParamsSchema,
  ChannelListParamsSchema,
  ChannelSelectParamsSchema,
  channelCreateCommand,
  channelDeleteCommand,
  channelDuplicateCommand,
  channelGetCommand,
  channelListCommand,
  channelSelectCommand,
} from "./channel.js";
import {
  LAYER_COMP_APPLY,
  LAYER_COMP_CREATE,
  LAYER_COMP_DELETE,
  LAYER_COMP_GET,
  LAYER_COMP_LIST,
  LAYER_COMP_RECAPTURE,
  LayerCompApplyParamsSchema,
  LayerCompCreateParamsSchema,
  LayerCompDeleteParamsSchema,
  LayerCompGetParamsSchema,
  LayerCompListParamsSchema,
  LayerCompRecaptureParamsSchema,
  layerCompApplyCommand,
  layerCompCreateCommand,
  layerCompDeleteCommand,
  layerCompGetCommand,
  layerCompListCommand,
  layerCompRecaptureCommand,
} from "./layer-comp.js";
import {
  PATH_CREATE,
  PATH_DELETE,
  PATH_FILL,
  PATH_GET,
  PATH_LIST,
  PATH_SELECT,
  PATH_STROKE,
  PATH_TO_SELECTION,
  PathCreateParamsSchema,
  PathDeleteParamsSchema,
  PathFillParamsSchema,
  PathGetParamsSchema,
  PathListParamsSchema,
  PathSelectParamsSchema,
  PathStrokeParamsSchema,
  PathToSelectionParamsSchema,
  pathCreateCommand,
  pathDeleteCommand,
  pathFillCommand,
  pathGetCommand,
  pathListCommand,
  pathSelectCommand,
  pathStrokeCommand,
  pathToSelectionCommand,
} from "./path.js";
import {
  GUIDE_CREATE,
  GUIDE_DELETE,
  GUIDE_LIST,
  GuideCreateParamsSchema,
  GuideDeleteParamsSchema,
  GuideListParamsSchema,
  guideCreateCommand,
  guideDeleteCommand,
  guideListCommand,
} from "./guide.js";
import {
  TEXT_CONVERT_TO_PARAGRAPH,
  TEXT_CONVERT_TO_POINT,
  TEXT_CONVERT_TO_SHAPE,
  TEXT_GET,
  TEXT_SET_LEADING,
  TEXT_SET_PARAGRAPH,
  TEXT_SET_TRACKING,
  TEXT_WARP,
  TextSetLeadingParamsSchema,
  TextSetParagraphParamsSchema,
  TextSetTrackingParamsSchema,
  TextTargetParamsSchema,
  TextWarpParamsSchema,
  textConvertToParagraphCommand,
  textConvertToPointCommand,
  textConvertToShapeCommand,
  textGetCommand,
  textSetLeadingCommand,
  textSetParagraphCommand,
  textSetTrackingCommand,
  textWarpCommand,
} from "./text-style.js";
import {
  COLOR_GET_FOREGROUND_BACKGROUND,
  COLOR_SET_BACKGROUND,
  COLOR_SET_FOREGROUND,
  ColorGetParamsSchema,
  ColorSetParamsSchema,
  PREFERENCES_GET,
  PreferencesGetParamsSchema,
  colorGetCommand,
  colorSetBackgroundCommand,
  colorSetForegroundCommand,
  preferencesGetCommand,
} from "./app-info.js";
export { PING, pingCommand, type PingResult } from "./ping.js";

/**
 * Photoshop Core Command 를 레지스트리에 등록한다. (ROADMAP §5.3, §7.1)
 *
 * 파라미터를 받는 Command 는 스키마를 함께 등록한다.
 * Extension 이 Tool 을 거치지 않고 Engine 을 직접 호출해도 검증되도록 하기 위함이다.
 *
 * `permission` 은 필수다. (ARCHITECTURE §22)
 * 대부분은 `read` 아니면 `edit` 다 — 레이어 편집이 전부 비파괴이기 때문이다.
 * 파일을 쓰는 것이 `external` 이고, 작업을 없애는 것이 `destructive` 다.
 */
export function registerPhotoshopCommands(registry: CommandRegistry): void {
  // Phase 1 — 조회
  registry.register(PING, pingCommand, { permission: "read" });
  /* 호스트가 무엇을 할 수 있는지. diagnostics 는 서버 설정이 무엇을 막고
   * 있는지이고 이쪽은 Photoshop 쪽 능력이다. */
  registry.register(HOST_GET, hostGetCommand, {
    permission: "read",
    schema: HostGetParamsSchema,
  });
  /* 촬영 정보. 픽셀이 "지금 어떤가" 라면 이쪽은 "왜 그런가" 다. (ROADMAP §76) */
  registry.register(METADATA_GET, metadataGetCommand, {
    permission: "read",
    schema: MetadataGetParamsSchema,
  });
  registry.register(DOCUMENT_GET, documentGetCommand, { permission: "read" });
  registry.register(DOCUMENT_LIST, documentListCommand, {
    permission: "read",
    schema: DocumentListParamsSchema,
  });
  registry.register(DOCUMENT_CREATE, documentCreateCommand, {
    permission: "edit",
    schema: DocumentCreateParamsSchema,
  });
  /* 파일을 만들지 않는다 — 메모리 안의 새 문서다. 그래서 `external` 이 아니다. */
  registry.register(DOCUMENT_DUPLICATE, documentDuplicateCommand, {
    permission: "edit",
    schema: DocumentDuplicateParamsSchema,
  });
  registry.register(LAYER_LIST, layerListCommand, { permission: "read" });
  registry.register(LAYER_GET, layerGetCommand, {
    permission: "read",
    schema: LayerGetParamsSchema,
  });
  registry.register(LAYER_SET_LOCK, layerSetLockCommand, {
    permission: "edit",
    schema: LayerSetLockParamsSchema,
  });
  // 같은 축으로 두 번 부르면 제자리다. 잃는 것이 없다.
  registry.register(LAYER_FLIP, layerFlipCommand, {
    permission: "edit",
    schema: LayerFlipParamsSchema,
  });
  /* **되돌릴 수 없다.** 스마트 오브젝트의 원본과 텍스트의 글자가 사라진다 —
   * CORE_API §9 가 `smart_object.rasterize` 로 처음부터 이렇게 분류했다. */
  registry.register(LAYER_RASTERIZE, layerRasterizeCommand, {
    permission: "destructive",
    schema: LayerRasterizeParamsSchema,
  });
  /* **합쳐진 레이어들이 사라진다.** CORE_API §9 가 처음부터 이렇게 분류했다. */
  registry.register(LAYER_MERGE, layerMergeCommand, {
    permission: "destructive",
    schema: LayerMergeParamsSchema,
  });
  // 옮기는 것은 픽셀을 다시 표본화하지 않는다. 잃는 것이 없다.
  registry.register(LAYER_TRANSLATE, layerTranslateCommand, {
    permission: "edit",
    schema: LayerTranslateParamsSchema,
  });
  /* **줄이면 되돌릴 수 없다.** `image.resize` 가 문서 전체에 대해 그런 것과
   * 같은 종류이고 이쪽은 레이어 하나다. (ROADMAP §47) */
  registry.register(LAYER_SCALE, layerScaleCommand, {
    permission: "destructive",
    schema: LayerScaleParamsSchema,
  });
  // `document.rotate` 가 edit 인 것과 같다. 덜어내는 것이 아니다.
  registry.register(LAYER_ROTATE, layerRotateCommand, {
    permission: "edit",
    schema: LayerRotateParamsSchema,
  });
  // 연결은 픽셀을 건드리지 않는다. 끊으면 그대로 돌아온다.
  registry.register(LAYER_LINK, layerLinkCommand, {
    permission: "edit",
    schema: LayerLinkParamsSchema,
  });
  registry.register(LAYER_UNLINK, layerUnlinkCommand, {
    permission: "edit",
    schema: LayerUnlinkParamsSchema,
  });
  registry.register(LAYER_SELECT_MULTIPLE, layerSelectMultipleCommand, {
    permission: "edit",
    schema: LayerSelectMultipleParamsSchema,
  });
  registry.register(LAYER_GET_ACTIVE, layerGetActiveCommand, { permission: "read" });
  registry.register(SELECTION_SKY, selectionSkyCommand, { permission: "edit" });
  registry.register(SELECTION_SUBJECT, selectionSubjectCommand, { permission: "edit" });
  registry.register(LAYER_DELETE, layerDeleteCommand, {
    // CORE_API §8 이 미리 정해 둔 분류다. 작업을 없애는 것이 목적이다.
    permission: "destructive",
    schema: LayerDeleteParamsSchema,
  });
  registry.register(CAMERA_RAW_APPLY, cameraRawApplyCommand, {
    permission: "edit",
    schema: CameraRawParamsSchema,
  });
  registry.register(RETOUCH_REMOVE_SPOTS, retouchRemoveSpotsCommand, {
    // 픽셀을 직접 바꾸지만 배경을 막아 두었으므로 사라지는 것은 이미 사본이다.
    permission: "edit",
    schema: RemoveSpotsParamsSchema,
  });
  registry.register(DOCUMENT_STATISTICS, documentStatisticsCommand, {
    permission: "read",
    schema: DocumentStatisticsParamsSchema,
  });
  registry.register(DOCUMENT_ANALYZE, documentAnalyzeCommand, {
    permission: "read",
    schema: DocumentAnalyzeParamsSchema,
  });
  registry.register(DOCUMENT_COMPARE, documentCompareCommand, {
    permission: "read",
    schema: DocumentCompareParamsSchema,
  });
  registry.register(ADJUSTMENT_GET, adjustmentGetCommand, {
    permission: "read",
    schema: AdjustmentGetParamsSchema,
  });
  registry.register(MASK_SUMMARY, maskSummaryCommand, {
    permission: "read",
    schema: MaskSummaryParamsSchema,
  });
  registry.register(DOCUMENT_CROP, documentCropCommand, {
    // 픽셀을 버리지 않는다. 캔버스만 줄이므로 되돌릴 수 있다.
    permission: "edit",
    schema: DocumentCropParamsSchema,
  });
  /* **`document.crop` 과 갈린다 — 실기에서 재서 갈랐다.** crop 은 배경을 일반
   * 레이어로 승격시켜 바깥 픽셀을 남기지만(왕복 확인) 이쪽은 배경을 그대로
   * 잘라 픽셀이 사라진다(빨간 영역 44.245% → 2.584%). (ROADMAP §36) */
  registry.register(CANVAS_RESIZE, canvasResizeCommand, {
    permission: "destructive",
    schema: CanvasResizeParamsSchema,
  });
  /* **`canvas.resize` 와 같은 등급이다.** 배경 레이어의 잘린 픽셀이 사라지는
   * 것이 같다 — 실기에서 확인한다. (ROADMAP §37) */
  registry.register(DOCUMENT_TRIM, documentTrimCommand, {
    permission: "destructive",
    schema: DocumentTrimParamsSchema,
  });
  /* **되돌릴 수 없다.** grayscale 은 색을, cmyk 는 색역 밖을 버린다 —
   * 문서 어디에도 원래 값이 남지 않는다. (ROADMAP §38) */
  registry.register(DOCUMENT_MODE_CONVERT, documentModeConvertCommand, {
    permission: "destructive",
    schema: DocumentModeConvertParamsSchema,
  });
  /* **내리면 되돌릴 수 없다.** 16 → 8 은 계조를 버린다. (ROADMAP §39) */
  registry.register(DOCUMENT_BIT_DEPTH_CONVERT, documentBitDepthConvertCommand, {
    permission: "destructive",
    schema: DocumentBitDepthParamsSchema,
  });
  /* **`stamp_visible` 과 갈린다.** 그쪽은 복제본을 만들고 이쪽은 원본을
   * 없앤다. `flatten` 과는 숨긴 레이어에서 갈린다. (ROADMAP §40) */
  registry.register(DOCUMENT_MERGE_VISIBLE, documentMergeVisibleCommand, {
    permission: "destructive",
    schema: DocumentMergeVisibleParamsSchema,
  });
  /* **`external` 이다.** 사용자의 클립보드를 문서로 끌어들인다 —
   * `layer.place` 와 같은 논리이고 폴더 승인조차 없다. (ROADMAP §41) */
  registry.register(DOCUMENT_PASTE, documentPasteCommand, {
    permission: "external",
    schema: DocumentPasteParamsSchema,
  });
  registry.register(IMAGE_RESIZE, imageResizeCommand, {
    /* **`crop` 과 갈리는 자리다.** 축소는 픽셀을 다시 표본화하고 버려진
     * 해상도가 문서 어디에도 남지 않는다 — `mask.apply` 와 같은 종류다. */
    permission: "destructive",
    schema: ImageResizeParamsSchema,
  });
  registry.register(DOCUMENT_OPEN, documentOpenCommand, {
    // 파일을 읽는다. 승인된 폴더 안으로 가두지만 경계를 넘는 것은 같다.
    permission: "external",
    schema: DocumentOpenParamsSchema,
  });
  registry.register(DOCUMENT_FLATTEN, documentFlattenCommand, {
    // 조정 레이어가 구워지고 숨긴 레이어가 사라진다. (CORE_API §5.1)
    permission: "destructive",
    schema: DocumentFlattenParamsSchema,
  });
  registry.register(DOCUMENT_CLOSE, documentCloseCommand, {
    // 저장하지 않은 변경이 사라진다. (CORE_API §5.1)
    permission: "destructive",
    schema: DocumentCloseParamsSchema,
  });
  registry.register(SMART_OBJECT_CONVERT, smartObjectConvertCommand, {
    // 픽셀을 버리지 않는다. 레이어가 한 겹 감싸질 뿐이고 rasterize 로 되돌린다.
    permission: "edit",
    schema: SmartObjectConvertParamsSchema,
  });
  /* **읽기다.** batchPlay `get` 은 문서를 바꾸지 않는다. (ROADMAP §54) */
  registry.register(SMART_OBJECT_GET_INFO, smartObjectGetInfoCommand, {
    permission: "read",
    schema: SmartObjectGetInfoParamsSchema,
  });
  registry.register(SMART_OBJECT_NEW_VIA_COPY, smartObjectNewViaCopyCommand, {
    permission: "edit",
    schema: SmartObjectNewViaCopyParamsSchema,
  });
  /* **`external` 이다.** 승인된 폴더의 파일을 읽어 들인다 — `layer.place` 와 같다. */
  registry.register(SMART_OBJECT_RELINK, smartObjectRelinkCommand, {
    permission: "external",
    schema: SmartObjectRelinkParamsSchema,
  });
  registry.register(SMART_OBJECT_UPDATE, smartObjectUpdateCommand, {
    permission: "edit",
    schema: SmartObjectUpdateParamsSchema,
  });

  // ROADMAP §56 — 채널. 전부 DOM 이라 descriptor 를 잡지 않았다.
  registry.register(CHANNEL_LIST, channelListCommand, {
    permission: "read",
    schema: ChannelListParamsSchema,
  });
  registry.register(CHANNEL_GET, channelGetCommand, {
    permission: "read",
    schema: ChannelGetParamsSchema,
  });
  registry.register(CHANNEL_CREATE, channelCreateCommand, {
    permission: "edit",
    schema: ChannelCreateParamsSchema,
  });
  registry.register(CHANNEL_SELECT, channelSelectCommand, {
    permission: "edit",
    schema: ChannelSelectParamsSchema,
  });
  registry.register(CHANNEL_DUPLICATE, channelDuplicateCommand, {
    permission: "edit",
    schema: ChannelDuplicateParamsSchema,
  });
  /* **저장해 둔 선택 영역을 버린다.** 색 성분 채널은 플러그인이 미리 막는다. */
  registry.register(CHANNEL_DELETE, channelDeleteCommand, {
    permission: "destructive",
    schema: ChannelDeleteParamsSchema,
  });

  // ROADMAP §57 — 레이어 컴프. 전부 DOM 이다.
  registry.register(LAYER_COMP_LIST, layerCompListCommand, {
    permission: "read",
    schema: LayerCompListParamsSchema,
  });
  registry.register(LAYER_COMP_GET, layerCompGetCommand, {
    permission: "read",
    schema: LayerCompGetParamsSchema,
  });
  registry.register(LAYER_COMP_CREATE, layerCompCreateCommand, {
    permission: "edit",
    schema: LayerCompCreateParamsSchema,
  });
  registry.register(LAYER_COMP_APPLY, layerCompApplyCommand, {
    permission: "edit",
    schema: LayerCompApplyParamsSchema,
  });
  /* **저장해 둔 배치를 덮어쓴다.** History 말고 되돌릴 길이 없다. */
  registry.register(LAYER_COMP_RECAPTURE, layerCompRecaptureCommand, {
    permission: "destructive",
    schema: LayerCompRecaptureParamsSchema,
  });
  registry.register(LAYER_COMP_DELETE, layerCompDeleteCommand, {
    permission: "destructive",
    schema: LayerCompDeleteParamsSchema,
  });

  // ROADMAP §58 — 패스. 전부 DOM 이다.
  registry.register(PATH_LIST, pathListCommand, {
    permission: "read",
    schema: PathListParamsSchema,
  });
  registry.register(PATH_GET, pathGetCommand, {
    permission: "read",
    schema: PathGetParamsSchema,
  });
  registry.register(PATH_CREATE, pathCreateCommand, {
    permission: "edit",
    schema: PathCreateParamsSchema,
  });
  registry.register(PATH_SELECT, pathSelectCommand, {
    permission: "edit",
    schema: PathSelectParamsSchema,
  });
  registry.register(PATH_TO_SELECTION, pathToSelectionCommand, {
    permission: "edit",
    schema: PathToSelectionParamsSchema,
  });
  registry.register(PATH_FILL, pathFillCommand, {
    permission: "edit",
    schema: PathFillParamsSchema,
  });
  registry.register(PATH_STROKE, pathStrokeCommand, {
    permission: "edit",
    schema: PathStrokeParamsSchema,
  });
  /* **저장해 둔 윤곽을 버린다.** 칠한 픽셀은 남고 윤곽만 사라진다. */
  registry.register(PATH_DELETE, pathDeleteCommand, {
    permission: "destructive",
    schema: PathDeleteParamsSchema,
  });

  // ROADMAP §59 — 가이드. 전부 DOM 이다.
  registry.register(GUIDE_LIST, guideListCommand, {
    permission: "read",
    schema: GuideListParamsSchema,
  });
  registry.register(GUIDE_CREATE, guideCreateCommand, {
    permission: "edit",
    schema: GuideCreateParamsSchema,
  });
  /* **`edit` 다.** §5.12 는 DESTRUCTIVE 를 예정값으로 적어 두었지만 지우는
   * 것이 좌표 하나뿐이다 — 쌓아 둔 작업이 없고 같은 값으로 다시 만들면 된다.
   * §5 의 Permission 은 "구현 시점의 예정값" 이고 §2 의 경계 규칙이 최종이다. */
  registry.register(GUIDE_DELETE, guideDeleteCommand, {
    permission: "edit",
    schema: GuideDeleteParamsSchema,
  });

  // ROADMAP §60 — 텍스트 세부. 전부 DOM 이다.
  registry.register(TEXT_GET, textGetCommand, {
    permission: "read",
    schema: TextTargetParamsSchema,
  });
  registry.register(TEXT_SET_TRACKING, textSetTrackingCommand, {
    permission: "edit",
    schema: TextSetTrackingParamsSchema,
  });
  registry.register(TEXT_SET_LEADING, textSetLeadingCommand, {
    permission: "edit",
    schema: TextSetLeadingParamsSchema,
  });
  registry.register(TEXT_SET_PARAGRAPH, textSetParagraphCommand, {
    permission: "edit",
    schema: TextSetParagraphParamsSchema,
  });
  registry.register(TEXT_WARP, textWarpCommand, {
    permission: "edit",
    schema: TextWarpParamsSchema,
  });
  registry.register(TEXT_CONVERT_TO_POINT, textConvertToPointCommand, {
    permission: "edit",
    schema: TextTargetParamsSchema,
  });
  registry.register(TEXT_CONVERT_TO_PARAGRAPH, textConvertToParagraphCommand, {
    permission: "edit",
    schema: TextTargetParamsSchema,
  });
  /* **글자가 벡터가 되어 더는 텍스트가 아니다.** 내용도 폰트도 고칠 수 없고
   * 되돌릴 길은 History 뿐이다 — `layer.rasterize` 와 같은 자리다. */
  registry.register(TEXT_CONVERT_TO_SHAPE, textConvertToShapeCommand, {
    permission: "destructive",
    schema: TextTargetParamsSchema,
  });

  // ROADMAP 61 — 앱 설정과 색. 둘 다 읽기만 한다.
  registry.register(PREFERENCES_GET, preferencesGetCommand, {
    permission: "read",
    schema: PreferencesGetParamsSchema,
  });
  registry.register(COLOR_GET_FOREGROUND_BACKGROUND, colorGetCommand, {
    permission: "read",
    schema: ColorGetParamsSchema,
  });
  // ROADMAP 62 — 바꾸기. 문서가 아니라 앱 상태를 건드리지만 previous 로 되돌린다.
  registry.register(COLOR_SET_FOREGROUND, colorSetForegroundCommand, {
    permission: "edit",
    schema: ColorSetParamsSchema,
  });
  registry.register(COLOR_SET_BACKGROUND, colorSetBackgroundCommand, {
    permission: "edit",
    schema: ColorSetParamsSchema,
  });
  registry.register(DODGE_BURN_DAB, dodgeBurnDabCommand, {
    // 배경을 거절하므로 바뀌는 것은 사용자가 이 용도로 만든 레이어뿐이다.
    permission: "edit",
    schema: DodgeBurnParamsSchema,
  });
  registry.register(ACTION_LIST, actionListCommand, {
    // 액션 목록을 읽을 뿐 실행하지 않는다.
    permission: "read",
    schema: ActionListParamsSchema,
  });
  registry.register(ACTION_ALLOWLIST, actionAllowlistCommand, {
    // 사용자가 패널에서 고른 것을 읽을 뿐이다.
    permission: "read",
    schema: ActionAllowlistParamsSchema,
  });
  registry.register(EXTENSION_REGISTRY, extensionRegistryCommand, {
    // 목록을 보는 것은 적재가 아니다. 적재는 서버가 하고 그쪽에 권한이 걸린다.
    permission: "read",
    schema: ExtensionRegistryParamsSchema,
  });
  registry.register(ACTION_PLAY, actionPlayCommand, {
    // **액션이 무엇을 하는지 알 수 없다.** 파일 저장·평탄화가 들어 있어도
    // 이름만으로는 모른다. 모르는 것을 edit 으로 두면 조용히 경계를 넘는다.
    permission: "destructive",
    schema: ActionPlayParamsSchema,
  });
  registry.register(TEXT_CREATE, textCreateCommand, {
    permission: "edit",
    schema: TextCreateParamsSchema,
  });
  registry.register(TEXT_SET, textSetCommand, {
    permission: "edit",
    schema: TextSetParamsSchema,
  });
  registry.register(FONT_LIST, fontListCommand, {
    // 설치된 폰트를 읽을 뿐 문서를 바꾸지 않는다.
    permission: "read",
    schema: FontListParamsSchema,
  });
  registry.register(PAINT_DAB, paintDabCommand, {
    // 배경을 거절하므로 바뀌는 것은 사용자가 이 용도로 만든 레이어뿐이다.
    permission: "edit",
    schema: PaintDabParamsSchema,
  });
  registry.register(MASK_DAB, maskDabCommand, {
    // 마스크만 바꾼다. 픽셀은 건드리지 않는다.
    permission: "edit",
    schema: MaskDabParamsSchema,
  });
  registry.register(LAYER_REORDER, layerReorderCommand, {
    permission: "edit",
    schema: LayerReorderParamsSchema,
  });
  registry.register(MEASURE_TILT, measureTiltCommand, {
    // 픽셀을 읽을 뿐 문서를 바꾸지 않는다.
    permission: "read",
    schema: MeasureTiltParamsSchema,
  });
  registry.register(DOCUMENT_ROTATE, documentRotateCommand, {
    // 픽셀을 재보간하지만 History 로 되돌아간다. destructive 로 올리면 기본
    // 허용 밖이라 수평 교정이 기본 설정에서 막힌다. (§17.19)
    permission: "edit",
    schema: DocumentRotateParamsSchema,
  });
  registry.register(CAPTURE_DOCUMENT, captureDocumentCommand, {
    permission: "read",
    schema: CaptureDocumentParams,
  });
  registry.register(CAPTURE_LAYER, captureLayerCommand, {
    permission: "read",
    schema: CaptureLayerParams,
  });
  registry.register(CAPTURE_SELECTION, captureSelectionCommand, {
    permission: "read",
    schema: CaptureSelectionParams,
  });
  registry.register(LAYER_FROM_BACKGROUND, layerFromBackgroundCommand, {
    permission: "edit",
    schema: LayerFromBackgroundParams,
  });
  registry.register(ADJUSTMENT_COLOR_BALANCE, adjustmentColorBalanceCommand, {
    permission: "edit",
    schema: ColorBalanceParams,
  });
  registry.register(FILTER_HIGH_PASS, filterHighPassCommand, {
    permission: "edit",
    schema: HighPassParams,
  });
  registry.register(FILTER_MINIMUM_MAXIMUM, filterMinimumMaximumCommand, {
    permission: "edit",
    schema: MinimumMaximumParams,
  });

  // ROADMAP §53 — DOM `layer.apply*` 필터. 전부 픽셀 편집이라 `edit` 이다.
  registry.register(FILTER_SHARPEN, filterSharpenCommand, {
    permission: "edit",
    schema: FilterSharpenParamsSchema,
  });
  registry.register(FILTER_UNSHARP_MASK, filterUnsharpMaskCommand, {
    permission: "edit",
    schema: FilterUnsharpMaskParamsSchema,
  });
  registry.register(FILTER_MOTION_BLUR, filterMotionBlurCommand, {
    permission: "edit",
    schema: FilterMotionBlurParamsSchema,
  });
  registry.register(FILTER_DUST_AND_SCRATCHES, filterDustAndScratchesCommand, {
    permission: "edit",
    schema: FilterDustAndScratchesParamsSchema,
  });
  registry.register(SELECTION_SAVE_CHANNEL, selectionSaveChannelCommand, {
    permission: "edit",
    schema: SaveChannelParams,
  });
  registry.register(SELECTION_LOAD_CHANNEL, selectionLoadChannelCommand, {
    permission: "edit",
    schema: LoadChannelParams,
  });
  /* **선택 경계만 움직인다.** 레퍼런스가 "Does not affect the active layer"
   * 라고 적는다 — 픽셀을 다시 표본화하지 않으므로 `layer.scale` 과 갈린다. */
  registry.register(SELECTION_TRANSLATE_BOUNDARY, selectionTranslateBoundaryCommand, {
    permission: "edit",
    schema: SelectionTranslateBoundaryParamsSchema,
  });
  registry.register(SELECTION_SCALE_BOUNDARY, selectionScaleBoundaryCommand, {
    permission: "edit",
    schema: SelectionScaleBoundaryParamsSchema,
  });
  registry.register(SELECTION_ROTATE_BOUNDARY, selectionRotateBoundaryCommand, {
    permission: "edit",
    schema: SelectionRotateBoundaryParamsSchema,
  });
  registry.register(SELECTION_POLYGON, selectionPolygonCommand, {
    permission: "edit",
    schema: SelectionPolygonParamsSchema,
  });
  registry.register(SELECTION_MODIFY, selectionModifyCommand, {
    permission: "edit",
    schema: SelectionModifyParams,
  });
  registry.register(SELECTION_COLOR_RANGE, selectionColorRangeCommand, {
    permission: "edit",
    schema: ColorRangeParams,
  });

  /* 합성 휘도를 선택으로. descriptor 는 짐작이 아니라 실기에서 잡았다(§17.17). */
  registry.register(SELECTION_LUMINOSITY, selectionLuminosityCommand, {
    permission: "edit",
    schema: SelectionLuminosityParams,
  });
  registry.register(LAYER_STAMP_VISIBLE, layerStampVisibleCommand, {
    permission: "edit",
    schema: StampVisibleParams,
  });
  registry.register(MASK_GRADIENT, maskGradientCommand, {
    permission: "edit",
    schema: MaskGradientParams,
  });

  // Phase 3 — 레이어 편집 (비파괴)
  const edit = "edit" as const;
  registry.register(LAYER_CREATE, layerCreateCommand, {
    permission: edit,
    schema: LayerCreateParamsSchema,
  });
  registry.register(LAYER_DUPLICATE, layerDuplicateCommand, {
    permission: edit,
    schema: LayerDuplicateParamsSchema,
  });
  registry.register(LAYER_RENAME, layerRenameCommand, {
    permission: edit,
    schema: LayerRenameParamsSchema,
  });
  registry.register(LAYER_SELECT, layerSelectCommand, {
    permission: edit,
    schema: LayerSelectParamsSchema,
  });
  registry.register(LAYER_VISIBILITY, layerVisibilityCommand, {
    permission: edit,
    schema: LayerVisibilityParamsSchema,
  });
  registry.register(LAYER_OPACITY, layerOpacityCommand, {
    permission: edit,
    schema: LayerOpacityParamsSchema,
  });
  registry.register(LAYER_FILL_OPACITY, layerFillOpacityCommand, {
    permission: edit,
    schema: LayerFillOpacityParamsSchema,
  });

  // Phase 3 — 그룹
  registry.register(GROUP_CREATE, groupCreateCommand, {
    permission: edit,
    schema: GroupCreateParamsSchema,
  });
  registry.register(GROUP_MOVE_LAYER, groupMoveLayerCommand, {
    permission: edit,
    schema: GroupMoveLayerParamsSchema,
  });

  // Phase 3 — History
  //
  // undo 는 되돌리기이지 파괴가 아니다. 이미 한 편집을 취소할 뿐,
  // Photoshop 의 History 에 남아 redo 할 수 있다.
  registry.register(HISTORY_UNDO, historyUndoCommand, {
    permission: edit,
    schema: HistoryUndoParamsSchema,
  });
  // redo 도 같다. 되돌린 것을 다시 놓을 뿐이고 잃는 것이 없다.
  registry.register(HISTORY_REDO, historyRedoCommand, {
    permission: edit,
    schema: HistoryRedoParamsSchema,
  });

  // Phase 4 — 조정 레이어 (비파괴)
  registry.register(ADJUSTMENT_CURVES, curvesCommand, {
    permission: edit,
    schema: CurvesParamsSchema,
  });
  registry.register(ADJUSTMENT_LEVELS, levelsCommand, {
    permission: edit,
    schema: LevelsParamsSchema,
  });
  registry.register(ADJUSTMENT_BRIGHTNESS_CONTRAST, brightnessContrastCommand, {
    permission: edit,
    schema: BrightnessContrastParamsSchema,
  });

  // Phase 4 — 마스크 (비파괴)
  registry.register(MASK_CREATE, maskCreateCommand, {
    permission: edit,
    schema: MaskCreateParamsSchema,
  });
  registry.register(MASK_ENABLE, maskEnableCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });
  registry.register(MASK_DISABLE, maskDisableCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });
  /* **`destructive` 다.** CORE_API §9 가 처음부터 그렇게 못 박아 두었다.
   * 마스크는 가리기만 하므로 끄면 되살아나지만, 구우면 가려진 픽셀이
   * 실제로 없어진다 — `document.flatten` 과 같은 종류의 손실이다. */
  registry.register(MASK_APPLY, maskApplyCommand, {
    permission: "destructive",
    schema: MaskToggleParamsSchema,
  });
  /* **`destructive` 는 픽셀이 아니라 마스크 때문이다.** 가린 픽셀은 되살아나지만
   * `mask.dab` · `mask.gradient` 로 쌓아 둔 마스크가 한 번에 사라진다. */
  registry.register(MASK_DELETE, maskDeleteCommand, {
    permission: "destructive",
    schema: MaskToggleParamsSchema,
  });
  /* **`edit` 다.** 마스크도 픽셀도 사라지지 않고 함께 움직일지만 정한다. */
  registry.register(MASK_LINK, maskLinkCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });
  registry.register(MASK_UNLINK, maskUnlinkCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });
  /* **`edit` 다.** 픽셀을 바꾸지 않고 편집 대상만 옮긴다. 다만 옮겨 둔 채로
   * 두면 뒤따르는 편집이 전부 마스크에 걸리므로, 되돌리는 `pixels` 를 같은
   * Tool 이 갖는다. */
  registry.register(MASK_SELECT, maskSelectCommand, {
    permission: edit,
    schema: MaskSelectParamsSchema,
  });
  registry.register(MASK_INVERT, maskInvertCommand, {
    permission: edit,
    schema: MaskToggleParamsSchema,
  });

  // Phase 4 — 선택 영역
  registry.register(SELECTION_CLEAR, selectionClearCommand, {
    permission: edit,
    schema: SelectionParamsSchema,
  });
  registry.register(SELECTION_INVERT, selectionInvertCommand, {
    permission: edit,
    schema: SelectionParamsSchema,
  });

  // Phase 4 — 필터 (기본 스마트 필터로 비파괴)
  registry.register(FILTER_GAUSSIAN_BLUR, gaussianBlurCommand, {
    permission: edit,
    schema: GaussianBlurParamsSchema,
  });

  // ROADMAP §8.6 — 실기에서 드러난 공백
  registry.register(LAYER_BLEND_MODE, layerBlendModeCommand, {
    permission: edit,
    schema: LayerBlendModeParamsSchema,
  });
  registry.register(SELECTION_SET, selectionSetCommand, {
    permission: edit,
    schema: SelectionSetParamsSchema,
  });
  registry.register(ADJUSTMENT_HUE_SATURATION, hueSaturationCommand, {
    permission: edit,
    schema: HueSaturationParamsSchema,
  });
  registry.register(ADJUSTMENT_VIBRANCE, vibranceCommand, {
    permission: edit,
    schema: VibranceParamsSchema,
  });

  // ROADMAP §52 — 조정 레이어 넷. descriptor 는 ["all"] 알림으로 잡았다.
  registry.register(ADJUSTMENT_EXPOSURE, adjustmentExposureCommand, {
    permission: edit,
    schema: AdjustmentExposureParamsSchema,
  });
  registry.register(ADJUSTMENT_BLACK_WHITE, adjustmentBlackWhiteCommand, {
    permission: edit,
    schema: AdjustmentBlackWhiteParamsSchema,
  });
  registry.register(ADJUSTMENT_PHOTO_FILTER, adjustmentPhotoFilterCommand, {
    permission: edit,
    schema: AdjustmentPhotoFilterParamsSchema,
  });
  registry.register(ADJUSTMENT_CHANNEL_MIXER, adjustmentChannelMixerCommand, {
    permission: edit,
    schema: AdjustmentChannelMixerParamsSchema,
  });

  // Phase 9 — 파일 저장 (ROADMAP §8.5)
  //
  // save_as 와 export 는 Photoshop 밖(파일 시스템)에 쓰므로 external 이다.
  // 덮어쓰지 않으므로 데이터를 잃지 않는다.
  //
  // save 는 원본을 덮어쓴다. 되돌릴 수 없으므로 destructive 다.
  registry.register(WORKSPACE_STATUS, workspaceStatusCommand, { permission: "read" });
  registry.register(DOCUMENT_SAVE_AS, saveAsCommand, {
    permission: "external",
    schema: SaveAsParamsSchema,
  });
  registry.register(DOCUMENT_EXPORT, exportCommand, {
    permission: "external",
    schema: ExportParamsSchema,
  });
  registry.register(DOCUMENT_SAVE, saveCommand, { permission: "destructive" });
  /* 선택 영역을 파일로 내보낸다. 외부 처리기가 "어디가 하늘인지" 를 알아야
   * 하는 경우가 있다 — GraXpert 는 지상이 배경 모델을 끌어당긴다. */
  registry.register(SELECTION_EXPORT_MASK, selectionExportMaskCommand, {
    permission: "external",
    schema: SelectionExportMaskParamsSchema,
  });

  // 외부 처리 결과를 되돌리는 길. 승인된 폴더 안이라도 Photoshop 밖 파일을 읽으므로
  // export 와 같은 external 이다.
  registry.register(LAYER_PLACE, layerPlaceCommand, {
    permission: "external",
    schema: LayerPlaceParamsSchema,
  });

  // ROADMAP §17 — 임시 파일 관리
  // 조회는 read, 삭제는 되돌릴 수 없으므로 destructive.
  registry.register(WORKSPACE_USAGE, workspaceUsageCommand, {
    permission: "read",
    schema: WorkspaceUsageParamsSchema,
  });
  registry.register(WORKSPACE_DELETE, workspaceDeleteCommand, {
    permission: "destructive",
    schema: WorkspaceDeleteParamsSchema,
  });

  // ROADMAP §16 — MCP Resource 를 뒷받침하는 읽기 Command
  registry.register(SELECTION_GET, selectionGetCommand, { permission: "read" });
  registry.register(HISTORY_LIST, historyListCommand, { permission: "read" });
}
