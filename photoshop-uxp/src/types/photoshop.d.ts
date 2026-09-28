/**
 * UXP 런타임이 제공하는 모듈의 최소 타입 선언.
 *
 * 이 플러그인이 실제로 사용하는 API 만 선언한다. Photoshop DOM 전체를 선언하지 않는다.
 * 공식 타입 패키지가 정리되면 이 파일을 대체한다.
 *
 * 주의: 이 선언은 Adobe 문서를 근거로 작성했으며 실제 Photoshop 에서 검증되지 않았다.
 * 런타임 값이 선언과 다를 수 있으므로 값을 사용하는 쪽에서 방어적으로 변환한다.
 */

declare module "photoshop" {
  /**
   * Imaging API. 축소한 픽셀을 메모리로 준다.
   *
   * 버전에 따라 없을 수 있어 `undefined` 를 허용한다. 쓰는 쪽에서 확인한다.
   */
  export const imaging:
    | {
        getPixels(options: Record<string, unknown>): Promise<{
          imageData?: { dispose?: () => void };
        }>;
        /** 레이어 마스크의 픽셀. **버전에 따라 없을 수 있어** 쓰는 쪽에서 확인한다. */
        getLayerMask?(options: Record<string, unknown>): Promise<{
          imageData?: { dispose?: () => void };
        }>;
        encodeImageData(options: Record<string, unknown>): Promise<unknown>;
        createImageDataFromBuffer?(
          buffer: ArrayBufferView,
          options: Record<string, unknown>,
        ): Promise<{ dispose?: () => void }>;
      }
    | undefined;

  /** `Constants.BitsPerChannelType` */
  export type BitsPerChannel = "eight" | "sixteen" | "thirtyTwo" | (string & {});

  export interface PhotoshopLayer {
    readonly id: number;
    name: string;
    /** `Constants.LayerKind`. 값 목록이 버전에 따라 늘어난다. */
    readonly kind: string;
    visible: boolean;
    /** 0–100. */
    opacity: number;
    /** `Constants.BlendMode`. */
    blendMode: string;
    /**
     * 배경 레이어인지. UXP 버전에 따라 없을 수 있어 `unknown` 으로 받는다.
     * 값을 쓰는 쪽에서 boolean 인지 확인한다.
     */
    readonly isBackgroundLayer?: unknown;
    /** 그룹 레이어의 자식. 그룹이 아니면 빈 배열이거나 `undefined`. */
    readonly layers?: readonly PhotoshopLayer[];

    /** 레이어를 복제한다. **비동기다.** */
    duplicate(): Promise<PhotoshopLayer>;

    /**
     * 레이어를 지운다. **비동기다.**
     *
     * 던지지 않았다고 사라진 것은 아니다 — 부른 쪽이 목록을 다시 읽어 확인한다.
     */
    delete(): Promise<void>;

    /** 레이어를 다른 위치로 옮긴다. **비동기다.** */
    move(relativeObject: PhotoshopLayer | PhotoshopDocument, placement: string): Promise<void>;

    /**
     * 레이어를 픽셀로 굽는다. **비동기다.**
     *
     * UXP 버전에 따라 없을 수 있어 선택으로 둔다. 부르는 쪽이 있는지 확인한다.
     */
    /** `target` 은 `constants.RasterizeType.*` 를 그대로 넘긴다. 문자열이라는
     * 보장이 없어 `unknown` 이다 — `SaveOptions` 에서 같은 가정이 틀렸다. */
    rasterize?(target: unknown): Promise<void>;
  }

  export interface PhotoshopDocument {
    readonly id: number;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    /** `Constants.DocumentMode` */
    readonly mode: string;
    readonly layers: readonly PhotoshopLayer[];
    /** 현재 선택된 레이어들. 대입하면 선택이 바뀐다. */
    activeLayers: readonly PhotoshopLayer[];
    /** 선택 영역. `bounds` 가 없으면 선택이 없다. */
    readonly selection?: { readonly bounds?: unknown };
    /** History 항목. 오래된 것부터 최신 순. */
    readonly historyStates: readonly PhotoshopHistoryState[];
    /** 현재 History 지점. 대입하면 그 지점으로 되돌린다. */
    activeHistoryState: PhotoshopHistoryState;

    /**
     * 문서를 복제한다. **비동기다.**
     *
     * 교환용 파일을 만들 때 원본을 건드리지 않기 위해 쓴다.
     */
    duplicate(): Promise<PhotoshopDocument>;

    /** 모든 레이어를 합친다. **비동기다.** */
    flatten(): Promise<void>;

    /**
     * 문서 전체를 회전한다. 시계 방향이 양수다.
     *
     * **Photoshop 27.8 에 존재하는 것을 실기로 확인했다** — 선언이 없어 짐작할
     * 뻔했다(ROADMAP §17.19). 반환이 Promise 인지까지는 확인하지 않았으므로
     * 둘 다 받는다. 호출부는 `await` 한다.
     */
    rotate(angle: number): Promise<void> | void;

    /**
     * 문서를 닫는다. **비동기다.**
     *
     * 인자를 주지 않으면 Photoshop 이 저장 여부를 묻는다. 복제본은 반드시
     * 저장하지 않고 닫아야 대화상자가 뜨지 않는다.
     */
    close(saveOptions?: unknown): Promise<void>;

    /** 비트 심도. 복제본에서만 바꾼다. */
    bitsPerChannel: BitsPerChannel;

    /** 새 픽셀 레이어를 만든다. **비동기다.** */
    createLayer(options?: { name?: string; opacity?: number }): Promise<PhotoshopLayer>;

    /**
     * 문서의 파일 경로. 한 번도 저장하지 않았으면 비어 있거나 접근 시 예외가 난다.
     */
    readonly path?: string;

    /**
     * 원래 경로에 덮어쓴다. **비파괴가 아니다.**
     *
     * 인자 없이 부르면 문서 자신의 경로에 쓴다.
     */
    save(): Promise<void>;

    /**
     * 파일로 저장한다. 전부 비동기다.
     *
     * `entry` 는 UXP storage API 로 얻은 File 이어야 한다. 경로 문자열은 받지 않는다.
     * `asCopy` 가 `true` 면 열려 있는 문서의 경로가 바뀌지 않는다.
     */
    readonly saveAs: {
      psd(entry: unknown, options?: Record<string, unknown>, asCopy?: boolean): Promise<void>;
      psb(entry: unknown, options?: Record<string, unknown>, asCopy?: boolean): Promise<void>;
      // tif 는 없다. 실기에서 `document.saveAs.tif is not a function` 으로 확인했다.
      png(entry: unknown, options?: Record<string, unknown>, asCopy?: boolean): Promise<void>;
      jpg(entry: unknown, options?: { quality?: number }, asCopy?: boolean): Promise<void>;
    };

    /** 레이어 그룹을 만든다. **비동기다.** */
    createLayerGroup(options?: {
      name?: string;
      fromLayers?: readonly PhotoshopLayer[];
    }): Promise<PhotoshopLayer>;
  }

  export interface PhotoshopHistoryState {
    readonly id: number;
    readonly name: string;
  }

  export interface PhotoshopApp {
    readonly activeDocument: PhotoshopDocument | null;
    readonly documents: readonly PhotoshopDocument[];

    /**
     * 파일을 연다. **비동기다.**
     *
     * 인자 없이 부르면 파일 선택 대화상자가 뜨므로 **반드시 entry 를 준다.**
     * RAW 를 주면 Camera Raw 대화상자가 뜬다 — Command 스키마가 미리 막는다.
     * (ROADMAP §17.26)
     */
    open(entry: Entry): Promise<PhotoshopDocument>;
  }

  export interface ExecuteAsModalContext {
    reportProgress(info: { value: number }): void;
  }

  export interface PhotoshopCore {
    /**
     * Photoshop 상태를 읽거나 바꾸는 작업을 modal 실행 컨텍스트에서 수행한다.
     * (ARCHITECTURE §13)
     */
    executeAsModal<TResult>(
      fn: (context: ExecuteAsModalContext) => Promise<TResult>,
      options: { commandName: string },
    ): Promise<TResult>;
  }

  /** `Constants.ElementPlacement`. 레이어 이동 위치를 지정한다. */
  export interface ElementPlacementConstants {
    readonly PLACEINSIDE: string;
    readonly PLACEATBEGINNING: string;
    readonly PLACEATEND: string;
    readonly PLACEBEFORE: string;
    readonly PLACEAFTER: string;
  }

  /**
   * `batchPlay` 는 Photoshop 의 Action Descriptor 를 직접 실행한다.
   *
   * DOM 으로 처리할 수 없는 기능(조정 레이어 등)에만 쓴다. (ARCHITECTURE §13)
   * descriptor 는 반드시 플러그인이 검증된 파라미터로 조립한다.
   * 외부에서 받은 descriptor 를 그대로 실행하는 통로를 만들지 않는다. (ARCHITECTURE §23)
   */
  export interface PhotoshopAction {
    batchPlay(
      descriptors: readonly Record<string, unknown>[],
      options: Record<string, unknown>,
    ): Promise<Record<string, unknown>[]>;

    /**
     * Photoshop 동작 알림을 구독한다. (ARCHITECTURE §21)
     *
     * 이름은 batchPlay 액션 이름이다 — `make` · `delete` · `set`.
     * 콜백은 그 액션의 descriptor 를 함께 받는다.
     */
    addNotificationListener(
      events: readonly { event: string }[],
      listener: (event: string, descriptor: Record<string, unknown>) => void,
    ): Promise<void>;

    /** 구독을 해제한다. 일부 UXP 버전에는 없다. */
    removeNotificationListener?(
      events: readonly { event: string }[],
      listener: (event: string, descriptor: Record<string, unknown>) => void,
    ): void;
  }

  export const action: PhotoshopAction;
  export const app: PhotoshopApp;
  export const core: PhotoshopCore;
  export const constants: {
    readonly ElementPlacement: ElementPlacementConstants;
    /**
     * 문서를 닫을 때의 저장 여부. 복제본은 DONOTSAVECHANGES 로 닫는다.
     *
     * **`string` 이라고 선언해 두었던 것은 틀렸다.** 실기에서 재 보니
     * 문자열이 아니었다(`host.get` 이 잡았다). 무엇인지 모르므로 `unknown`
     * 이고, 쓰는 쪽은 `=== undefined` 로 있는지만 본다.
     */
    readonly SaveOptions?: { readonly DONOTSAVECHANGES: unknown };
    /** 무엇을 구울지. 스마트 오브젝트는 ENTIRELAYER 로 통째로 굽는다. */
    readonly RasterizeType?: { readonly ENTIRELAYER: unknown };
    /**
     * `document.resizeImage` 의 보간 방식. (`IMAGE_RESIZE`)
     *
     * 값이 무엇인지 확인한 적이 없으므로 `unknown` 이다 — `SaveOptions` 를
     * `string` 이라고 잘못 선언했던 자리와 같다. 쓰는 쪽은 `=== undefined`
     * 로 있는지만 보고, 없으면 조용히 떨어뜨리지 않고 거절한다.
     *
     * `NONE` 은 Adobe 가 "Currently unsupported" 라고 적어 두어 뺐다.
     */
    readonly ResampleMethod?: Readonly<Record<string, unknown>>;
    /**
     * `document.resizeCanvas` 의 기준점. (`CANVAS_RESIZE`)
     *
     * 값이 무엇인지 확인한 적이 없으므로 `unknown` 이다. 쓰는 쪽은
     * `=== undefined` 로 있는지만 보고, 없으면 거절한다 — 기준점이 다르면
     * **어느 쪽이 잘리는지가 달라진다.**
     */
    readonly AnchorPosition?: Readonly<Record<string, unknown>>;
    /**
     * `document.trim` 의 기준. (`DOCUMENT_TRIM`)
     *
     * 값이 무엇인지 확인한 적이 없으므로 `unknown` 이다. 없으면 거절한다 —
     * 기준이 다르면 **무엇을 여백으로 볼지가 달라진다.**
     */
    readonly TrimType?: Readonly<Record<string, unknown>>;
    /**
     * `document.changeMode` 의 대상 모드. (`DOCUMENT_MODE_CONVERT`)
     *
     * 값이 무엇인지 확인한 적이 없으므로 `unknown` 이다. 없으면 거절한다.
     */
    readonly ChangeMode?: Readonly<Record<string, unknown>>;
    /**
     * `Layer.flip` 의 축. (`LAYER_FLIP`)
     *
     * 값이 무엇인지 확인한 적이 없으므로 `unknown` 이다. 없으면 거절한다.
     */
    readonly FlipAxis?: Readonly<Record<string, unknown>>;
    /**
     * `Layer.scale` · `Layer.rotate` 의 `options.interpolation`.
     * (`LAYER_SCALE` · `LAYER_ROTATE`)
     *
     * 값이 무엇인지 확인한 적이 없으므로 `unknown` 이다. 없으면 거절한다.
     */
    readonly InterpolationMethod?: Readonly<Record<string, unknown>>;
    /**
     * `Selection.select*` · `load` · `saveTo` 의 합성 방식.
     * (`SELECTION_POLYGON` 등)
     *
     * `REPLACE` · `EXTEND` · `DIMINISH` · `INTERSECT` 네 가지이고 값이
     * 무엇인지는 확인한 적이 없으므로 `unknown` 이다. 없으면 거절한다.
     */
    readonly SelectionType?: Readonly<Record<string, unknown>>;
    /** 패스 긋기용 도구. 값은 실기에서 확인한다. (ROADMAP §58) */
    readonly ToolType?: Readonly<Record<string, unknown>>;
  };
}

declare module "uxp" {
  export interface PluginManifest {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  }

  export interface HostInfo {
    readonly name: string;
    readonly version: string;
  }

  export const versions: { readonly uxp: string };
  export const host: HostInfo;
  export const entrypoints: {
    setup(config: Record<string, unknown>): void;
  };
  /** 항목의 부가 정보. 일부 필드는 환경에 따라 없을 수 있다. */
  export interface EntryMetadata {
    readonly size?: number;
    readonly dateCreated?: Date;
    readonly dateModified?: Date;
  }

  /** UXP 파일 시스템 항목. */
  export interface Entry {
    readonly name: string;
    readonly isFile: boolean;
    readonly isFolder: boolean;
    /** OS 의 실제 경로. 사용자에게 보여줄 때만 쓴다. */
    readonly nativePath: string;
    /** 크기·수정 시각. 실패할 수 있다. */
    getMetadata(): Promise<EntryMetadata>;
    /** 항목을 지운다. */
    delete(): Promise<void>;
  }

  export interface File extends Entry {
    readonly isFile: true;
  }

  export interface Folder extends Entry {
    readonly isFolder: true;
    /** 폴더 안의 항목. */
    getEntries(): Promise<Entry[]>;
    /**
     * 폴더 안에 파일을 만든다.
     *
     * `overwrite` 를 주지 않으면 같은 이름이 있을 때 예외를 던진다.
     */
    createFile(name: string, options?: { overwrite?: boolean }): Promise<File>;
  }

  export interface LocalFileSystem {
    /** 기존 파일/폴더를 `file:` URL 로 연다. 없으면 예외를 던진다. */
    getEntryWithUrl(url: string): Promise<unknown>;
    /** `file:` URL 로 새 파일을 만든다. */
    createEntryWithUrl(url: string, options?: { overwrite?: boolean }): Promise<unknown>;
    /**
     * 폴더 선택 대화상자를 연다.
     *
     * **사용자 제스처가 필요하다.** 소켓 메시지로는 띄울 수 없다.
     * 사용자가 취소하면 `null` 을 돌려준다.
     */
    getFolder(options?: { initialDomain?: unknown }): Promise<Folder | null>;
    /**
     * 재시작 후에도 유효한 토큰을 만든다.
     *
     * 이 토큰이 있어야 나중에 같은 폴더를 다시 열 수 있다. (ROADMAP §8.5)
     */
    createPersistentToken(entry: Entry): Promise<string>;
    /** 토큰으로 항목을 되찾는다. 폴더가 지워졌으면 예외를 던진다. */
    getEntryForPersistentToken(token: string): Promise<Entry>;
    /**
     * batchPlay 에 넘길 세션 토큰을 만든다.
     *
     * Photoshop 의 save 액션은 경로 문자열이 아니라 이 토큰을 요구한다.
     * 경로를 그대로 넘기면 `invalid file token used` 가 난다. (ROADMAP §8.5)
     */
    createSessionToken(entry: Entry): string;
  }

  export const storage: { readonly localFileSystem: LocalFileSystem };
}
