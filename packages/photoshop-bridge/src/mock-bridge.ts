import type { PhotoshopBridge } from "./bridge.js";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import type {
  AdjustmentType,
  DocumentInfo,
  LayerInfo,
  PhotoshopCommand,
} from "./protocol/types.js";
import { withExtension, type SaveResult } from "./protocol/workspace.js";

/** ROADMAP §5.5 의 기본 Mock 문서. */
interface LayerBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const DEFAULT_MOCK_DOCUMENT: DocumentInfo = {
  id: 1,
  name: "test.psd",
  width: 6048,
  height: 4024,
  bitDepth: 16,
  colorMode: "RGB",
};

/** ROADMAP §5.5 의 기본 Mock 레이어. */
export const DEFAULT_MOCK_LAYERS: readonly LayerInfo[] = [
  {
    id: 10,
    name: "Background",
    type: "pixel",
    visible: true,
    opacity: 100,
    parentId: null,
    blendMode: "normal",
    // 실제 Photoshop 문서의 맨 아래 레이어는 보통 배경이다. Mock 이 이것을
    // 빠뜨리면 배경 레이어 특유의 동작(승격·거부)이 테스트에 영원히 안 나온다.
    isBackground: true,
  },
  {
    id: 11,
    name: "Curves 1",
    type: "adjustment",
    visible: true,
    opacity: 100,
    parentId: null,
    blendMode: "normal",
  },
  {
    id: 12,
    name: "Retouch",
    type: "pixel",
    visible: false,
    opacity: 50,
    parentId: null,
    blendMode: "normal",
  },
];

export interface MockPhotoshopBridgeOptions {
  /** 초기 연결 상태. 기본값 `true`. */
  connected?: boolean;
  /** 활성 문서. `null` 이면 열린 문서가 없는 상태를 의미한다. */
  document?: DocumentInfo | null;
  /** 활성 문서의 레이어 목록. */
  layers?: readonly LayerInfo[];
  /**
   * 승인된 작업 폴더 경로. `null` 이면 승인 전 상태를 재현한다.
   *
   * 실제 UXP 에서는 사용자가 패널에서 승인해야 값이 생긴다. (ROADMAP §8.5)
   */
  workspacePath?: string | null;
  /** 문서의 저장 경로. `null` 이면 한 번도 저장하지 않은 문서. */
  documentPath?: string | null;
  /**
   * 실제 파일 시스템을 쓰는 어댑터.
   *
   * 기본적으로 Mock 은 파일 이름만 메모리에 기록한다. 그런데 외부 처리기를 거치는
   * 흐름에서는 두 가지가 어긋난다.
   *
   * 1. 내보낸 파일이 실제로 없으면 처리기가 입력을 찾지 못한다.
   * 2. 처리기가 만든 파일을 Mock 이 모르므로 가져오기가 실패한다.
   *
   * 실제 폴더를 쓰는 테스트에서 이 어댑터를 주면 둘 다 해결된다.
   * contracts 계층이 `node:fs` 를 직접 쓰지 않도록 주입받는다.
   */
  files?: MockFileSystem;
}

/** Mock 이 쓰는 최소 파일 시스템. */
export interface MockFileSystem {
  /** 내보내기·저장이 만든 파일을 실제로 쓴다. */
  write(path: string, filename: string): void;
  /** 그 파일이 실제로 있는지. 외부 처리기가 만든 것도 보인다. */
  exists(path: string, filename: string): boolean;
}

/**
 * 실제 Photoshop 없이 Phase 1 을 검증하기 위한 Bridge 구현.
 *
 * 정상 응답뿐 아니라 오류 상황도 재현할 수 있도록
 * 연결 상태 · 문서 유무 · 1회성 실패 주입을 제어할 수 있다.
 */
export class MockPhotoshopBridge implements PhotoshopBridge {
  #connected: boolean;
  #document: DocumentInfo | null;
  #layers: LayerInfo[];
  #pendingFailure: PhotoshopMcpError | null = null;
  #activeLayerId: number | null;
  /**
   * 다중 선택. `LAYER_SELECT_MULTIPLE` 만 채운다.
   *
   * **28곳에서 `#activeLayerId` 를 직접 쓰므로 여기서 동기화하지 않는다.**
   * 대신 읽을 때 **첫 번째가 `#activeLayerId` 와 같은지** 본다. 다르면 다른
   * Command 가 활성을 바꾼 것이라 낡은 목록이고, 버린다. 이러면 한 줄로
   * 자기 교정이 된다.
   */
  #activeLayerIds: number[] = [];

  /**
   * 레이어별 칠 불투명도. (`LAYER_FILL_OPACITY`)
   *
   * `LayerInfo` 에 없는 값이라 따로 들고 있는다. **쓴 것만 담는다** — 건드린 적
   * 없는 레이어는 `LAYER_GET` 이 `null` 로 답해야 한다. 100 으로 채우면 Mock 이
   * 실기에 없는 사실을 말하게 된다.
   */
  readonly #fillOpacity = new Map<number, number>();

  /**
   * 레이어별 잠금. (`LAYER_SET_LOCK`)
   *
   * `LayerInfo` 에 없는 값이라 따로 들고 있는다. **넷이 배타적이다** —
   * 하나를 쓰면 나머지가 지워진다(ROADMAP §43).
   */
  readonly #locks = new Map<
    number,
    { all: boolean; pixels: boolean; position: boolean; transparentPixels: boolean }
  >();

  /**
   * 지금 편집 대상이 무엇인가. (`MASK_SELECT` · `MASK_INVERT`)
   *
   * **픽셀을 흉내내는 것이 아니라 계약을 흉내낸다.** `mask.invert` 는 대상을
   * 잠깐 옮겼다 **부르기 전 상태로 되돌리는데**, Mock 이 이것을 들고 있지
   * 않으면 그 계약이 테스트에 영영 나오지 않는다.
   */
  #editTarget: "mask" | "pixels" = "pixels";
  /** 저장된 알파 채널 이름. Mock 은 픽셀을 모르므로 이름만 기억한다. */
  readonly #channels = new Set<string>();
  #nextLayerId: number;
  readonly #history: {
    name: string;
    layers: LayerInfo[];
    activeLayerId: number | null;
    // 자르기는 레이어가 아니라 **문서**를 바꾼다. 이것을 담지 않으면 undo 가
    // 크기를 되돌리지 못하고, Mock 만 "자르기는 되돌릴 수 없다" 는 거짓을 말한다.
    document: DocumentInfo | null;
  }[] = [];

  /**
   * 되돌린 것들. (`HISTORY_REDO`)
   *
   * **새 편집을 하면 비운다.** Photoshop 이 되돌린 뒤 새로 편집하면 앞쪽
   * 가지를 버리는데, Mock 이 이것을 흉내내지 않으면 "되돌리고 편집한 뒤에도
   * redo 가 된다" 는 있을 수 없는 상태가 테스트에서 정상으로 보인다.
   */
  readonly #redo: {
    name: string;
    layers: LayerInfo[];
    activeLayerId: number | null;
    document: DocumentInfo | null;
  }[] = [];
  #hasSelection = false;
  #workspacePath: string | null;
  #documentPath: string | null;
  readonly #writtenFiles: string[] = [];
  readonly #files: MockFileSystem | null;

  /** 이 Bridge 가 처리한 Command 기록. 테스트에서 호출 경로를 검증할 때 사용한다. */
  readonly executedCommands: PhotoshopCommand[] = [];

  constructor(options: MockPhotoshopBridgeOptions = {}) {
    this.#connected = options.connected ?? true;
    // 기본값은 승인 전 상태다. 실제 UXP 도 사용자가 승인하기 전에는 저장할 수 없다.
    this.#workspacePath = options.workspacePath ?? null;
    this.#documentPath = options.documentPath ?? null;
    this.#files = options.files ?? null;
    this.#document =
      options.document === undefined ? { ...DEFAULT_MOCK_DOCUMENT } : options.document;
    this.#layers = [...(options.layers ?? DEFAULT_MOCK_LAYERS)];
    this.#activeLayerId = this.#layers[0]?.id ?? null;
    this.#nextLayerId = Math.max(0, ...this.#layers.map((layer) => layer.id)) + 1;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  /** 연결 상태를 바꾼다. 연결 끊김 오류를 재현할 때 사용한다. */
  setConnected(connected: boolean): void {
    this.#connected = connected;
  }

  /** 활성 문서를 바꾼다. `null` 을 주면 문서 없음 오류를 재현한다. */
  setDocument(document: DocumentInfo | null): void {
    this.#document = document;
  }

  /** 레이어 목록을 바꾼다. 활성 레이어는 첫 번째로 초기화된다. */
  setLayers(layers: readonly LayerInfo[]): void {
    this.#layers = [...layers];
    this.#activeLayerId = this.#layers[0]?.id ?? null;
    this.#nextLayerId = Math.max(0, ...this.#layers.map((layer) => layer.id)) + 1;
  }

  /** 활성 레이어를 바꾼다. */
  setActiveLayer(layerId: number | null): void {
    this.#activeLayerId = layerId;
  }

  /** 다음 호출 1회를 지정한 오류로 실패시킨다. Bridge 오류 전파 경로를 검증할 때 사용한다. */
  failNextWith(error: PhotoshopMcpError): void {
    this.#pendingFailure = error;
  }

  async executeCommand<TResult>(command: PhotoshopCommand): Promise<TResult> {
    this.executedCommands.push(command);
    this.#guard();

    switch (command.type) {
      case "PING":
        return { connected: this.#connected } as TResult;
      /* **Mock 은 "다 된다" 고 답하지 않는다.** 이 Tool 의 쓸모가 "이 Photoshop
       * 에서 무엇이 되는가" 인데, 가짜가 전부 true 를 주면 그것을 보고 짠
       * 워크플로가 실기에서 다르게 돈다. 픽셀을 모르므로 픽셀 계열은 false 다.
       *
       * `document.*` 는 문서가 없으면 null 이다 — 실기와 같은 규칙이다. */
      case "HOST_GET": {
        const open = this.#document === null ? 0 : 1;
        return {
          name: "Mock Photoshop",
          version: null,
          uxp: null,
          openDocuments: open,
          features: {
            imagingGetPixels: false,
            imagingGetLayerMask: false,
            saveOptionsDoNotSave: false,
            rasterizeEntireLayer: false,
            notifications: false,
            documentRotate: open === 0 ? null : false,
            documentHistogram: open === 0 ? null : false,
            selectionDom: open === 0 ? null : false,
            layerComps: open === 0 ? null : false,
            pathItems: open === 0 ? null : false,
          },
        } as TResult;
      }
      case "DOCUMENT_GET":
        return (await this.getDocumentInfo()) as TResult;
      /* **문서가 없으면 빈 배열이다. 던지지 않는다.** `DOCUMENT_GET` 과
       * 다른 점이고, Mock 이 여기서 던지면 그 차이가 테스트에 안 나온다. */
      /* **`bitDepth` 는 반영한다.** `documents.add` 가 그 키를 무시하는 것을
       * 실기에서 확인하고(ROADMAP §39) 실제 구현이 **만든 뒤 다시 걸도록**
       * 고쳤으므로, Mock 이 8 로 고정하면 현실과 어긋난다.
       *
       * `colorMode` 는 그대로 둔다 — `mode` 가 먹는지 실기에서 확인한 적이
       * 없다. 모르는 것을 Mock 이 정하면 그 거짓이 테스트에 사실로 굳는다. */
      case "DOCUMENT_CREATE": {
        this.#snapshot("Create document");
        const p = command.params as {
          width: number;
          height: number;
          name?: string;
          bitDepth?: number;
          mode?: string;
        };
        const created = {
          id: this.#nextLayerId++,
          name: p.name ?? "무제",
          width: p.width,
          height: p.height,
          bitDepth: p.bitDepth ?? 8,
          colorMode: "RGB",
        };
        return {
          document: created,
          applied: {
            width: true,
            height: true,
            ...(p.bitDepth === undefined ? {} : { bitDepth: p.bitDepth === created.bitDepth }),
            ...(p.mode === undefined ? {} : { colorMode: p.mode === created.colorMode }),
          },
        } as TResult;
      }
      case "DOCUMENT_LIST":
        return {
          documents:
            this.#document === null ? [] : [{ ...(await this.getDocumentInfo()), active: true }],
        } as TResult;
      /* **Mock 은 경계를 지어내지 않는다.** 픽셀을 모르므로 bounds 는 null 이고,
       * 그럴듯한 사각형을 주면 그것을 보고 "제자리에 놓였다" 고 판단한
       * 워크플로가 실기에서 다르게 돈다. 실기에서만 확인할 값이다. */
      case "LAYER_GET": {
        const index = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const shown = this.#layers[index] as LayerInfo;
        const lock = this.#locks.get(shown.id);
        return {
          layer: { ...shown },
          bounds: null,
          boundsNoEffects: null,
          /* 건 적이 있으면 그 값을, 없으면 null. Mock 이 지어내지 않는다. */
          locked:
            lock === undefined
              ? null
              : lock.all || lock.pixels || lock.position || lock.transparentPixels,
          allLocked: lock?.all ?? null,
          pixelsLocked: lock?.pixels ?? null,
          positionLocked: lock?.position ?? null,
          transparentPixelsLocked: lock?.transparentPixels ?? null,
          isClippingMask: null,
          // 쓴 적이 있으면 그 값을, 없으면 null. Mock 이 지어내지 않는다.
          fillOpacity: this.#fillOpacity.get((this.#layers[index] as LayerInfo).id) ?? null,
        } as TResult;
      }
      case "LAYER_LIST":
        return (await this.getLayers()) as TResult;
      // Mock 은 활성 레이어를 하나만 들고 있다. 실제 Photoshop 은 여러 개를 선택할 수
      // 있으므로 **배열로** 돌려준다 — Mock 이 단수로 주면 호출자가 단수라고 믿는다.
      case "LAYER_GET_ACTIVE":
        return this.#activeSelection() as TResult;

      /* **없는 id 가 하나라도 있으면 아무것도 선택하지 않는다.** 일부만
       * 선택된 채로 실패하면 호출자가 무엇이 선택됐는지 모른다. */
      /**
       * 레이어 잠금. (CORE_API §5 P2)
       *
       * **하나를 쓰면 나머지가 지워진다.** 실기에서 확인했다(ROADMAP §43) —
       * `pixels` 를 건 뒤 `position` 을 걸면 `pixels` 가 풀린다. 넷이 독립
       * 플래그라고 짐작했다가 반대로 틀렸고, Mock 이 그대로였으면 테스트가
       * 그 거짓을 굳혔다.
       */
      /**
       * 레이어 뒤집기. (CORE_API §5 P2)
       *
       * **Mock 은 경계를 지어내지 않는다.** 픽셀을 모르므로 `null` 이다 —
       * `LAYER_GET` 의 `bounds` 와 같은 규칙이다. 뒤집혔는지는 어차피 경계로
       * 알 수 없으므로 잃는 것도 없다.
       */
      case "LAYER_FLIP": {
        const p = command.params as {
          layerId?: number;
          axis: "horizontal" | "vertical" | "both";
        };
        const index = this.#requireLayerIndex(p.layerId);
        this.#snapshot("Flip layer");
        return {
          layer: { ...(this.#layers[index] as LayerInfo) },
          axis: p.axis,
          before: null,
          after: null,
        } as TResult;
      }
      case "LAYER_SET_LOCK": {
        const p = command.params as {
          layerId?: number;
          lock: "none" | "all" | "pixels" | "position" | "transparentPixels";
        };
        const index = this.#requireLayerIndex(p.layerId);
        const layer = this.#layers[index] as LayerInfo;
        this.#snapshot("Set layer lock");

        // 하나만 남긴다. `none` 은 전부 푼다.
        const next = {
          all: p.lock === "all",
          pixels: p.lock === "pixels",
          position: p.lock === "position",
          transparentPixels: p.lock === "transparentPixels",
        };
        this.#locks.set(layer.id, next);

        const locks = {
          any: next.all || next.pixels || next.position || next.transparentPixels,
          ...next,
        };
        return { layer: { ...layer }, locks, applied: true } as TResult;
      }
      case "LAYER_SELECT_MULTIPLE": {
        const ids = (command.params as { layerIds: number[] }).layerIds;
        const missing = ids.filter((id) => !this.#layers.some((entry) => entry.id === id));
        if (missing.length > 0) {
          throw new PhotoshopMcpError(
            ErrorCode.LAYER_NOT_FOUND,
            `레이어 ${missing.join(", ")} 를 찾을 수 없어 아무것도 선택하지 않았습니다.`,
            { recoverable: true, details: { missing } },
          );
        }
        this.#activeLayerId = ids[0] ?? null;
        this.#activeLayerIds = [...ids];
        return this.#activeSelection() as TResult;
      }

      // Phase 3 — 레이어 편집. 실제 Photoshop 과 같은 의미로 상태를 바꾼다.
      case "LAYER_CREATE":
        this.#snapshot("Create layer");
        return this.#create(command.params as { name?: string }) as TResult;
      case "LAYER_DUPLICATE":
        this.#snapshot("Duplicate layer");
        return this.#duplicate(command.params as { layerId?: number; name?: string }) as TResult;
      case "LAYER_RENAME":
        this.#snapshot("Rename layer");
        return this.#mutate(command.params as { layerId?: number }, (layer) => ({
          ...layer,
          name: (command.params as { name: string }).name,
        })) as TResult;
      case "LAYER_SELECT":
        this.#snapshot("Select layer");
        return this.#select(command.params as { layerId: number }) as TResult;
      case "LAYER_VISIBILITY":
        this.#snapshot("Set visibility");
        return this.#mutate(command.params as { layerId?: number }, (layer) => ({
          ...layer,
          visible: (command.params as { visible: boolean }).visible,
        })) as TResult;
      case "LAYER_OPACITY": {
        this.#snapshot("Set opacity");
        const opacity = (command.params as { opacity: number }).opacity;
        return this.#mutate(command.params as { layerId?: number }, (layer) => {
          // 배경 레이어는 반투명할 수 없다. Photoshop 은 거부하는 대신
          // **일반 레이어로 승격시키고 id 와 이름을 바꾼다.** 실기에서 확인했다.
          // Mock 이 이것을 흉내내지 않으면 승격 경로가 테스트에 안 나온다.
          if (layer.isBackground === true && opacity < 100) {
            const { isBackground: _dropped, ...rest } = layer;
            return { ...rest, id: this.#nextLayerId++, name: "레이어 0", opacity };
          }
          return { ...layer, opacity };
        }) as TResult;
      }

      /**
       * 칠 불투명도. (CORE_API §5 P1)
       *
       * **배경 레이어는 `opacity` 와 다르게 실패한다.** 실기에서 확인했다 —
       * 레이어가 둘 이상이면 아무 일도 안 일어나고, 배경이 유일하면 Photoshop 이
       * 일반 레이어로 **승격만** 시키고 값은 넣지 않는다. `set_opacity` 는 승격되면
       * 값도 들어갔다. Mock 이 이 차이를 흉내내지 않으면 "승격했는데 실패" 경로가
       * 테스트에 영영 나오지 않는다 — 배경 `set_opacity` 버그가 실기에서만 드러난
       * 이유가 그것이다.
       */
      case "LAYER_FILL_OPACITY": {
        this.#snapshot("Set fill opacity");
        const fillOpacity = (command.params as { fillOpacity: number }).fillOpacity;
        const index = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const target = this.#layers[index] as LayerInfo;

        if (target.isBackground === true) {
          const onlyLayer = this.#layers.length === 1;
          if (onlyLayer) {
            // 승격만 하고 값은 넣지 않는다. id 가 바뀐다.
            const { isBackground: _dropped, ...rest } = target;
            const promoted: LayerInfo = { ...rest, id: this.#nextLayerId++, name: "레이어 0" };
            this.#layers[index] = promoted;
            throw new PhotoshopMcpError(
              ErrorCode.COMMAND_FAILED,
              `칠 불투명도가 적용되지 않았습니다 — 요청 ${fillOpacity}, 실제 ${target.opacity}. ` +
                `배경 레이어라서 Photoshop 이 일반 레이어(id ${promoted.id})로 승격시켰지만 값은 넣지 않았습니다. ` +
                `**문서는 이미 바뀌었습니다.** 같은 요청을 layerId ${promoted.id} 로 다시 보내면 적용됩니다.`,
              {
                recoverable: true,
                details: { requested: fillOpacity, promoted: true, layer: { ...promoted } },
              },
            );
          }
          throw new PhotoshopMcpError(
            ErrorCode.COMMAND_FAILED,
            `칠 불투명도가 적용되지 않았습니다 — 요청 ${fillOpacity}, 실제 100. ` +
              "배경 레이어라서 Photoshop 이 거부했습니다. layer.from_background 로 일반 레이어로 바꾼 뒤 쓰세요.",
            {
              recoverable: true,
              details: { requested: fillOpacity, promoted: false, layer: { ...target } },
            },
          );
        }

        this.#fillOpacity.set(target.id, fillOpacity);
        return { layer: { ...target }, fillOpacity } as TResult;
      }

      // Phase 3 — 그룹
      case "GROUP_CREATE":
        this.#snapshot("Create group");
        return this.#groupCreate(
          command.params as { name?: string; layerIds?: number[]; parentId?: number | null },
        ) as TResult;
      /**
       * 열기. (ROADMAP §17.26)
       *
       * Mock 에는 파일 시스템이 없다. 그럴듯한 문서를 지어내면 Mock 으로 돌린
       * 워크플로가 존재하지 않는 파일을 열었다고 믿는다 — `measure.tilt` 가
       * 각도를 지어내지 않는 것과 같은 이유다.
       *
       * 형식 검사는 Command 스키마가 하므로 여기까지 온 것은 이미 통과한 것이다.
       */
      /**
       * 복제. (CORE_API §5 P2)
       *
       * **Mock 은 실패한다.** 문서를 하나만 들고 있어 진짜 복제본을 만들 수
       * 없는데, 그럴듯한 값을 돌려주면 **이 Command 가 막으려는 바로 그 사고**가
       * 난다 — 호출자가 원본을 복제본으로 알고 image.resize · flatten 처럼
       * 되돌릴 수 없는 작업을 건다.
       *
       * `DOCUMENT_OPEN` 과 같은 규칙이다. 할 수 없는 것을 한 척하지 않는다.
       */
      case "DOCUMENT_DUPLICATE":
        this.#requireDocument();
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_FAILED,
          "Mock Bridge 는 문서를 하나만 들고 있어 복제할 수 없습니다. " +
            "실제 Photoshop 연결이 필요합니다.",
          { recoverable: false },
        );
      case "DOCUMENT_OPEN": {
        const { filename } = command.params as { filename: string };
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_FAILED,
          "Mock Bridge 는 파일을 읽지 않아 문서를 열 수 없습니다. " +
            "실제 Photoshop 연결이 필요합니다.",
          { recoverable: false, details: { filename } },
        );
      }
      /**
       * 평탄화. (ROADMAP §17.25)
       *
       * **숨긴 레이어가 사라지는 것까지 흉내낸다.** 합쳐진다고 두면 그 손실이
       * 테스트에 나오지 않는데, 이 Command 에서 호출자가 가장 놀랄 일이 그것이다.
       */
      case "DOCUMENT_FLATTEN": {
        this.#requireDocument();
        if (this.#layers.length === 0) {
          throw new PhotoshopMcpError(ErrorCode.INVALID_PARAMETER, "합칠 레이어가 없습니다.", {
            recoverable: true,
          });
        }
        this.#snapshot("Flatten");
        const previousLayers = this.#layers.length;
        const hiddenDiscarded = this.#layers.filter((layer) => !layer.visible).length;
        const merged: LayerInfo = {
          id: this.#nextLayerId++,
          name: "배경",
          type: "pixel",
          visible: true,
          opacity: 100,
          parentId: null,
          blendMode: "normal",
          isBackground: true,
        };
        this.#layers = [merged];
        this.#activeLayerId = merged.id;
        return { layer: { ...merged }, previousLayers, hiddenDiscarded } as TResult;
      }
      /**
       * 닫기. (ROADMAP §17.25)
       *
       * Mock 은 문서를 하나만 다루므로 닫으면 남는 것이 없다. 실제 Photoshop 은
       * 여러 문서를 열 수 있고 그때는 `remainingDocuments` 가 0 이 아니다.
       */
      case "DOCUMENT_CLOSE": {
        const document = this.#requireDocument();
        const { discardChanges } = command.params as { discardChanges?: unknown };
        if (discardChanges !== true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "discardChanges 에 true 를 명시해야 합니다.",
            { recoverable: true },
          );
        }
        const closed = { id: document.id, name: document.name };
        this.#document = null;
        this.#layers = [];
        this.#activeLayerId = null;
        this.#hasSelection = false;
        return { closed, remainingDocuments: 0 } as TResult;
      }
      case "LAYER_REORDER":
        this.#snapshot("Reorder layer");
        return this.#layerReorder(
          command.params as {
            layerId: number;
            placement: "top" | "bottom" | "up" | "down" | "above" | "below";
            referenceId?: number;
          },
        ) as TResult;
      case "GROUP_MOVE_LAYER":
        this.#snapshot("Move layer");
        return this.#groupMoveLayer(
          command.params as { layerId: number; groupId: number | null },
        ) as TResult;

      // Phase 3 — History
      case "HISTORY_UNDO":
        return this.#undo() as TResult;
      case "HISTORY_REDO":
        return this.#redoOnce() as TResult;

      // Phase 4 — 조정 레이어
      case "ADJUSTMENT_CURVES":
        this.#snapshot("Curves");
        return this.#adjustment("Curves", "curves", command.params) as TResult;
      case "ADJUSTMENT_LEVELS":
        this.#snapshot("Levels");
        return this.#adjustment("Levels", "levels", command.params) as TResult;
      case "ADJUSTMENT_BRIGHTNESS_CONTRAST":
        this.#snapshot("Brightness/Contrast");
        return this.#adjustment(
          "Brightness/Contrast",
          "brightnessContrast",
          command.params,
        ) as TResult;

      // Phase 4 — 마스크 · 선택 영역
      case "MASK_CREATE":
        this.#snapshot("Create mask");
        return this.#setMask(command.params as { layerId?: number }, true, true) as TResult;
      case "MASK_ENABLE":
        this.#snapshot("Enable mask");
        return this.#setMask(command.params as { layerId?: number }, true) as TResult;
      /* 마스크를 픽셀에 굽는다. **마스크가 사라지는 것**이 요점이라 Mock 도
       * `hasMask` 를 내린다 — 그러지 않으면 "적용했는데 마스크가 남아 있다" 는
       * 잘못된 상태가 테스트에서 정상으로 보인다. */
      case "MASK_APPLY": {
        this.#snapshot("Apply mask");
        /* 있는 마스크만 구울 수 있다. `#setMask` 가 없을 때의 거절을 이미
         * 갖고 있으므로 그것으로 먼저 거른다. */
        this.#setMask(command.params as { layerId?: number }, true);
        const at = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const layer = this.#layers[at] as LayerInfo;
        /* **마스크가 사라지는 것**이 요점이라 Mock 도 `hasMask` 를 내린다 —
         * 그러지 않으면 "구웠는데 마스크가 남아 있다" 는 있을 수 없는 상태가
         * 테스트에서 정상으로 보인다. */
        const baked: LayerInfo = { ...layer, hasMask: false, maskEnabled: false };
        this.#layers[at] = baked;
        return { ...baked } as TResult;
      }
      /**
       * 편집 대상을 마스크와 픽셀 사이에서 옮긴다. (CORE_API §5 P1)
       *
       * **Mock 은 `activeChannels` 를 지어내지 않는다.** 실기에서 그 이름이
       * 무엇인지 확인하기 전에 그럴듯한 값을 주면, 그것을 보고 판단한
       * 워크플로가 실기에서 다르게 돈다 — `LAYER_GET` 의 `bounds` 와 같다.
       */
      case "MASK_SELECT": {
        this.#snapshot("Select channel");
        const target = (command.params as { target?: "mask" | "pixels" }).target ?? "mask";
        const index = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const layer = this.#layers[index] as LayerInfo;
        if (target === "mask" && layer.hasMask !== true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `레이어 ${layer.id} 에 마스크가 없습니다. photoshop.mask.create 로 먼저 만드세요.`,
            { recoverable: true, details: { layerId: layer.id } },
          );
        }
        /* **`verified: false` 다.** Mock 에는 물어볼 Photoshop 이 없다.
         * `true` 로 두면 "확인했다" 는 거짓이 테스트에 사실로 굳는다. */
        this.#editTarget = target;
        return { layer: { ...layer }, target, activeChannels: null, verified: false } as TResult;
      }
      /**
       * 마스크를 반전한다. (CORE_API §5 P1)
       *
       * 픽셀은 흉내내지 않는다. **편집 대상을 부르기 전 상태로 되돌린다는
       * 계약만** 흉내낸다 — 그것이 이 Command 의 숨은 부작용이다.
       */
      case "MASK_INVERT": {
        this.#snapshot("Invert mask");
        const index = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const layer = this.#layers[index] as LayerInfo;
        if (layer.hasMask !== true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `레이어 ${layer.id} 에 마스크가 없습니다. photoshop.mask.create 로 먼저 만드세요.`,
            { recoverable: true, details: { layerId: layer.id } },
          );
        }
        return { layer: { ...layer }, editTarget: this.#editTarget } as TResult;
      }
      case "MASK_DISABLE":
        this.#snapshot("Disable mask");
        return this.#setMask(command.params as { layerId?: number }, false) as TResult;
      // 하늘 선택. Mock 은 픽셀을 모르므로 "문서 전체" 를 고른 것으로 흉내낸다.
      // 실제로는 지평선을 따라 잘리며, 하늘이 없으면 선택이 비어 hasSelection 이 false 다.
      case "SELECTION_SKY":
        this.#snapshot("Select sky");
        this.#hasSelection = this.#document !== null;
        return this.#selectionState() as TResult;
      // 피사체 선택. (ROADMAP §17.28) Mock 은 픽셀을 모르므로 선택 유무만 흉내낸다.
      case "SELECTION_SUBJECT":
        this.#snapshot("Select subject");
        this.#hasSelection = this.#document !== null;
        return this.#selectionState() as TResult;
      // 워크플로 공백 보완. (ROADMAP §17.8)
      case "ADJUSTMENT_COLOR_BALANCE":
        this.#snapshot("Color Balance");
        return this.#adjustment("Color Balance", "colorBalance", command.params) as TResult;
      case "LAYER_FROM_BACKGROUND": {
        this.#snapshot("Layer from background");
        const index = this.#layers.findIndex((layer) => layer.isBackground === true);
        if (index < 0) {
          // 배경이 없으면 아무것도 하지 않는다. 오류가 아니다.
          return { ...(this.#layers[this.#requireLayerIndex()] as LayerInfo) } as TResult;
        }
        const { isBackground: _gone, ...rest } = this.#layers[index] as LayerInfo;
        const name = (command.params as { name?: string }).name;
        const promoted: LayerInfo = {
          ...rest,
          id: this.#nextLayerId++,
          name: name ?? "레이어 0",
        };
        this.#layers[index] = promoted;
        this.#activeLayerId = promoted.id;
        return { ...promoted } as TResult;
      }
      /**
       * 스마트 오브젝트 변환. (ROADMAP §17.27)
       *
       * **id 가 바뀌는 것까지 흉내낸다.** 그러지 않으면 "옛 id 로 이어서 작업" 이라는
       * 실패 경로가 테스트에 영원히 나오지 않는다 — 배경 승격에서 이미 겪은 일이다.
       * (ARCHITECTURE §8.4)
       *
       * 배경 레이어는 변환되면서 배경이 아니게 된다. `isBackground` 를 떼지 않으면
       * "배경인 스마트 오브젝트" 라는 존재하지 않는 상태가 만들어진다.
       */
      case "SMART_OBJECT_CONVERT": {
        const index = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const current = this.#layers[index] as LayerInfo;
        const previousId = current.id;
        // 이미 스마트 오브젝트면 아무것도 하지 않는다. History 도 남기지 않는다.
        if (current.type === "smartObject") {
          return { layer: { ...current }, converted: false, previousId } as TResult;
        }
        this.#snapshot("Convert to smart object");
        const { isBackground: _wasBackground, ...rest } = current;
        const wrapped: LayerInfo = {
          ...rest,
          id: this.#nextLayerId++,
          type: "smartObject",
        };
        this.#layers[index] = wrapped;
        this.#activeLayerId = wrapped.id;
        return { layer: { ...wrapped }, converted: true, previousId } as TResult;
      }
      case "FILTER_HIGH_PASS":
        this.#snapshot("High pass");
        return this.#gaussianBlur(command.params as { layerId?: number }) as TResult;
      case "FILTER_MINIMUM_MAXIMUM":
        this.#snapshot("Minimum/Maximum");
        return this.#gaussianBlur(command.params as { layerId?: number }) as TResult;
      // 선택 영역 조작. Mock 은 픽셀을 모르므로 유무와 채널 이름만 추적한다.
      // 그래도 "선택이 없으면 실패" 같은 경로는 실제와 같아야 한다.
      case "SELECTION_SAVE_CHANNEL": {
        if (!this.#hasSelection) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "선택을 채널로 저장 하려면 선택 영역이 있어야 합니다.",
            { recoverable: true },
          );
        }
        const name = (command.params as { name: string }).name;
        this.#channels.add(name);
        return { name } as TResult;
      }
      case "SELECTION_LOAD_CHANNEL": {
        const { name, mode } = command.params as { name: string; mode?: string };
        /* 교집합은 기존 선택을 요구한다. Mock 이 안 막으면 그 거절 경로가
         * 테스트에 영원히 안 나온다. */
        if (mode === "intersect" && !this.#hasSelection) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "교집합을 낼 선택 영역이 없습니다. mode 를 빼거나 선택을 먼저 만드세요.",
            { recoverable: true },
          );
        }
        if (!this.#channels.has(name)) {
          throw new PhotoshopMcpError(
            ErrorCode.COMMAND_FAILED,
            `채널 '${name}' 을 찾을 수 없습니다.`,
            { recoverable: true, details: { name } },
          );
        }
        this.#hasSelection = true;
        return this.#selectionState() as TResult;
      }
      case "SELECTION_MODIFY":
        if (!this.#hasSelection) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "선택을 다듬기 하려면 선택 영역이 있어야 합니다.",
            { recoverable: true },
          );
        }
        return this.#selectionState() as TResult;
      case "SELECTION_COLOR_RANGE":
        this.#snapshot("Color range");
        this.#hasSelection = this.#document !== null;
        return this.#selectionState() as TResult;
      /* 픽셀을 모르므로 "선택이 생겼다" 까지만 흉내낸다. 휘도 마스크의 값은
       * 실기에서만 확인할 수 있다 — Mock 이 그럴듯한 계조를 지어내면 그것을
       * 근거로 판단한 워크플로가 실기에서 다르게 돈다. */
      case "SELECTION_LUMINOSITY": {
        this.#snapshot("Load luminosity");
        /* **교집합은 기존 선택을 요구한다.** Mock 이 이것을 안 막으면 그 거절
         * 경로가 테스트에 영원히 안 나온다. */
        const mode = (command.params as { mode?: string }).mode;
        if (mode === "intersect" && !this.#hasSelection) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "교집합을 낼 선택 영역이 없습니다. mode 를 빼거나 선택을 먼저 만드세요.",
            { recoverable: true },
          );
        }
        this.#hasSelection = this.#document !== null;
        return this.#selectionState() as TResult;
      }
      case "LAYER_STAMP_VISIBLE": {
        this.#snapshot("Stamp visible");
        const name = (command.params as { name?: string }).name;
        const merged: LayerInfo = {
          id: this.#nextLayerId++,
          name: name ?? "병합본",
          type: "pixel",
          visible: true,
          opacity: 100,
          parentId: null,
          blendMode: "normal",
        };
        this.#layers.unshift(merged);
        this.#activeLayerId = merged.id;
        return { ...merged } as TResult;
      }
      // 마스크 그라디언트. Mock 은 픽셀을 모르지만 "마스크가 있어야 한다" 는
      // 전제는 실제와 같아야 한다 — 없으면 Photoshop 이 거부한다.
      case "MASK_GRADIENT": {
        this.#snapshot("Mask gradient");
        const index = this.#requireLayerIndex((command.params as { layerId?: number }).layerId);
        const layer = this.#layers[index] as LayerInfo;
        if (layer.hasMask !== true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "이 레이어에 마스크가 없습니다. mask.create 로 먼저 만드세요.",
            { recoverable: true, details: { layerId: layer.id } },
          );
        }
        return { ...layer } as TResult;
      }
      // 캡처. Mock 은 픽셀이 없으므로 **1×1 투명 PNG** 를 돌려준다.
      // 그림 내용을 흉내내지는 않지만, 응답 모양과 "선택이 없으면 실패" 같은
      // 경로는 실제와 같아야 한다.
      // 레이어 삭제. 실기와 같은 거절 규칙 · 같은 확인 방식을 흉내 낸다.
      //
      // 특히 "전부 지우기 거절" 과 "지운 뒤 목록을 다시 읽어 확인" 을 빠뜨리면
      // 안 된다. Mock 이 너그러우면 그 경로는 테스트에 영영 나오지 않는다.
      case "LAYER_DELETE": {
        this.#requireDocument();
        const { layerIds } = command.params as { layerIds: number[] };
        const requested = [...new Set(layerIds)];
        const before = this.#layers.map((entry) => entry.id);
        if (before.length > 0 && before.every((id) => requested.includes(id))) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `레이어 ${before.length}개를 전부 지울 수는 없습니다. ` +
              "Photoshop 문서에는 레이어가 최소 하나 있어야 합니다.",
            { recoverable: true },
          );
        }
        this.#snapshot("Delete layers");
        const failed: { id: number; reason: string }[] = [];
        for (const id of requested) {
          if (!before.includes(id)) {
            failed.push({ id, reason: "레이어를 찾을 수 없습니다." });
          }
        }
        this.#layers = this.#layers.filter((entry) => !requested.includes(entry.id));
        if (!this.#layers.some((entry) => entry.id === this.#activeLayerId)) {
          this.#activeLayerId = this.#layers[this.#layers.length - 1]?.id ?? null;
        }
        const remainingIds = this.#layers.map((entry) => entry.id);
        return {
          deleted: requested.filter((id) => !remainingIds.includes(id) && before.includes(id)),
          failed,
          remaining: remainingIds.length,
        } as TResult;
      }

      // Camera Raw. 실제 픽셀이 없으므로 **거절 규칙과 반환 모양만** 흉내 낸다.
      //
      // 특히 숨긴 레이어 거절을 빠뜨리면 안 된다 — 실기에서 Photoshop 이 이유를
      // 말해 주지 않아 한참 헤맨 자리다. Mock 이 너그러우면 그 경로는 테스트에
      // 영영 나오지 않는다.
      case "CAMERA_RAW_APPLY": {
        this.#requireDocument();
        const params = command.params as { layerId?: number } & Record<string, unknown>;
        const layer =
          params.layerId === undefined
            ? this.#layers.find((entry) => entry.id === this.#activeLayerId)
            : this.#layers.find((entry) => entry.id === params.layerId);
        if (layer === undefined) {
          throw new PhotoshopMcpError(
            ErrorCode.LAYER_NOT_FOUND,
            params.layerId === undefined
              ? "활성 레이어가 없습니다."
              : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
            { recoverable: true },
          );
        }
        if (layer.type === "adjustment" || layer.type === "group") {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `${layer.type === "group" ? "그룹" : "조정 레이어"}에는 Camera Raw 를 걸 수 없습니다. ` +
              "픽셀 레이어를 layerId 로 지정하세요.",
            { recoverable: true },
          );
        }
        if (!layer.visible) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "숨긴 레이어에는 Camera Raw 를 걸 수 없습니다. " +
              "photoshop.layer.set_visibility 로 보이게 한 뒤 다시 시도하세요.",
            { recoverable: true },
          );
        }
        this.#snapshot("Camera Raw Filter");
        const applied = Object.keys(params).filter((key) => key !== "layerId");
        return { layer: { ...layer }, applied } as TResult;
      }

      // 결함 제거. 실제 픽셀이 없으므로 **거절 규칙만** 실기와 같게 흉내 낸다.
      //
      // 특히 배경 거절을 빠뜨리면 안 된다 — 이 Command 의 가장 중요한 성질이고,
      // Mock 이 너그러우면 그 경로는 테스트에 영영 나오지 않는다.
      /**
       * 닷징 · 버닝. (ROADMAP §17.31)
       *
       * Mock 은 픽셀을 모르므로 **무엇을 거절하는가**만 흉내낸다. 이 Command 에서
       * 위험한 자리가 거기다 — 배경이나 조정 레이어에 칠하면 되돌릴 수 없다.
       */
      /**
       * 색 칠하기 · 마스크 칠하기. (ROADMAP §17.32)
       *
       * Mock 은 픽셀을 모르므로 **무엇을 거절하는가**만 흉내낸다.
       * `PAINT_DAB` 은 배경·비픽셀을 막고, `MASK_DAB` 은 마스크가 없으면 막는다 —
       * 그것이 이 둘에서 위험하거나 헷갈리는 자리다.
       */
      case "PAINT_DAB":
      case "MASK_DAB": {
        const document = this.#requireDocument();
        const params = command.params as {
          dabs: { x: number; y: number; radius: number }[];
          layerId?: number;
        };
        const layer =
          params.layerId === undefined
            ? this.#layers.find((entry) => entry.id === this.#activeLayerId)
            : this.#layers.find((entry) => entry.id === params.layerId);
        if (layer === undefined) {
          throw new PhotoshopMcpError(
            ErrorCode.LAYER_NOT_FOUND,
            params.layerId === undefined
              ? "활성 레이어가 없습니다."
              : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
            { recoverable: true },
          );
        }
        if (command.type === "PAINT_DAB") {
          if (layer.type !== "pixel") {
            throw new PhotoshopMcpError(
              ErrorCode.INVALID_PARAMETER,
              `${layer.type} 레이어에는 칠할 수 없습니다. ` +
                "photoshop.layer.create 로 빈 픽셀 레이어를 만들고 그것을 지정하세요. " +
                "마스크에 칠하려면 photoshop.mask.dab 을 쓰세요.",
              { recoverable: true },
            );
          }
          if (layer.isBackground === true) {
            throw new PhotoshopMcpError(
              ErrorCode.INVALID_PARAMETER,
              "배경 레이어에는 칠하지 않습니다 — 원본 픽셀이 사라집니다. " +
                "photoshop.layer.create 로 빈 레이어를 만들고 거기에 칠하세요.",
              { recoverable: true },
            );
          }
        } else if (layer.hasMask !== true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "이 레이어에 마스크가 없습니다. mask.create 로 먼저 만드세요. " +
              "layer.list 의 hasMask 로 확인할 수 있습니다.",
            { recoverable: true },
          );
        }
        for (const dab of params.dabs) {
          if (
            dab.x + dab.radius <= 0 ||
            dab.y + dab.radius <= 0 ||
            dab.x - dab.radius >= document.width ||
            dab.y - dab.radius >= document.height
          ) {
            throw new PhotoshopMcpError(
              ErrorCode.INVALID_PARAMETER,
              `얼룩 (${dab.x}, ${dab.y}) 반지름 ${dab.radius} 가 ` +
                `문서(${document.width}×${document.height}) 밖입니다.`,
              { recoverable: true },
            );
          }
        }
        this.#snapshot(command.type === "PAINT_DAB" ? "Paint" : "Mask dab");
        this.#hasSelection = false;
        return { layer: { ...layer }, applied: params.dabs.length } as TResult;
      }
      /**
       * 텍스트 레이어. (ROADMAP §17.33)
       *
       * Mock 은 폰트를 모르므로 목록은 비어 있고, `text.set` 이 **텍스트가 아닌
       * 레이어를 거절하는 것**만 흉내낸다 — 그것이 이 Command 에서 헷갈리는 자리다.
       */
      /**
       * 액션 조회. (ROADMAP §17.34)
       *
       * **Mock 은 액션을 지어내지 않는다.** 지어내면 Mock 으로 돌린 워크플로가
       * 존재하지 않는 액션을 선언하고 그것이 성공으로 보인다.
       * (`measure.tilt` · `font.list` 와 같은 규칙)
       */
      case "ACTION_LIST": {
        const { set } = command.params as { set?: string };
        if (set !== undefined) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `'${set}' 이라는 액션 세트가 없습니다. ` +
              "set 없이 photoshop.action.list 를 부르면 세트 이름을 볼 수 있습니다.",
            { recoverable: true },
          );
        }
        return { sets: [], totalSets: 0 } as TResult;
      }
      /**
       * 액션 허용 목록·실행. (ROADMAP §17.36)
       *
       * **Mock 에는 고른 것이 없다.** 허용 목록은 사용자가 Photoshop 패널에서
       * 정하고 플러그인이 보관한다. 지어내면 Mock 으로 돌린 워크플로가
       * 존재하지 않는 액션을 부르고 그것이 성공으로 보인다.
       */
      case "ACTION_ALLOWLIST":
        return { actions: [], total: 0, persisted: false } as TResult;
      /**
       * 등록된 Extension 도 같은 이유로 **비어 있다.** (ROADMAP §18.3)
       *
       * 기본은 "아무 패널도 안 깔려 있다" 다. 지어내면 Mock 으로 돌린 서버가
       * 존재하지 않는 경로를 적재하려 한다.
       */
      case "EXTENSION_REGISTRY":
        return { extensions: [], total: 0, persisted: false } as TResult;
      case "ACTION_PLAY": {
        const { set, action } = command.params as { set: string; action: string };
        throw new PhotoshopMcpError(
          ErrorCode.INVALID_PARAMETER,
          "실행이 허용된 액션이 없습니다. Photoshop MCP 패널의 '액션 선택…' 버튼으로 " +
            "사용할 액션을 골라야 부를 수 있습니다.",
          { recoverable: true, details: { set, action, allowed: [] } },
        );
      }
      case "TEXT_CREATE": {
        this.#requireDocument();
        const params = command.params as {
          contents: string;
          name?: string;
          font?: string;
          size?: number;
          color?: unknown;
          opacity?: number;
          alignment?: string;
        };
        this.#snapshot("Create text");
        const created: LayerInfo = {
          id: this.#nextLayerId++,
          name: params.name ?? params.contents,
          type: "text",
          visible: true,
          opacity: params.opacity ?? 100,
          parentId: null,
          blendMode: "normal",
          isBackground: false,
        };
        this.#layers.unshift(created);
        this.#activeLayerId = created.id;
        const applied = (["font", "size", "color", "alignment", "opacity"] as const).filter(
          (key) => params[key] !== undefined,
        );
        return { layer: { ...created }, applied } as TResult;
      }
      case "TEXT_SET": {
        this.#requireDocument();
        const params = command.params as {
          layerId?: number;
          contents?: string;
          opacity?: number;
          [key: string]: unknown;
        };
        const index = this.#requireLayerIndex(params.layerId);
        const layer = this.#layers[index] as LayerInfo;
        if (layer.type !== "text") {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `${layer.type} 레이어는 텍스트가 아닙니다. photoshop.layer.list 의 type 으로 확인하세요.`,
            { recoverable: true },
          );
        }
        this.#snapshot("Set text");
        const updated: LayerInfo = {
          ...layer,
          ...(params.contents === undefined ? {} : { name: params.contents }),
          ...(params.opacity === undefined ? {} : { opacity: params.opacity }),
        };
        this.#layers[index] = updated;
        const applied = ["contents", "font", "size", "color", "alignment", "opacity"].filter(
          (key) => params[key] !== undefined,
        );
        return { layer: { ...updated }, applied } as TResult;
      }
      case "FONT_LIST":
        // Mock 에는 폰트가 없다. 지어내면 Mock 으로 돌린 워크플로가 없는 폰트를
        // 지정하고 그것이 성공으로 보인다. (`measure.tilt` 와 같은 규칙)
        return { fonts: [], total: 0 } as TResult;
      case "DODGE_BURN_DAB": {
        const document = this.#requireDocument();
        const params = command.params as {
          dabs: { x: number; y: number; radius: number }[];
          mode: "dodge" | "burn";
          layerId?: number;
        };
        const layer =
          params.layerId === undefined
            ? this.#layers.find((entry) => entry.id === this.#activeLayerId)
            : this.#layers.find((entry) => entry.id === params.layerId);
        if (layer === undefined) {
          throw new PhotoshopMcpError(
            ErrorCode.LAYER_NOT_FOUND,
            params.layerId === undefined
              ? "활성 레이어가 없습니다."
              : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
            { recoverable: true },
          );
        }
        if (layer.type !== "pixel") {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `${layer.type} 레이어에는 칠할 수 없습니다. ` +
              "photoshop.layer.create 로 빈 픽셀 레이어를 만들고 " +
              "photoshop.layer.set_blend_mode 로 softLight 를 건 뒤 그 레이어를 지정하세요.",
            { recoverable: true },
          );
        }
        if (layer.isBackground === true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "배경 레이어에는 닷징·버닝을 걸지 않습니다 — 원본 픽셀이 바뀝니다. " +
              "photoshop.layer.create 로 빈 레이어를 만들고 softLight 를 건 뒤 거기에 칠하세요.",
            { recoverable: true },
          );
        }
        for (const dab of params.dabs) {
          if (
            dab.x + dab.radius <= 0 ||
            dab.y + dab.radius <= 0 ||
            dab.x - dab.radius >= document.width ||
            dab.y - dab.radius >= document.height
          ) {
            throw new PhotoshopMcpError(
              ErrorCode.INVALID_PARAMETER,
              `얼룩 (${dab.x}, ${dab.y}) 반지름 ${dab.radius} 가 ` +
                `문서(${document.width}×${document.height}) 밖입니다.`,
              { recoverable: true },
            );
          }
        }
        this.#snapshot("Dodge and burn");
        // 실기는 선택을 남기지 않는다.
        this.#hasSelection = false;
        return { layer: { ...layer }, applied: params.dabs.length } as TResult;
      }
      case "RETOUCH_REMOVE_SPOTS": {
        const document = this.#requireDocument();
        const params = command.params as {
          spots: { x: number; y: number; radius: number }[];
          layerId?: number;
        };
        const layer =
          params.layerId === undefined
            ? this.#layers.find((entry) => entry.id === this.#activeLayerId)
            : this.#layers.find((entry) => entry.id === params.layerId);
        if (layer === undefined) {
          throw new PhotoshopMcpError(
            ErrorCode.LAYER_NOT_FOUND,
            params.layerId === undefined
              ? "활성 레이어가 없습니다."
              : `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
            { recoverable: true },
          );
        }
        if (layer.type === "adjustment" || layer.type === "group") {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `${layer.type === "group" ? "그룹" : "조정 레이어"}에는 지울 픽셀이 없습니다. ` +
              "픽셀 레이어를 layerId 로 지정하세요.",
            { recoverable: true },
          );
        }
        if (layer.isBackground === true) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "배경 레이어에는 결함 제거를 적용하지 않습니다 — 원본이 사라집니다. " +
              "photoshop.layer.duplicate 로 복제한 뒤 그 레이어를 layerId 로 지정하세요.",
            { recoverable: true },
          );
        }
        for (const spot of params.spots) {
          if (
            spot.x + spot.radius <= 0 ||
            spot.y + spot.radius <= 0 ||
            spot.x - spot.radius >= document.width ||
            spot.y - spot.radius >= document.height
          ) {
            throw new PhotoshopMcpError(
              ErrorCode.INVALID_PARAMETER,
              `지점 (${spot.x}, ${spot.y}) 반지름 ${spot.radius} 가 ` +
                `문서(${document.width}×${document.height}) 밖입니다.`,
              { recoverable: true },
            );
          }
        }
        this.#snapshot("Remove spots");
        // 실기는 선택을 남기지 않는다.
        this.#hasSelection = false;
        return { layer: { ...layer }, removed: params.spots.length } as TResult;
      }

      // 통계. 실제 픽셀이 없으므로 **모양과 규칙만** 흉내 낸다.
      //
      // 값을 지어내지 않는다 — 전부 중간 회색 한 장이라고 두고 그 값에서
      // 일관되게 계산한다. 실기의 거절 규칙(선택 없음 · 조정 레이어)은 그대로
      // 흉내 낸다. Mock 이 더 너그러우면 그 오류 경로는 테스트에 나오지 않는다.
      /**
       * 기울기 측정. (ROADMAP §17.21)
       *
       * Mock 은 픽셀을 모르므로 **경계를 찾지 못한 것으로** 답한다. 그럴듯한
       * 각도를 지어내면 Mock 으로 돌린 워크플로가 엉뚱한 회전을 하고, 그것이
       * 성공으로 보인다. 잴 수 없으면 잴 수 없다고 말하는 편이 정직하다.
       */
      case "MEASURE_TILT": {
        const document = this.#requireDocument();
        const { bounds } = command.params as {
          bounds: { left: number; top: number; right: number; bottom: number };
        };
        if (bounds.right > document.width || bounds.bottom > document.height) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `잴 영역이 문서(${document.width}×${document.height})를 벗어납니다.`,
            { recoverable: true },
          );
        }
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_FAILED,
          "Mock Bridge 는 픽셀을 읽지 않아 기울기를 잴 수 없습니다. " +
            "실제 Photoshop 연결이 필요합니다.",
          { recoverable: false, details: { bounds } },
        );
      }
      case "DOCUMENT_STATISTICS": {
        const document = this.#requireDocument();
        const params = command.params as { region?: string; layerId?: number; target?: string };
        let source = "document";
        let pixels = document.width * document.height;

        if (params.layerId !== undefined) {
          const layer = this.#layers.find((entry) => entry.id === params.layerId);
          if (layer === undefined) {
            throw new PhotoshopMcpError(
              ErrorCode.LAYER_NOT_FOUND,
              `레이어 ${params.layerId} 를 찾을 수 없습니다.`,
              { recoverable: true },
            );
          }
          /* **마스크를 잴 때는 조정 레이어를 막지 않는다.** 픽셀이 없어 막아
           * 둔 것인데 마스크는 있다. Mock 이 실기와 다르면 그 경로가 테스트에
           * 영원히 안 나온다. */
          if (params.target === "mask") {
            if (layer.hasMask !== true) {
              throw new PhotoshopMcpError(
                ErrorCode.INVALID_PARAMETER,
                `레이어 ${layer.id} 에 마스크가 없습니다.`,
                { recoverable: true },
              );
            }
            source = `mask:${layer.id}`;
          } else {
            if (layer.type === "adjustment" || layer.type === "group") {
              throw new PhotoshopMcpError(
                ErrorCode.INVALID_PARAMETER,
                `${layer.type === "group" ? "그룹" : "조정 레이어"}에는 잴 픽셀이 없습니다. ` +
                  "layerId 를 빼면 조정이 반영된 합성 결과를 잽니다.",
                { recoverable: true },
              );
            }
            source = `layer:${layer.id}`;
          }
        }

        if (params.region === "selection") {
          if (!this.#hasSelection) {
            throw new PhotoshopMcpError(ErrorCode.INVALID_PARAMETER, "잴 선택 영역이 없습니다.", {
              recoverable: true,
            });
          }
          source = "selection:0,0,100,100";
          pixels = 100 * 100;
        }

        const flat = {
          // Mock 은 평평한 회색 한 장이므로 이웃 차가 전부 0 이다. 노이즈도 0 이
          // 맞다 — 그럴듯한 값을 지어내면 테스트가 거짓을 고정한다.
          noise: 0,
          mean: 128,
          p1: 128,
          p5: 128,
          p50: 128,
          p95: 128,
          p99: 128,
          clippedHigh: 0,
          clippedLow: 0,
        };
        const histogram = new Array<number>(64).fill(0);
        histogram[32] = 100;
        return {
          source,
          pixels,
          bitDepth: 8,
          channels: { red: flat, green: flat, blue: flat, luminance: flat },
          histogram,
          method: "mock",
          elapsedMs: 0,
        } as TResult;
      }

      // 자르기. **픽셀을 버리지 않으므로** 크기만 바꾼다.
      //
      // 범위 검사를 실기와 같게 한다 — Mock 이 더 너그러우면 그 오류 경로는
      // 테스트에 영영 나오지 않는다.
      /**
       * 이미지 크기. (CORE_API §5 P1)
       *
       * **한쪽만 주면 비율을 유지한다.** 실기의 `resizeImage` 가 그렇게
       * 동작하는지 확인한 뒤 맞췄다(ROADMAP §33). Mock 이 다르면 "한쪽만
       * 줘도 된다" 는 계약이 테스트에 영영 나오지 않는다.
       *
       * Mock 에는 해상도가 없다. `resolution` 은 받아 두기만 하고 문서에
       * 담지 않으며, `applied.resolution` 을 참이라고 말하지 않는다 —
       * 확인한 것이 없는데 확인했다고 하는 것이 가장 나쁘다.
       */
      /**
       * 캔버스 크기. (CORE_API §5 P2)
       *
       * **생략한 쪽은 지금 값 그대로다.** `IMAGE_RESIZE` 가 비율을 맞추는 것과
       * 다르고, Mock 이 그 차이를 갖지 않으면 두 Tool 을 바꿔 써도 테스트가
       * 통과한다.
       *
       * Mock 에는 픽셀이 없으므로 무엇이 잘렸는지는 흉내내지 않는다.
       */
      /**
       * 재단. (CORE_API §5)
       *
       * **Mock 은 실패한다.** 무엇을 여백으로 볼지는 **픽셀을 봐야** 정해지는데
       * Mock 에는 픽셀이 없다. 그럴듯한 크기를 돌려주면 그것을 보고 짠 워크플로가
       * 실기에서 다르게 돈다 — `MEASURE_TILT` 가 각도를 지어내지 않는 것과 같다.
       */
      /**
       * 색상 모드. (CORE_API §5 P2)
       *
       * 모드는 문서 메타라 Mock 도 들고 있을 수 있다. **이미 그 모드면 아무것도
       * 하지 않는 것**까지 흉내낸다 — 그러지 않으면 "같은 모드로 다시 걸면
       * 평탄화만 된다" 를 막아 둔 것이 테스트에 안 나온다.
       *
       * 픽셀은 없으므로 색이 어떻게 변하는지는 흉내내지 않는다.
       */
      /**
       * 비트 심도. (CORE_API §5 P2)
       *
       * 심도는 문서 메타라 Mock 도 들고 있을 수 있다. **이미 그 심도면 아무것도
       * 하지 않는 것**까지 흉내낸다. 계조가 어떻게 버려지는지는 픽셀이 없어
       * 흉내내지 않는다.
       */
      /**
       * 보이는 레이어 병합. (CORE_API §5)
       *
       * **숨긴 레이어가 남는 것**이 요점이라 Mock 도 그것을 지킨다 —
       * `DOCUMENT_FLATTEN` 이 숨긴 것을 버리는 것과 갈리는 자리이고, Mock 이
       * 둘을 같게 만들면 그 차이가 테스트에 안 나온다.
       */
      /**
       * 붙여 넣기. (CORE_API §5)
       *
       * **Mock 은 실패한다.** 클립보드가 없다. 그럴듯한 레이어를 만들어 주면
       * Mock 으로 돌린 워크플로가 **오지 않은 내용이 들어왔다고 믿는다** —
       * `DOCUMENT_OPEN` · `DOCUMENT_DUPLICATE` 와 같은 규칙이다.
       */
      case "DOCUMENT_PASTE":
        this.#requireDocument();
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_FAILED,
          "Mock Bridge 에는 클립보드가 없어 붙여 넣을 수 없습니다. " +
            "실제 Photoshop 연결이 필요합니다.",
          { recoverable: false },
        );
      case "DOCUMENT_MERGE_VISIBLE": {
        this.#requireDocument();
        /* **활성 레이어가 숨겨져 있으면 실제 Photoshop 은 조용히 아무 일도
         * 안 한다**(ROADMAP §40). Mock 이 그냥 합치면 그 함정이 테스트에
         * 영영 나오지 않는다. */
        const activeNow = this.#layers.find((layer) => layer.id === this.#activeLayerId);
        if (activeNow !== undefined && !activeNow.visible) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `활성 레이어 "${activeNow.name}" 가 숨겨져 있어 병합이 일어나지 않습니다. ` +
              "photoshop.layer.select 로 보이는 레이어를 먼저 고르세요.",
            { recoverable: true, details: { activeLayerId: activeNow.id } },
          );
        }
        const visible = this.#layers.filter((layer) => layer.visible);
        const before = {
          total: this.#layers.length,
          visible: visible.length,
          hidden: this.#layers.length - visible.length,
        };
        if (before.visible < 2) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `보이는 레이어가 ${before.visible}장이라 합칠 것이 없습니다. ` +
              "photoshop.layer.list 로 무엇이 보이는지 확인하세요.",
            { recoverable: true, details: { before } },
          );
        }
        this.#snapshot("Merge visible");
        /* **남는 것은 선택한 레이어다.** 실기에서 확인했고(ROADMAP §40) Adobe
         * 레퍼런스도 "the top of the selected layers or the top layer" 라고
         * 적는다. 다만 **배경이 있으면 배경이 남는다** — 레퍼런스의 "will not
         * convert the remaining layer to Background if no Background already
         * exists" 가 뒤집어 말하는 것이다.
         *
         * 처음에 "가장 아래 보이는 레이어" 로 짐작해 두었는데 틀렸다. 배경이
         * 있는 문서에서 우연히 맞아떨어져 드러나지 않았다. */
        const background = visible.find((layer) => layer.isBackground === true);
        const merged: LayerInfo = {
          ...((background ??
            visible.find((layer) => layer.id === this.#activeLayerId) ??
            visible[0]) as LayerInfo),
        };
        const kept = this.#layers.filter((layer) => !layer.visible);
        const mergedIndex = this.#layers.findIndex((layer) => layer.id === merged.id);
        const above = kept.filter((layer) => this.#layers.indexOf(layer) < mergedIndex);
        const below = kept.filter((layer) => this.#layers.indexOf(layer) > mergedIndex);
        this.#layers = [...above, merged, ...below];
        this.#activeLayerId = merged.id;
        const after = {
          total: this.#layers.length,
          visible: 1,
          hidden: this.#layers.length - 1,
        };
        return {
          activeLayer: { ...merged },
          before,
          after,
          removed: before.total - after.total,
        } as TResult;
      }
      case "DOCUMENT_BIT_DEPTH_CONVERT": {
        const document = this.#requireDocument();
        const depth = (command.params as { depth: number }).depth;
        const before = document.bitDepth;
        if (before === depth) {
          return {
            document: { ...(await this.getDocumentInfo()) },
            before,
            after: before,
            applied: true,
          } as TResult;
        }
        this.#snapshot("Change bit depth");
        this.#document = { ...document, bitDepth: depth };
        return {
          document: { ...(await this.getDocumentInfo()) },
          before,
          after: depth,
          applied: true,
        } as TResult;
      }
      case "DOCUMENT_MODE_CONVERT": {
        const document = this.#requireDocument();
        const label = { rgb: "RGB", grayscale: "Grayscale", cmyk: "CMYK", lab: "Lab" }[
          (command.params as { mode: "rgb" | "grayscale" | "cmyk" | "lab" }).mode
        ];
        const before = { mode: document.colorMode, layers: this.#layers.length };
        if (before.mode === label) {
          return {
            document: { ...(await this.getDocumentInfo()) },
            before,
            after: { ...before },
            applied: true,
            layersDiscarded: 0,
          } as TResult;
        }
        this.#snapshot("Change mode");
        this.#document = { ...document, colorMode: label };
        const after = { mode: label, layers: this.#layers.length };
        return {
          document: { ...(await this.getDocumentInfo()) },
          before,
          after,
          applied: true,
          layersDiscarded: Math.max(0, before.layers - after.layers),
        } as TResult;
      }
      case "DOCUMENT_TRIM":
        this.#requireDocument();
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_FAILED,
          "Mock Bridge 는 픽셀을 모르므로 여백을 판별할 수 없습니다. " +
            "실제 Photoshop 연결이 필요합니다.",
          { recoverable: false },
        );
      case "CANVAS_RESIZE": {
        const document = this.#requireDocument();
        const params = command.params as {
          width?: number;
          height?: number;
          anchor?: string;
        };
        this.#snapshot("Resize canvas");
        const before = { width: document.width, height: document.height };
        const width = params.width ?? before.width;
        const height = params.height ?? before.height;

        this.#document = { ...document, width, height };
        return {
          document: { ...(await this.getDocumentInfo()) },
          before,
          after: { width, height },
          applied: {
            ...(params.width === undefined ? {} : { width: width === params.width }),
            ...(params.height === undefined ? {} : { height: height === params.height }),
          },
          anchor: params.anchor ?? null,
        } as TResult;
      }
      case "IMAGE_RESIZE": {
        const document = this.#requireDocument();
        const params = command.params as {
          width?: number;
          height?: number;
          resolution?: number;
        };
        this.#snapshot("Resize image");
        const before = { width: document.width, height: document.height, resolution: null };

        const ratio = document.height === 0 ? 1 : document.width / document.height;
        const width =
          params.width ??
          (params.height === undefined ? document.width : Math.round(params.height * ratio));
        const height =
          params.height ??
          (params.width === undefined ? document.height : Math.round(params.width / ratio));

        this.#document = { ...document, width, height };
        const after = { width, height, resolution: null };
        return {
          document: { ...(await this.getDocumentInfo()) },
          before,
          after,
          applied: {
            ...(params.width === undefined ? {} : { width: after.width === params.width }),
            ...(params.height === undefined ? {} : { height: after.height === params.height }),
            ...(params.resolution === undefined ? {} : { resolution: false }),
          },
        } as TResult;
      }
      case "DOCUMENT_CROP": {
        const document = this.#requireDocument();
        const { bounds } = command.params as {
          bounds: { left: number; top: number; right: number; bottom: number };
        };
        if (bounds.right > document.width || bounds.bottom > document.height) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            `자를 영역이 문서(${document.width}×${document.height})를 벗어납니다: ` +
              `right ${bounds.right}, bottom ${bounds.bottom}.`,
            { recoverable: true },
          );
        }
        this.#snapshot("Crop");
        const previousWidth = document.width;
        const previousHeight = document.height;
        this.#document = {
          ...document,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
        };

        /* **배경은 캔버스 밖에 픽셀을 가질 수 없어 승격된다.** 실기에서 id 1 이
         * id 3 이 되었다(ROADMAP §36). Mock 이 흉내내지 않으면 "id 가 바뀐다"
         * 는 계약이 테스트에 영영 나오지 않는다 — 배경 `set_opacity` 승격을
         * 흉내내는 것과 같은 이유다. */
        const bgIndex = this.#layers.findIndex((layer) => layer.isBackground === true);
        let promoted: { previousId: number; layer: LayerInfo } | null = null;
        if (bgIndex >= 0) {
          const background = this.#layers[bgIndex] as LayerInfo;
          const { isBackground: _dropped, ...rest } = background;
          const replacement: LayerInfo = {
            ...rest,
            id: this.#nextLayerId++,
            name: "레이어 0",
          };
          this.#layers[bgIndex] = replacement;
          if (this.#activeLayerId === background.id) {
            this.#activeLayerId = replacement.id;
          }
          promoted = { previousId: background.id, layer: { ...replacement } };
        }
        return {
          width: this.#document.width,
          height: this.#document.height,
          previousWidth,
          previousHeight,
          promoted,
          pixelsRetained: true,
        } as TResult;
      }
      /**
       * 회전. **캔버스가 커지는 것까지 흉내낸다.**
       *
       * Mock 이 크기를 그대로 두면 플러그인의 "정말 돌았는가" 검증과 `safeBounds`
       * 계산이 테스트에 영원히 나오지 않는다. 배경 승격·자르기 undo 때와 같은
       * 교훈이다 — Mock 이 현실과 다르면 그 경로는 검증되지 않는다.
       */
      case "DOCUMENT_ROTATE": {
        const document = this.#requireDocument();
        const { angle } = command.params as { angle: number };
        this.#snapshot("Rotate");
        const previousWidth = document.width;
        const previousHeight = document.height;
        const radians = (angle * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        this.#document = {
          ...document,
          width: Math.round(previousWidth * cos + previousHeight * sin),
          height: Math.round(previousWidth * sin + previousHeight * cos),
        };
        return {
          width: this.#document.width,
          height: this.#document.height,
          previousWidth,
          previousHeight,
          angle,
          method: "mock",
        } as TResult;
      }
      case "CAPTURE_DOCUMENT":
      case "CAPTURE_LAYER":
        return this.#capture(command.type === "CAPTURE_LAYER" ? "layer" : "document") as TResult;
      case "CAPTURE_SELECTION":
        if (!this.#hasSelection) {
          throw new PhotoshopMcpError(ErrorCode.INVALID_PARAMETER, "캡처할 선택 영역이 없습니다.", {
            recoverable: true,
          });
        }
        return this.#capture("selection") as TResult;
      case "SELECTION_CLEAR":
        this.#hasSelection = false;
        return { hasSelection: false } as TResult;
      case "SELECTION_INVERT":
        if (!this.#hasSelection) {
          throw new PhotoshopMcpError(ErrorCode.INVALID_PARAMETER, "반전할 선택 영역이 없습니다.", {
            recoverable: true,
          });
        }
        return { hasSelection: true } as TResult;

      // Phase 4 — 필터
      case "FILTER_GAUSSIAN_BLUR":
        this.#snapshot("Gaussian blur");
        return this.#gaussianBlur(
          command.params as { layerId?: number; asSmartFilter?: boolean },
        ) as TResult;

      // ROADMAP 8.6
      case "LAYER_BLEND_MODE":
        this.#snapshot("Set blend mode");
        return this.#setBlendMode(
          command.params as { layerId?: number; blendMode: LayerInfo["blendMode"] },
        ) as TResult;
      case "SELECTION_SET":
        this.#requireDocument();
        this.#hasSelection = true;
        return { hasSelection: true } as TResult;
      case "ADJUSTMENT_HUE_SATURATION":
        this.#snapshot("Hue/Saturation");
        return this.#adjustment("Hue/Saturation", "hueSaturation", command.params) as TResult;
      case "ADJUSTMENT_VIBRANCE":
        this.#snapshot("Vibrance");
        return this.#adjustment("Vibrance", "vibrance", command.params) as TResult;

      // Phase 9 — 파일 저장 (ROADMAP §8.5)
      case "WORKSPACE_STATUS":
        return {
          approved: this.#workspacePath !== null,
          path: this.#workspacePath,
        } as TResult;
      case "DOCUMENT_SAVE_AS":
        return this.#saveInto(
          command.params as { filename: string; format?: string },
          "psd",
        ) as TResult;
      case "DOCUMENT_EXPORT":
        return this.#saveInto(
          command.params as { filename: string; format?: string; bitDepth?: number },
          "png",
        ) as TResult;
      case "DOCUMENT_SAVE":
        return this.#save() as TResult;
      case "SELECTION_EXPORT_MASK":
        /* **선택이 없으면 실패한다.** 실기가 그렇게 동작하는데 Mock 이
         * 성공하면 그 경로는 테스트에 영원히 안 나온다. */
        this.#requireDocument();
        if (!this.#hasSelection) {
          throw new PhotoshopMcpError(
            ErrorCode.INVALID_PARAMETER,
            "선택 영역 마스크를 내보내려면 선택 영역이 있어야 합니다.",
          );
        }
        return this.#saveInto(command.params as { filename: string }, "tiff") as TResult;
      case "SELECTION_GET":
        this.#requireDocument();
        return {
          hasSelection: this.#hasSelection,
          bounds: this.#hasSelection ? { left: 0, top: 0, right: 100, bottom: 100 } : null,
        } as TResult;
      case "HISTORY_LIST": {
        this.#requireDocument();
        const names = this.#history.map((entry) => entry.name);
        return {
          states: names,
          currentIndex: names.length - 1,
          currentState: names[names.length - 1] ?? "열기",
        } as TResult;
      }
      case "WORKSPACE_USAGE":
        return this.#usage(command.params as { limit?: number }) as TResult;
      case "WORKSPACE_DELETE":
        return this.#deleteFiles(command.params as { filenames: string[] }) as TResult;
      case "LAYER_PLACE":
        this.#snapshot("Place file");
        return this.#place(
          command.params as { filename: string; name?: string; rasterize?: boolean },
        ) as TResult;

      default:
        throw new PhotoshopMcpError(
          ErrorCode.COMMAND_NOT_SUPPORTED,
          `Mock Bridge 가 지원하지 않는 Command 입니다: ${command.type}`,
          { details: { command: command.type } },
        );
    }
  }

  /** 활성 레이어 ID. 편집 Command 에서 `layerId` 를 생략했을 때의 대상. */
  get activeLayerId(): number | null {
    return this.#activeLayerId;
  }

  /** 작업 폴더에 쓰인 파일 이름. 실기 없이 저장 동작을 확인할 때 쓴다. */
  get writtenFiles(): string[] {
    return [...this.#writtenFiles];
  }

  /**
   * 그 이름의 파일이 작업 폴더에 있는지.
   *
   * 어댑터가 있으면 실제 폴더를 본다. 외부 처리기가 만든 파일은 Mock 의
   * 기록에 없으므로 메모리만 보면 놓친다.
   */
  #hasFile(filename: string): boolean {
    if (this.#files !== null && this.#workspacePath !== null) {
      return this.#files.exists(`${this.#workspacePath}/${filename}`, filename);
    }
    return this.#writtenFiles.some((name) => name.toLowerCase() === filename.toLowerCase());
  }

  /** 폴더에 이미 있던 파일을 흉내 낸다. 외부 처리기가 만든 결과 등. */
  addExistingFile(filename: string): void {
    if (!this.#writtenFiles.some((name) => name.toLowerCase() === filename.toLowerCase())) {
      this.#writtenFiles.push(filename);
    }
  }

  /** 사용자가 패널에서 폴더를 승인한 상황을 재현한다. */
  approveWorkspace(path: string): void {
    this.#workspacePath = path;
  }

  /** 승인을 해제한다. */
  revokeWorkspace(): void {
    this.#workspacePath = null;
  }

  /**
   * 승인된 폴더에 새 파일로 저장한다.
   *
   * 실제 구현과 같은 계약을 지킨다 — **덮어쓰지 않는다.**
   */
  #saveInto(
    params: { filename: string; format?: string; bitDepth?: number },
    fallback: string,
  ): SaveResult {
    this.#requireDocument();
    if (this.#workspacePath === null) {
      throw new PhotoshopMcpError(
        ErrorCode.WORKSPACE_NOT_APPROVED,
        "저장할 작업 폴더가 승인되지 않았습니다.",
        { recoverable: true },
      );
    }

    // Plugin 과 같은 함수를 쓴다. 따로 두면 Mock 과 실기가 어긋난다.
    const format = params.format ?? fallback;
    const filename = withExtension(params.filename, format);

    if (this.#hasFile(filename)) {
      throw new PhotoshopMcpError(
        ErrorCode.FILE_ALREADY_EXISTS,
        `같은 이름의 파일이 이미 있습니다: ${filename}. 덮어쓰지 않습니다.`,
        { recoverable: true, details: { filename } },
      );
    }

    this.#writtenFiles.push(filename);
    const path = `${this.#workspacePath}/${filename}`;
    this.#files?.write(path, filename);
    const result: SaveResult = { path, filename, format };
    if (format === "tiff") {
      // 실제 Plugin 과 같이 실제 심도를 돌려준다. 요청값이 아니라 결과값이다.
      const requested = (params as { bitDepth?: number }).bitDepth;
      result.bitDepth = requested ?? this.#document?.bitDepth ?? null;
    }
    return result;
  }

  /** 작업 폴더 사용량. 크기는 파일 이름 길이로 흉내 낸다 — 실제 크기는 없다. */
  #usage(params: { limit?: number }): {
    path: string;
    fileCount: number;
    totalBytes: number;
    files: { name: string; size: number | null; modifiedAt: number | null }[];
  } {
    if (this.#workspacePath === null) {
      throw new PhotoshopMcpError(
        ErrorCode.WORKSPACE_NOT_APPROVED,
        "작업 폴더가 승인되지 않았습니다.",
        { recoverable: true },
      );
    }
    const files = this.#writtenFiles.map((name) => ({
      name,
      size: name.length * 1024,
      modifiedAt: null,
    }));
    return {
      path: this.#workspacePath,
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      files: files.slice(0, params.limit ?? 20),
    };
  }

  /** 이름을 명시한 파일만 지운다. 실제 구현과 같은 계약을 지킨다. */
  #deleteFiles(params: { filenames: string[] }): {
    deleted: string[];
    failed: { name: string; reason: string }[];
  } {
    if (this.#workspacePath === null) {
      throw new PhotoshopMcpError(
        ErrorCode.WORKSPACE_NOT_APPROVED,
        "작업 폴더가 승인되지 않았습니다.",
        { recoverable: true },
      );
    }

    const deleted: string[] = [];
    const failed: { name: string; reason: string }[] = [];

    for (const filename of params.filenames) {
      const index = this.#writtenFiles.findIndex(
        (name) => name.toLowerCase() === filename.toLowerCase(),
      );
      if (index < 0) {
        failed.push({ name: filename, reason: "파일이 없습니다." });
        continue;
      }
      deleted.push(this.#writtenFiles[index] as string);
      this.#writtenFiles.splice(index, 1);
    }

    if (deleted.length === 0 && failed.length > 0) {
      throw new PhotoshopMcpError(ErrorCode.FILE_NOT_FOUND, "지운 파일이 없습니다.", {
        recoverable: true,
        details: { failed },
      });
    }
    return { deleted, failed };
  }

  /**
   * 파일을 스마트 오브젝트 레이어로 가져온다.
   *
   * 실제 구현과 같은 계약을 지킨다 — 승인된 폴더 안에 **있는** 파일만 가져올 수 있다.
   */
  #place(params: { filename: string; name?: string; rasterize?: boolean }): LayerInfo {
    this.#requireDocument();
    if (this.#workspacePath === null) {
      throw new PhotoshopMcpError(
        ErrorCode.WORKSPACE_NOT_APPROVED,
        "가져올 파일이 있는 작업 폴더가 승인되지 않았습니다.",
        { recoverable: true },
      );
    }
    if (!this.#hasFile(params.filename)) {
      throw new PhotoshopMcpError(
        ErrorCode.FILE_NOT_FOUND,
        `승인된 작업 폴더에 파일이 없습니다: ${params.filename}`,
        { recoverable: true, details: { filename: params.filename } },
      );
    }

    // 실기에서 확인한 동작. 처음에는 "맨 위에 opacity 100 으로" 만들었는데 셋 다 틀렸다.
    //
    // 1. 문서 맨 위가 아니라 **활성 레이어 바로 위**에 놓인다.
    // 2. 활성 레이어가 그룹 안이면 같은 그룹으로 들어간다.
    // 3. 활성 레이어의 **opacity 를 물려받는다.** (기준 40 → 결과 40 으로 확인)
    const activeIndex = this.#layers.findIndex((layer) => layer.id === this.#activeLayerId);
    const anchor = activeIndex < 0 ? undefined : this.#layers[activeIndex];

    /* **`rasterize` 를 흉내낸다.** Mock 이 현실과 다르면 그 경로는 테스트에
     * 영원히 나오지 않는다 — 배경 `set_opacity` 승격이 실기에서만 드러난 이유가
     * 그것이다. (CLAUDE.md — Capability) */
    const layer: LayerInfo = {
      id: this.#nextLayerId++,
      name: params.name ?? params.filename,
      type: params.rasterize === true ? "pixel" : "smartObject",
      visible: true,
      opacity: anchor?.opacity ?? 100,
      parentId: anchor?.parentId ?? null,
      blendMode: "normal",
    };
    this.#layers.splice(activeIndex < 0 ? 0 : activeIndex, 0, layer);
    this.#activeLayerId = layer.id;
    return { ...layer };
  }

  /** 원본을 덮어쓴다. */
  #save(): SaveResult {
    const document = this.#requireDocument();
    if (this.#documentPath === null) {
      throw new PhotoshopMcpError(
        ErrorCode.DOCUMENT_NOT_SAVED,
        "한 번도 저장한 적 없는 문서입니다. save_as 를 사용하세요.",
        { recoverable: true, details: { name: document.name } },
      );
    }
    const dot = document.name.lastIndexOf(".");
    return {
      path: this.#documentPath,
      filename: document.name,
      format: dot === -1 ? "unknown" : document.name.slice(dot + 1).toLowerCase(),
    };
  }

  /**
   * 지금 선택된 레이어. **순서가 의미를 갖는다** — 첫 번째가 편집 대상이다.
   *
   * 다중 목록은 `#activeLayerId` 와 첫 번째가 같을 때만 믿는다. 다르면 다른
   * Command 가 활성을 바꾼 것이라 낡았다.
   */
  #activeSelection(): LayerInfo[] {
    const valid =
      this.#activeLayerIds.length > 0 && this.#activeLayerIds[0] === this.#activeLayerId;
    const ids = valid ? this.#activeLayerIds : [this.#activeLayerId];
    const out: LayerInfo[] = [];
    for (const id of ids) {
      const found = this.#layers.find((layer) => layer.id === id);
      if (found !== undefined) {
        out.push({ ...found });
      }
    }
    return out;
  }

  #requireLayerIndex(layerId?: number): number {
    this.#requireDocument();
    const id = layerId ?? this.#activeLayerId;
    const index = id === null ? -1 : this.#layers.findIndex((layer) => layer.id === id);
    if (index < 0) {
      throw new PhotoshopMcpError(
        ErrorCode.LAYER_NOT_FOUND,
        id === null ? "활성 레이어가 없습니다." : `레이어 ${id} 를 찾을 수 없습니다.`,
        { recoverable: true, ...(id === null ? {} : { details: { layerId: id } }) },
      );
    }
    return index;
  }

  #mutate(params: { layerId?: number }, change: (layer: LayerInfo) => LayerInfo): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    const current = this.#layers[index] as LayerInfo;
    const updated = change(current);
    this.#layers[index] = updated;
    return { ...updated };
  }

  #create(params: { name?: string }): LayerInfo {
    this.#requireDocument();
    const created: LayerInfo = {
      id: this.#nextLayerId++,
      name: params.name ?? `Layer ${this.#layers.length + 1}`,
      type: "pixel",
      visible: true,
      opacity: 100,
      parentId: null,
      blendMode: "normal",
    };
    // Photoshop 은 새 레이어를 맨 위에 넣는다.
    this.#layers.unshift(created);
    this.#activeLayerId = created.id;
    return { ...created };
  }

  #duplicate(params: { layerId?: number; name?: string }): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    const source = this.#layers[index] as LayerInfo;
    // 배경의 복제본은 배경이 아니다. 문서에 배경은 하나뿐이다.
    const { isBackground: _notCopied, ...rest } = source;
    const copy: LayerInfo = {
      ...rest,
      id: this.#nextLayerId++,
      name: params.name ?? `${source.name} copy`,
    };
    this.#layers.splice(index, 0, copy);
    this.#activeLayerId = copy.id;
    return { ...copy };
  }

  /**
   * Undo 1단계. 편집 Command 가 남긴 이력을 되돌린다.
   *
   * 되돌릴 것이 없으면 실제 Plugin 과 같은 `HISTORY_EMPTY` 로 실패한다.
   */
  #undo(): { currentState: string } {
    this.#requireDocument();
    const snapshot = this.#history.pop();
    if (snapshot === undefined) {
      throw new PhotoshopMcpError(ErrorCode.HISTORY_EMPTY, "되돌릴 작업이 없습니다.", {
        recoverable: true,
      });
    }
    // 되돌리기 **전** 상태를 남겨야 redo 가 돌아올 곳이 있다.
    this.#redo.push({
      name: snapshot.name,
      layers: this.#layers.map((layer) => ({ ...layer })),
      activeLayerId: this.#activeLayerId,
      document: this.#document === null ? null : { ...this.#document },
    });
    this.#layers = snapshot.layers.map((layer) => ({ ...layer }));
    this.#activeLayerId = snapshot.activeLayerId;
    this.#document = snapshot.document === null ? null : { ...snapshot.document };
    return { currentState: snapshot.name };
  }

  /**
   * Redo 1단계. `#undo` 의 거울이다.
   *
   * 다시 실행할 것이 없으면 실제 Plugin 과 같은 `HISTORY_EMPTY` 로 실패한다 —
   * 아무 일도 안 하고 성공을 돌려주면 호출자가 한 단계 갔다고 믿는다.
   */
  #redoOnce(): { currentState: string } {
    this.#requireDocument();
    const snapshot = this.#redo.pop();
    if (snapshot === undefined) {
      throw new PhotoshopMcpError(
        ErrorCode.HISTORY_EMPTY,
        "다시 실행할 작업이 없습니다 — 이미 가장 최근 상태입니다.",
        { recoverable: true },
      );
    }
    // 다시 실행한 것은 되돌릴 수 있어야 한다.
    this.#history.push({
      name: snapshot.name,
      layers: this.#layers.map((layer) => ({ ...layer })),
      activeLayerId: this.#activeLayerId,
      document: this.#document === null ? null : { ...this.#document },
    });
    this.#layers = snapshot.layers.map((layer) => ({ ...layer }));
    this.#activeLayerId = snapshot.activeLayerId;
    this.#document = snapshot.document === null ? null : { ...snapshot.document };
    return { currentState: snapshot.name };
  }

  /**
   * 편집 전 상태를 기록한다.
   *
   * **앞쪽 가지를 버린다.** Photoshop 이 되돌린 뒤 새로 편집하면 그렇게 한다.
   */
  #snapshot(name: string): void {
    this.#redo.length = 0;
    this.#history.push({
      name,
      layers: this.#layers.map((layer) => ({ ...layer })),
      activeLayerId: this.#activeLayerId,
      document: this.#document === null ? null : { ...this.#document },
    });
  }

  /** 조정 레이어를 만들어 맨 위에 넣는다. 실제 Photoshop 과 같은 위치다. */
  /** 1×1 투명 PNG. 내용은 없지만 응답 모양은 실제와 같다. */
  #capture(source: string): {
    kind: "image";
    mimeType: "image/png";
    base64: string;
    width: number;
    height: number;
    source: string;
  } {
    return {
      kind: "image",
      mimeType: "image/png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      width: 1,
      height: 1,
      source: `${source}:mock`,
    };
  }

  /** 선택 영역 상태. 실제 Plugin 과 같은 모양으로 돌려준다. */
  #selectionState(): { hasSelection: boolean; bounds: LayerBounds | null } {
    const document = this.#document;
    if (!this.#hasSelection || document === null) {
      return { hasSelection: false, bounds: null };
    }
    // Mock 은 픽셀을 모르므로 문서 전체를 고른 것으로 본다.
    return {
      hasSelection: true,
      bounds: { left: 0, top: 0, right: document.width, bottom: document.height },
    };
  }

  /** 선택 영역 유무를 바꾼다. 테스트에서 선택 상태를 만들 때 쓴다. */
  setSelection(present: boolean): void {
    this.#hasSelection = present;
  }

  /**
   * 마스크 상태를 바꾼다.
   *
   * 마스크의 **픽셀**은 흉내내지 않는다. 그러나 유무와 활성 여부는 반영한다 —
   * 호출자가 "마스크를 만들었는지" 를 결과로 확인하는 유일한 수단이기 때문이다.
   * Mock 이 이것을 빠뜨리면 그 확인 경로가 테스트에 나오지 않는다.
   *
   * `create` 는 마스크를 만들고 켠다. `enable`/`disable` 은 **있는 마스크만** 토글한다 —
   * 실기에서 마스크 없는 레이어에 `enable` 하면 Photoshop 이 거부했다.
   */
  #setMask(params: { layerId?: number }, enabled: boolean, create = false): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    const layer = this.#layers[index] as LayerInfo;

    if (!create && layer.hasMask !== true) {
      throw new PhotoshopMcpError(
        ErrorCode.COMMAND_FAILED,
        "마스크 상태를 바꾸지 못했습니다. 이 레이어에 마스크가 없을 수 있습니다 — " +
          "mask.create 로 먼저 만드세요.",
        { recoverable: true, details: { layerId: layer.id } },
      );
    }

    const updated: LayerInfo = { ...layer, hasMask: true, maskEnabled: enabled };
    this.#layers[index] = updated;
    return { ...updated };
  }

  /**
   * 가우시안 블러. 픽셀은 흉내내지 않는다.
   *
   * `asSmartFilter: true` 일 때 대상이 스마트 오브젝트로 바뀌는 것만 반영한다.
   * 호출자가 결과의 `type` 으로 비파괴 여부를 확인할 수 있어야 하기 때문이다.
   */
  #gaussianBlur(params: { layerId?: number; asSmartFilter?: boolean }): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    const layer = this.#layers[index] as LayerInfo;
    // 기본은 픽셀 직접 적용. 실제 Plugin 과 같아야 한다.
    const asSmartFilter = params.asSmartFilter ?? false;
    const updated: LayerInfo =
      asSmartFilter && layer.type !== "smartObject" ? { ...layer, type: "smartObject" } : layer;
    this.#layers[index] = updated;
    return { ...updated };
  }

  /** 혼합 모드를 바꾼다. */
  #setBlendMode(params: { layerId?: number; blendMode: LayerInfo["blendMode"] }): LayerInfo {
    return this.#mutate(params, (layer) => ({ ...layer, blendMode: params.blendMode }));
  }

  /**
   * 조정 레이어를 만든다.
   *
   * `adjustmentType` 을 담는다. (ROADMAP §17.24) Mock 이 이 필드를 비워 두면
   * "조정 종류를 알 수 있다" 는 계약이 테스트에 영영 나오지 않는다.
   */
  #adjustment(defaultName: string, kind: AdjustmentType, params: unknown): LayerInfo {
    this.#requireDocument();
    const name = (params as { name?: string }).name ?? defaultName;
    const created: LayerInfo = {
      id: this.#nextLayerId++,
      name,
      type: "adjustment",
      visible: true,
      opacity: 100,
      parentId: null,
      blendMode: "normal",
      adjustmentType: kind,
    };
    this.#layers.unshift(created);
    this.#activeLayerId = created.id;
    return { ...created };
  }

  /**
   * 그룹 생성. `parentId` 가 정한 자리에 만든다. (ROADMAP §17.20)
   *
   * 실기 Photoshop 은 활성 레이어가 있는 곳에 만들지만, Command 의 **계약**은
   * "요청한 자리에 생긴다" 이다. Mock 은 그 계약을 흉내낸다 — 활성 레이어가
   * 어디 있든 결과가 같아야 호출자가 위치를 추적하지 않아도 된다.
   */
  #groupCreate(params: {
    name?: string;
    layerIds?: number[];
    parentId?: number | null;
  }): LayerInfo {
    this.#requireDocument();

    const parentId = params.parentId ?? null;
    if (parentId !== null) {
      const parent = this.#layers.find((layer) => layer.id === parentId);
      if (parent === undefined) {
        throw new PhotoshopMcpError(
          ErrorCode.LAYER_NOT_FOUND,
          `그룹 ${parentId} 를 찾을 수 없습니다.`,
          { recoverable: true, details: { parentId } },
        );
      }
    }

    // 넣을 레이어를 먼저 확인한다. 하나라도 없으면 그룹을 만들지 않는다.
    const members = (params.layerIds ?? []).map((layerId) => {
      const index = this.#layers.findIndex((layer) => layer.id === layerId);
      if (index < 0) {
        throw new PhotoshopMcpError(
          ErrorCode.LAYER_NOT_FOUND,
          `레이어 ${layerId} 를 찾을 수 없습니다.`,
          { recoverable: true, details: { layerId } },
        );
      }
      return index;
    });

    const group: LayerInfo = {
      id: this.#nextLayerId++,
      name: params.name ?? `Group ${this.#layers.length + 1}`,
      type: "group",
      visible: true,
      opacity: 100,
      parentId,
      blendMode: "normal",
    };
    this.#layers.unshift(group);

    // unshift 로 인덱스가 하나씩 밀렸다.
    for (const index of members) {
      const layer = this.#layers[index + 1] as LayerInfo;
      this.#layers[index + 1] = { ...layer, parentId: group.id };
    }

    this.#activeLayerId = group.id;
    return { ...group };
  }

  #groupMoveLayer(params: { layerId: number; groupId: number | null }): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);

    if (params.groupId !== null) {
      const group = this.#layers.find((layer) => layer.id === params.groupId);
      if (group === undefined) {
        throw new PhotoshopMcpError(
          ErrorCode.LAYER_NOT_FOUND,
          `그룹 ${params.groupId} 를 찾을 수 없습니다.`,
          { recoverable: true, details: { groupId: params.groupId } },
        );
      }
      if (group.id === params.layerId) {
        throw new PhotoshopMcpError(
          ErrorCode.INVALID_PARAMETER,
          "레이어를 자기 자신 안으로 옮길 수 없습니다.",
          { details: { layerId: params.layerId } },
        );
      }
    }

    const layer = this.#layers[index] as LayerInfo;
    const moved: LayerInfo = { ...layer, parentId: params.groupId };
    this.#layers[index] = moved;
    return { ...moved };
  }

  /**
   * 레이어 순서 변경. (ROADMAP §17.23)
   *
   * **배열을 실제로 다시 늘어놓는다.** 결과만 흉내내면 `index` 가 맞는지
   * 검증되지 않고, 이 Command 가 약속하는 것이 바로 그 값이다.
   *
   * 배경 레이어는 맨 아래에 고정이라 움직이지 않는다 — 실기와 같게 둔다.
   * Mock 이 더 너그러우면 그 경로는 테스트에 영원히 나오지 않는다.
   */
  #layerReorder(params: {
    layerId: number;
    placement: "top" | "bottom" | "up" | "down" | "above" | "below";
    referenceId?: number;
  }): {
    layer: LayerInfo;
    moved: boolean;
    previousIndex: number;
    index: number;
    siblings: number;
  } {
    const at = this.#requireLayerIndex(params.layerId);
    const layer = this.#layers[at] as LayerInfo;
    const parentId = layer.parentId ?? null;

    const siblingIds = (parent: number | null): number[] =>
      this.#layers.filter((entry) => (entry.parentId ?? null) === parent).map((entry) => entry.id);

    const before = siblingIds(parentId);
    const previousIndex = before.indexOf(params.layerId);

    const needsReference = params.placement === "above" || params.placement === "below";
    if (needsReference) {
      const reference = this.#layers.find((entry) => entry.id === params.referenceId);
      if (reference === undefined) {
        throw new PhotoshopMcpError(
          ErrorCode.LAYER_NOT_FOUND,
          `기준 레이어 ${String(params.referenceId)} 를 찾을 수 없습니다.`,
          { recoverable: true, details: { referenceId: params.referenceId } },
        );
      }
    }

    const stay = (): {
      layer: LayerInfo;
      moved: boolean;
      previousIndex: number;
      index: number;
      siblings: number;
    } => ({
      layer: { ...layer },
      moved: false,
      previousIndex,
      index: previousIndex,
      siblings: before.length,
    });

    // 배경 레이어는 맨 아래에 고정이다.
    if (layer.isBackground === true) {
      return stay();
    }

    let insertBeforeId: number | null = null;
    let insertAfterId: number | null = null;
    switch (params.placement) {
      case "top": {
        const first = before[0];
        if (first === undefined || first === params.layerId) return stay();
        insertBeforeId = first;
        break;
      }
      case "bottom": {
        const last = before[before.length - 1];
        if (last === undefined || last === params.layerId) return stay();
        insertAfterId = last;
        break;
      }
      case "up": {
        const above = before[previousIndex - 1];
        if (above === undefined) return stay();
        insertBeforeId = above;
        break;
      }
      case "down": {
        const below = before[previousIndex + 1];
        if (below === undefined) return stay();
        insertAfterId = below;
        break;
      }
      case "above":
        insertBeforeId = params.referenceId as number;
        break;
      case "below":
        insertAfterId = params.referenceId as number;
        break;
    }

    // 배열에서 빼고 기준 옆에 다시 넣는다.
    const anchorId = insertBeforeId ?? (insertAfterId as number);
    const anchor = this.#layers.find((entry) => entry.id === anchorId) as LayerInfo;
    const moved: LayerInfo = { ...layer, parentId: anchor.parentId ?? null };
    this.#layers.splice(at, 1);
    const anchorAt = this.#layers.findIndex((entry) => entry.id === anchorId);
    this.#layers.splice(insertBeforeId !== null ? anchorAt : anchorAt + 1, 0, moved);

    const after = siblingIds(moved.parentId ?? null);
    const index = after.indexOf(params.layerId);
    return {
      layer: { ...moved },
      moved: index !== previousIndex || (moved.parentId ?? null) !== parentId,
      previousIndex,
      index,
      siblings: after.length,
    };
  }

  #select(params: { layerId: number }): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    const layer = this.#layers[index] as LayerInfo;
    this.#activeLayerId = layer.id;
    return { ...layer };
  }

  async getDocumentInfo(): Promise<DocumentInfo> {
    this.#guard();
    return { ...this.#requireDocument() };
  }

  async getLayers(): Promise<LayerInfo[]> {
    this.#guard();
    this.#requireDocument();
    return this.#layers.map((layer) => ({ ...layer }));
  }

  /** 주입된 1회성 실패와 연결 상태를 확인한다. */
  #guard(): void {
    if (this.#pendingFailure !== null) {
      const failure = this.#pendingFailure;
      this.#pendingFailure = null;
      throw failure;
    }
    if (!this.#connected) {
      throw new PhotoshopMcpError(
        ErrorCode.PHOTOSHOP_NOT_CONNECTED,
        "Photoshop 에 연결되어 있지 않습니다.",
        { recoverable: true },
      );
    }
  }

  #requireDocument(): DocumentInfo {
    if (this.#document === null) {
      throw new PhotoshopMcpError(ErrorCode.DOCUMENT_NOT_FOUND, "열려 있는 문서가 없습니다.", {
        recoverable: true,
      });
    }
    return this.#document;
  }
}
