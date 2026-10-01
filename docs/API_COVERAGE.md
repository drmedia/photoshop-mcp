# Photoshop API 커버리지 매트릭스

> **자동 생성 문서다 — 직접 고치지 않는다.** `node scripts/api-coverage.mjs` 가 만든다.
> 기준은 Adobe 공식 DOM 레퍼런스 원본(`AdobeDocs/uxp-photoshop@208fe86`, 2026-08-14)이고 비교 대상은 `photoshop-uxp/src` 다.

## 읽는 법

- **확인** — 그 이름이 **이 클래스에만** 있고 플러그인 소스가 쓴다. 가장 믿을 만하다.
- **공유 이름** — 소스가 그 이름을 쓰지만 이름을 여러 클래스가 공유해(`name` · `id` · `delete` …)
  **어느 클래스를 가리키는지 알 수 없다.** 쓰고 있을 수도, 아닐 수도 있다.
- **대응** — 사람이 적은 `docs/api-coverage/provided-otherwise.json` 의 항목. DOM 이 아니라
  다른 길(주로 batchPlay)로 **Tool 이 이미 제공**한다. 표는 테스트가 검증한다.
- **반사 읽기** — `Preferences/*` 는 `preferences.get` 이 열거 가능한 키를 훑어 읽는다. 이름이
  코드에 없는 것이 정상이라 이름 기준 비교가 성립하지 않는다.
- **흔적 없음** — 소스 어디에도 그 이름이 없다. 빈틈일 수도, 일부러 안 연 것일 수도,
  batchPlay 로 이미 제공하는데 아직 대응표에 안 적힌 것일 수도 있다.

**"흔적 없음" 을 "Tool 이 없다" 로 읽지 않는다.** 이 문서는 DOM **사용 흔적**을 센다.
batchPlay 로 구현한 기능은 DOM 멤버 이름이 코드에 없어 흔적 없음으로 나온다.
확인 수는 하한이고, 이 표는 **어디를 들여다볼지** 알려 줄 뿐 "무엇이 빠졌다" 고 단정하지 않는다.

## 요약

클래스 48개 · 멤버 506개 — 확인 **143** (28%) · 대응 4 · 공유 이름 148 (29%) · 반사 읽기 55 · 흔적 없음 156 (31%)

## DOM 에 있는데 batchPlay 로 구현한 것

Adobe 레퍼런스를 먼저 본다는 이 프로젝트의 규칙에서 보면 **옮길 수 있는지 살펴볼 후보**다.
`selection.set` 을 batchPlay 에서 DOM 으로 옮기며 `mode` 와 `antiAlias` 를 얻은 것(ROADMAP §71)과
같은 종류다. 옮기라는 권고가 아니다 — 스마트 필터로 붙는 방식이 같은지 등은 재 봐야 안다.

| DOM 멤버 | 최소 버전 | Tool | 비고 |
|---|---|---|---|
| `Layer.applyGaussianBlur`() | 23.5 | `photoshop.filter.gaussian_blur` | `_obj: "gaussianBlur"` (filter.ts). DOM 은 23.5 부터 |
| `Layer.applyHighPass`() | 23.5 | `photoshop.filter.high_pass` | `_obj: "highPass"` (filter.ts). DOM 은 23.5 부터 |
| `Layer.applyMaximum`() | 23.5 | `photoshop.filter.minimum_maximum` | `mode: maximum` 일 때 `_obj: "maximum"` (filter.ts). DOM 은 23.5 부터 |
| `Layer.applyMinimum`() | 23.5 | `photoshop.filter.minimum_maximum` | `mode: minimum` 일 때 `_obj: "minimum"` (filter.ts). DOM 은 23.5 부터 |

## 클래스별 요약

| 클래스 | 멤버 | 확인 | 대응 | 공유 이름 | 반사 읽기 | 흔적 없음 | 확인 비율 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Layer | 83 | 26 | 4 | 14 | 0 | 39 | 31% |
| Document | 65 | 30 | 0 | 8 | 0 | 27 | 46% |
| CharacterStyle | 34 | 10 | 0 | 1 | 0 | 23 | 29% |
| Selection | 26 | 14 | 0 | 5 | 0 | 7 | 54% |
| Photoshop | 18 | 10 | 0 | 1 | 0 | 7 | 56% |
| LayerComp | 16 | 7 | 0 | 7 | 0 | 2 | 44% |
| ParagraphStyle | 15 | 7 | 0 | 0 | 0 | 8 | 47% |
| PathItem | 15 | 5 | 0 | 8 | 0 | 2 | 33% |
| CountItems | 14 | 0 | 0 | 4 | 0 | 10 | 0% |
| TextItem | 14 | 11 | 0 | 2 | 0 | 1 | 79% |
| Preferences | 13 | 12 | 0 | 1 | 0 | 0 | 92% |
| Channel | 10 | 0 | 0 | 10 | 0 | 0 | 0% |
| Action | 8 | 0 | 0 | 8 | 0 | 0 | 0% |
| ActionSet | 8 | 1 | 0 | 7 | 0 | 0 | 13% |
| SolidColor | 8 | 4 | 0 | 1 | 0 | 3 | 50% |
| ColorSampler | 7 | 0 | 0 | 6 | 0 | 1 | 0% |
| CountItem | 7 | 0 | 0 | 5 | 0 | 2 | 0% |
| Guide | 7 | 1 | 0 | 5 | 0 | 1 | 14% |
| Preferences/PreferencesHistory | 7 | 0 | 0 | 0 | 7 | 0 | 0% |
| Channels | 6 | 0 | 0 | 4 | 0 | 2 | 0% |
| HistoryState | 6 | 0 | 0 | 4 | 0 | 2 | 0% |
| LayerComps | 6 | 0 | 0 | 4 | 0 | 2 | 0% |
| PathPoint | 6 | 0 | 0 | 4 | 0 | 2 | 0% |
| Preferences/PreferencesFileHandling | 6 | 0 | 0 | 0 | 6 | 0 | 0% |
| Preferences/PreferencesGeneral | 6 | 0 | 0 | 0 | 6 | 0 | 0% |
| Preferences/PreferencesNotifications | 6 | 0 | 0 | 0 | 6 | 0 | 0% |
| TextFont | 6 | 2 | 0 | 4 | 0 | 0 | 33% |
| WarpStyle | 6 | 3 | 0 | 2 | 0 | 1 | 50% |
| Documents | 5 | 0 | 0 | 4 | 0 | 1 | 0% |
| PathItems | 5 | 0 | 0 | 3 | 0 | 2 | 0% |
| PathPointInfo | 5 | 0 | 0 | 3 | 0 | 2 | 0% |
| Preferences/PreferencesGuidesGridsAndSlices | 5 | 0 | 0 | 0 | 5 | 0 | 0% |
| SubPathItem | 5 | 0 | 0 | 3 | 0 | 2 | 0% |
| ColorSamplers | 4 | 0 | 0 | 3 | 0 | 1 | 0% |
| Guides | 4 | 0 | 0 | 3 | 0 | 1 | 0% |
| Layers | 4 | 0 | 0 | 3 | 0 | 1 | 0% |
| Preferences/PreferencesInterface | 4 | 0 | 0 | 0 | 4 | 0 | 0% |
| Preferences/PreferencesTools | 4 | 0 | 0 | 0 | 4 | 0 | 0% |
| Preferences/PreferencesType | 4 | 0 | 0 | 0 | 4 | 0 | 0% |
| Preferences/PreferencesUnitsAndRulers | 4 | 0 | 0 | 0 | 4 | 0 | 0% |
| SubPathInfo | 4 | 0 | 0 | 2 | 0 | 2 | 0% |
| TextFonts | 4 | 0 | 0 | 3 | 0 | 1 | 0% |
| HistoryStates | 3 | 0 | 0 | 2 | 0 | 1 | 0% |
| Preferences/PreferencesCursors | 3 | 0 | 0 | 0 | 3 | 0 | 0% |
| Preferences/PreferencesPerformance | 3 | 0 | 0 | 0 | 3 | 0 | 0% |
| Preferences/PreferencesTransparencyAndGamut | 3 | 0 | 0 | 0 | 3 | 0 | 0% |
| PathPoints | 2 | 0 | 0 | 2 | 0 | 0 | 0% |
| SubPathItems | 2 | 0 | 0 | 2 | 0 | 0 | 0% |

## 클래스별 상세

### Action

- **공유 이름 (8)**: `id`(8) · `index`(2) · `name`(9) · `parent`(25) · `typename`(38) · `delete`(4) · `duplicate`(7) · `play`(2)

### ActionSet

- **확인 (1)**: `actions`
- **공유 이름 (7)**: `id`(8) · `index`(2) · `name`(9) · `typename`(38) · `delete`(4) · `duplicate`(7) · `play`(2)

### Channel

- **공유 이름 (10)**: `color`(3) · `histogram`(2) · `kind`(5) · `name`(9) · `opacity`(2) · `parent`(25) · `visible`(2) · `duplicate`(7) · `merge`(2) · `remove`(5)

### Channels

- **공유 이름 (4)**: `length`(12) · `parent`(25) · `typename`(38) · `add`(8)
- **흔적 없음 (2)**: `getByName`() _23.0_ · `removeAll`() _23.0_

### CharacterStyle

- **확인 (10)**: `baselineShift` · `fauxBold` · `fauxItalic` · `font` · `horizontalScale` · `leading` · `size` · `tracking` · `useAutoLeading` · `verticalScale`
- **공유 이름 (1)**: `color`(3)
- **흔적 없음 (23)**: `alternateLigatures` _false_ · `antiAliasMethod` _SHARP_ · `autoKerning` _METRICS_ · `baseline` _NORMAL_ · `capitalization` _NORMAL_ · `characterAlignment` _ROMAN_ · `fractionalWidths` _false_ · `fractions` _false_ · `horizontalDiacriticPosition` _-_ · `kashidas` _true_ · `language` _-_ · `ligatures` _true_ · `middleEasternDigitsType` _LTRARABIC_ · `middleEasternTextDirection` _DEFAULT_ · `noBreak` _false_ · `ordinals` _false_ · `strikeThrough` _STRIKEOFF_ · `stylisticAlternates` _false_ · `swash` _false_ · `titlingAlternates` _false_ · `underline` _NONE_ · `verticalDiacriticPosition` _-_ · `reset`() _24.1_

### ColorSampler

- **공유 이름 (6)**: `color`(3) · `parent`(25) · `position`(3) · `typename`(38) · `move`(3) · `remove`(5)
- **흔적 없음 (1)**: `docId` _24.0_

### ColorSamplers

- **공유 이름 (3)**: `length`(12) · `parent`(25) · `add`(8)
- **흔적 없음 (1)**: `removeAll`() _24.0_

### CountItem

- **공유 이름 (5)**: `parent`(25) · `position`(3) · `typename`(38) · `move`(3) · `remove`(5)
- **흔적 없음 (2)**: `groupIndex` · `itemIndex`

### CountItems

- **공유 이름 (4)**: `length`(12) · `parent`(25) · `typename`(38) · `add`(8)
- **흔적 없음 (10)**: `activateGroupByIndex`() _24.1_ · `createGroup`() _24.1_ · `getAll`() _24.1_ · `removeAllFromActiveGroup`() _24.1_ · `removeGroupByIndex`() _24.1_ · `renameActiveGroup`() _24.1_ · `setActiveColor`() _24.1_ · `setActiveLabelSize`() _24.1_ · `setActiveMarkerSize`() _24.1_ · `toggleActiveGroupVisibility`() _24.1_

### Document

- **확인 (30)**: `saveAs` · `selection` · `activeChannels` · `activeHistoryState` · `activeLayers` · `bitsPerChannel` · `channels` · `componentChannels` · `guides` · `height` · `historyStates` · `layerComps` · `mode` · `path` · `pathItems` · `resolution` · `width` · `changeMode`() · `close`() · `createLayer`() · `createLayerGroup`() · `createTextLayer`() · `crop`() · `flatten`() · `mergeVisibleLayers`() · `paste`() · `resizeCanvas`() · `resizeImage`() · `revealAll`() · `trim`()
- **공유 이름 (8)**: `histogram`(2) · `id`(8) · `layers`(2) · `name`(9) · `typename`(38) · `duplicate`(7) · `rotate`(2) · `save`(2)
- **흔적 없음 (27)**: `activeHistoryBrushSource` _22.5_ · `artboards` _22.5_ · `backgroundLayer` _22.5_ · `cloudDocument` _23.0_ · `cloudWorkAreaDirectory` _23.0_ · `colorProfileName` _23.0_ · `colorProfileType` _23.0_ · `colorSamplers` _24.0_ · `countItems` _24.1_ · `pixelAspectRatio` _22.5_ · `quickMaskMode` _23.0_ · `saved` _23.0_ · `title` _22.5_ · `zoom` _25.1_ · `calculations`() _24.5_ · `closeWithoutSaving`() _22.5_ · `convertProfile`() _23.0_ · `createPixelLayer`() _24.1_ · `duplicateLayers`() _23.0_ · `generativeUpscale`() _27.2_ · `groupLayers`() _23.0_ · `linkLayers`() _23.0_ · `rasterizeAllLayers`() _23.0_ · `sampleColor`() _24.0_ · `splitChannels`() _23.0_ · `suspendHistory`() _23.0_ · `trap`() _23.0_

### Documents

- **공유 이름 (4)**: `length`(12) · `parent`(25) · `typename`(38) · `add`(8)
- **흔적 없음 (1)**: `getByName`() _22.5_

### Guide

- **확인 (1)**: `coordinate`
- **공유 이름 (5)**: `direction`(2) · `id`(8) · `parent`(25) · `typename`(38) · `delete`(4)
- **흔적 없음 (1)**: `docId` _23.0_

### Guides

- **공유 이름 (3)**: `length`(12) · `parent`(25) · `add`(8)
- **흔적 없음 (1)**: `removeAll`() _23.0_

### HistoryState

- **공유 이름 (4)**: `id`(8) · `name`(9) · `parent`(25) · `typename`(38)
- **흔적 없음 (2)**: `docId` _22.5_ · `snapshot` _22.5_

### HistoryStates

- **공유 이름 (2)**: `length`(12) · `parent`(25)
- **흔적 없음 (1)**: `getByName`() _22.5_

### Layer

- **확인 (26)**: `allLocked` · `blendMode` · `boundsNoEffects` · `document` · `fillOpacity` · `isBackgroundLayer` · `isClippingMask` · `linkedLayers` · `locked` · `pixelsLocked` · `positionLocked` · `textItem` · `transparentPixelsLocked` · `applyDustAndScratches`() · `applyMotionBlur`() · `applySharpen`() · `applySharpenEdges`() · `applySharpenMore`() · `applyUnSharpMask`() · `clear`() · `flip`() · `link`() · `rasterize`() · `scale`() · `translate`() · `unlink`()
- **대응 (4)**: `applyGaussianBlur`() → `photoshop.filter.gaussian_blur` · `applyHighPass`() → `photoshop.filter.high_pass` · `applyMaximum`() → `photoshop.filter.minimum_maximum` · `applyMinimum`() → `photoshop.filter.minimum_maximum`
- **공유 이름 (14)**: `bounds`(2) · `id`(8) · `kind`(5) · `layers`(2) · `name`(9) · `opacity`(2) · `parent`(25) · `typename`(38) · `visible`(2) · `delete`(4) · `duplicate`(7) · `merge`(2) · `move`(3) · `rotate`(2)
- **흔적 없음 (39)**: `filterMaskDensity` _23.0_ · `filterMaskFeather` _23.0_ · `layerMaskDensity` _23.0_ · `layerMaskFeather` _23.0_ · `vectorMaskDensity` _23.0_ · `vectorMaskFeather` _23.0_ · `applyAddNoise`() _23.5_ · `applyAverage`() _23.5_ · `applyBlur`() _23.5_ · `applyBlurMore`() _23.5_ · `applyClouds`() _23.5_ · `applyCustomFilter`() _23.5_ · `applyDeInterlace`() _23.5_ · `applyDespeckle`() _23.5_ · `applyDifferenceClouds`() _23.5_ · `applyDiffuseGlow`() _23.5_ · `applyDisplace`() _23.5_ · `applyGlassEffect`() _23.5_ · `applyImage`() _24.5_ · `applyLensBlur`() _23.5_ · `applyLensFlare`() _23.5_ · `applyMedianNoise`() _23.5_ · `applyNTSC`() _23.5_ · `applyOceanRipple`() _23.5_ · `applyOffset`() _23.5_ · `applyPinch`() _23.5_ · `applyPolarCoordinates`() _23.5_ · `applyRipple`() _23.5_ · `applyShear`() _23.5_ · `applySmartBlur`() _24.0_ · `applySpherize`() _24.0_ · `applyTwirl`() _23.5_ · `applyWave`() _24.0_ · `applyZigZag`() _24.0_ · `bringToFront`() _23.0_ · `copy`() _23.0_ · `cut`() _23.0_ · `sendToBack`() _23.0_ · `skew`() _23.0_

### LayerComp

- **확인 (7)**: `appearance` · `childComp` · `comment` · `selected` · `visibility` · `apply`() · `recapture`()
- **공유 이름 (7)**: `id`(8) · `name`(9) · `parent`(25) · `position`(3) · `typename`(38) · `duplicate`(7) · `remove`(5)
- **흔적 없음 (2)**: `docId` _24.0_ · `resetLayerComp`() _24.0_

### LayerComps

- **공유 이름 (4)**: `length`(12) · `parent`(25) · `typename`(38) · `add`(8)
- **흔적 없음 (2)**: `getAllByName`() _24.0_ · `removeAll`() _24.0_

### Layers

- **공유 이름 (3)**: `length`(12) · `typename`(38) · `add`(8)
- **흔적 없음 (1)**: `getByName`() _22.5_

### ParagraphStyle

- **확인 (7)**: `firstLineIndent` · `hyphenation` · `justification` · `leftIndent` · `rightIndent` · `spaceAfter` · `spaceBefore`
- **흔적 없음 (8)**: `features` _DEFAULT_ · `hyphenationFeatures` _-_ · `justificationFeatures` _-_ · `kashidaWidth` _MEDIUM_ · `kinsoku` _NONE_ · `layoutMode` _WORLD_ · `mojikumi` _NONE_ · `reset`() _24.1_

### PathItem

- **확인 (5)**: `subPathItems` · `fillPath`() · `makeSelection`() · `select`() · `strokePath`()
- **공유 이름 (8)**: `id`(8) · `kind`(5) · `name`(9) · `parent`(25) · `typename`(38) · `deselect`(2) · `duplicate`(7) · `remove`(5)
- **흔적 없음 (2)**: `docId` _23.3_ · `makeClippingPath`() _23.3_

### PathItems

- **공유 이름 (3)**: `length`(12) · `parent`(25) · `add`(8)
- **흔적 없음 (2)**: `getByName`() _23.3_ · `removeAll`() _23.3_

### PathPoint

- **공유 이름 (4)**: `anchor`(2) · `kind`(5) · `parent`(25) · `typename`(38)
- **흔적 없음 (2)**: `leftDirection` _23.3_ · `rightDirection` _23.3_

### PathPointInfo

- **공유 이름 (3)**: `anchor`(2) · `kind`(5) · `typename`(38)
- **흔적 없음 (2)**: `leftDirection` _23.3_ · `rightDirection` _23.3_

### PathPoints

- **공유 이름 (2)**: `length`(12) · `parent`(25)

### Photoshop

- **확인 (10)**: `actionTree` · `activeDocument` · `backgroundColor` · `displayDialogs` · `documents` · `fonts` · `foregroundColor` · `preferences` · `batchPlay`() · `open`()
- **공유 이름 (1)**: `typename`(38)
- **흔적 없음 (7)**: `currentTool` _23.0_ · `bringToFront`() _23.0_ · `convertUnits`() _23.4_ · `createDocument`() _23.0_ · `getColorProfiles`() _24.1_ · `showAlert`() _23.0_ · `updateUI`() _26.0_

### Preferences

- **확인 (12)**: `cursors` · `fileHandling` · `general` · `guidesGridsAndSlices` · `history` · `interface` · `notifications` · `performance` · `tools` · `transparencyAndGamut` · `type` · `unitsAndRulers`
- **공유 이름 (1)**: `typename`(38)

### Preferences/PreferencesCursors

- **반사 읽기 (3)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesFileHandling

- **반사 읽기 (6)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesGeneral

- **반사 읽기 (6)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesGuidesGridsAndSlices

- **반사 읽기 (5)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesHistory

- **반사 읽기 (7)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesInterface

- **반사 읽기 (4)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesNotifications

- **반사 읽기 (6)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesPerformance

- **반사 읽기 (3)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesTools

- **반사 읽기 (4)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesTransparencyAndGamut

- **반사 읽기 (3)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesType

- **반사 읽기 (4)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Preferences/PreferencesUnitsAndRulers

- **반사 읽기 (4)**: `preferences.get` 이 훑는다 — 이름 비교 대상이 아니다.

### Selection

- **확인 (14)**: `contract`() · `expand`() · `feather`() · `inverse`() · `load`() · `makeWorkPath`() · `resizeBoundary`() · `rotateBoundary`() · `selectAll`() · `selectEllipse`() · `selectPolygon`() · `selectRectangle`() · `smooth`() · `translateBoundary`()
- **공유 이름 (5)**: `bounds`(2) · `parent`(25) · `typename`(38) · `deselect`(2) · `save`(2)
- **흔적 없음 (7)**: `docId` _25.0_ · `solid` _25.0_ · `grow`() _25.0_ · `saveTo`() _25.0_ · `selectBorder`() _25.0_ · `selectColumn`() _25.0_ · `selectRow`() _25.0_

### SolidColor

- **확인 (4)**: `cmyk` · `gray` · `lab` · `rgb`
- **공유 이름 (1)**: `typename`(38)
- **흔적 없음 (3)**: `hsb` _23.0_ · `nearestWebColor` _23.0_ · `isEqual`() _23.0_

### SubPathInfo

- **공유 이름 (2)**: `operation`(2) · `typename`(38)
- **흔적 없음 (2)**: `closed` _23.3_ · `entireSubPath` _23.3_

### SubPathItem

- **공유 이름 (3)**: `operation`(2) · `parent`(25) · `typename`(38)
- **흔적 없음 (2)**: `closed` _23.3_ · `pathPoints` _23.3_

### SubPathItems

- **공유 이름 (2)**: `length`(12) · `parent`(25)

### TextFont

- **확인 (2)**: `family` · `postScriptName`
- **공유 이름 (4)**: `name`(9) · `parent`(25) · `style`(2) · `typename`(38)

### TextFonts

- **공유 이름 (3)**: `length`(12) · `parent`(25) · `typename`(38)
- **흔적 없음 (1)**: `getByName`() _23.0_

### TextItem

- **확인 (11)**: `characterStyle` · `paragraphStyle` · `warpStyle` · `contents` · `isParagraphText` · `isPointText` · `orientation` · `textClickPoint` · `convertToParagraphText`() · `convertToPointText`() · `convertToShape`()
- **공유 이름 (2)**: `parent`(25) · `typename`(38)
- **흔적 없음 (1)**: `createWorkPath`() _24.1_

### WarpStyle

- **확인 (3)**: `bend` · `horizontalDistortion` · `verticalDistortion`
- **공유 이름 (2)**: `direction`(2) · `style`(2)
- **흔적 없음 (1)**: `reset`() _24.1_

---

공유 이름 뒤의 숫자는 그 이름을 가진 클래스 수다. 흔적 없음 뒤의 기울임 숫자는 최소 Photoshop 버전이다.
