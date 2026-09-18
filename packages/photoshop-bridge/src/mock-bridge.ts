import type { PhotoshopBridge } from "./bridge.js";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";
import type { DocumentInfo, LayerInfo, PhotoshopCommand } from "./protocol/types.js";
import { withExtension, type SaveResult } from "./protocol/workspace.js";

/** ROADMAP §5.5 의 기본 Mock 문서. */
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
  #nextLayerId: number;
  readonly #history: { name: string; layers: LayerInfo[]; activeLayerId: number | null }[] = [];
  #hasSelection = false;
  #workspacePath: string | null;
  #documentPath: string | null;
  readonly #writtenFiles: string[] = [];

  /** 이 Bridge 가 처리한 Command 기록. 테스트에서 호출 경로를 검증할 때 사용한다. */
  readonly executedCommands: PhotoshopCommand[] = [];

  constructor(options: MockPhotoshopBridgeOptions = {}) {
    this.#connected = options.connected ?? true;
    // 기본값은 승인 전 상태다. 실제 UXP 도 사용자가 승인하기 전에는 저장할 수 없다.
    this.#workspacePath = options.workspacePath ?? null;
    this.#documentPath = options.documentPath ?? null;
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
      case "DOCUMENT_GET":
        return (await this.getDocumentInfo()) as TResult;
      case "LAYER_LIST":
        return (await this.getLayers()) as TResult;

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
      case "LAYER_OPACITY":
        this.#snapshot("Set opacity");
        return this.#mutate(command.params as { layerId?: number }, (layer) => ({
          ...layer,
          opacity: (command.params as { opacity: number }).opacity,
        })) as TResult;

      // Phase 3 — 그룹
      case "GROUP_CREATE":
        this.#snapshot("Create group");
        return this.#groupCreate(
          command.params as { name?: string; layerIds?: number[] },
        ) as TResult;
      case "GROUP_MOVE_LAYER":
        this.#snapshot("Move layer");
        return this.#groupMoveLayer(
          command.params as { layerId: number; groupId: number | null },
        ) as TResult;

      // Phase 3 — History
      case "HISTORY_UNDO":
        return this.#undo() as TResult;

      // Phase 4 — 조정 레이어
      case "ADJUSTMENT_CURVES":
        this.#snapshot("Curves");
        return this.#adjustment("Curves", command.params) as TResult;
      case "ADJUSTMENT_LEVELS":
        this.#snapshot("Levels");
        return this.#adjustment("Levels", command.params) as TResult;
      case "ADJUSTMENT_BRIGHTNESS_CONTRAST":
        this.#snapshot("Brightness/Contrast");
        return this.#adjustment("Brightness/Contrast", command.params) as TResult;

      // Phase 4 — 마스크 · 선택 영역
      case "MASK_CREATE":
        this.#snapshot("Create mask");
        return this.#setMask(command.params as { layerId?: number }, true) as TResult;
      case "MASK_ENABLE":
        this.#snapshot("Enable mask");
        return this.#setMask(command.params as { layerId?: number }, true) as TResult;
      case "MASK_DISABLE":
        this.#snapshot("Disable mask");
        return this.#setMask(command.params as { layerId?: number }, false) as TResult;
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
        return this.#adjustment("Hue/Saturation", command.params) as TResult;
      case "ADJUSTMENT_VIBRANCE":
        this.#snapshot("Vibrance");
        return this.#adjustment("Vibrance", command.params) as TResult;

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
      case "LAYER_PLACE":
        this.#snapshot("Place file");
        return this.#place(command.params as { filename: string; name?: string }) as TResult;

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

    if (this.#writtenFiles.some((name) => name.toLowerCase() === filename.toLowerCase())) {
      throw new PhotoshopMcpError(
        ErrorCode.FILE_ALREADY_EXISTS,
        `같은 이름의 파일이 이미 있습니다: ${filename}. 덮어쓰지 않습니다.`,
        { recoverable: true, details: { filename } },
      );
    }

    this.#writtenFiles.push(filename);
    const result: SaveResult = { path: `${this.#workspacePath}/${filename}`, filename, format };
    if (format === "tiff") {
      // 실제 Plugin 과 같이 실제 심도를 돌려준다. 요청값이 아니라 결과값이다.
      const requested = (params as { bitDepth?: number }).bitDepth;
      result.bitDepth = requested ?? this.#document?.bitDepth ?? null;
    }
    return result;
  }

  /**
   * 파일을 스마트 오브젝트 레이어로 가져온다.
   *
   * 실제 구현과 같은 계약을 지킨다 — 승인된 폴더 안에 **있는** 파일만 가져올 수 있다.
   */
  #place(params: { filename: string; name?: string }): LayerInfo {
    this.#requireDocument();
    if (this.#workspacePath === null) {
      throw new PhotoshopMcpError(
        ErrorCode.WORKSPACE_NOT_APPROVED,
        "가져올 파일이 있는 작업 폴더가 승인되지 않았습니다.",
        { recoverable: true },
      );
    }
    if (!this.#writtenFiles.some((name) => name.toLowerCase() === params.filename.toLowerCase())) {
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

    const layer: LayerInfo = {
      id: this.#nextLayerId++,
      name: params.name ?? params.filename,
      type: "smartObject",
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
    const copy: LayerInfo = {
      ...source,
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
    this.#layers = snapshot.layers.map((layer) => ({ ...layer }));
    this.#activeLayerId = snapshot.activeLayerId;
    return { currentState: snapshot.name };
  }

  /** 편집 전 상태를 기록한다. */
  #snapshot(name: string): void {
    this.#history.push({
      name,
      layers: this.#layers.map((layer) => ({ ...layer })),
      activeLayerId: this.#activeLayerId,
    });
  }

  /** 조정 레이어를 만들어 맨 위에 넣는다. 실제 Photoshop 과 같은 위치다. */
  /** 선택 영역 유무를 바꾼다. 테스트에서 선택 상태를 만들 때 쓴다. */
  setSelection(present: boolean): void {
    this.#hasSelection = present;
  }

  /**
   * 마스크 상태를 바꾼다.
   *
   * Mock 은 마스크의 픽셀을 흉내내지 않는다. 대상 레이어가 존재하는지와
   * 오류 경로만 검증할 수 있으면 충분하다.
   */
  #setMask(params: { layerId?: number }, _enabled: boolean): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    return { ...(this.#layers[index] as LayerInfo) };
  }

  /**
   * 가우시안 블러. 픽셀은 흉내내지 않는다.
   *
   * 스마트 필터로 적용하면 대상이 스마트 오브젝트로 바뀌는 것만 반영한다.
   * 호출자가 결과의 `type` 으로 비파괴 여부를 확인할 수 있어야 하기 때문이다.
   */
  #gaussianBlur(params: { layerId?: number; asSmartFilter?: boolean }): LayerInfo {
    const index = this.#requireLayerIndex(params.layerId);
    const layer = this.#layers[index] as LayerInfo;
    const asSmartFilter = params.asSmartFilter ?? true;
    const updated: LayerInfo =
      asSmartFilter && layer.type !== "smartObject" ? { ...layer, type: "smartObject" } : layer;
    this.#layers[index] = updated;
    return { ...updated };
  }

  /** 혼합 모드를 바꾼다. */
  #setBlendMode(params: { layerId?: number; blendMode: LayerInfo["blendMode"] }): LayerInfo {
    return this.#mutate(params, (layer) => ({ ...layer, blendMode: params.blendMode }));
  }

  #adjustment(defaultName: string, params: unknown): LayerInfo {
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
    };
    this.#layers.unshift(created);
    this.#activeLayerId = created.id;
    return { ...created };
  }

  #groupCreate(params: { name?: string; layerIds?: number[] }): LayerInfo {
    this.#requireDocument();

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
      parentId: null,
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
