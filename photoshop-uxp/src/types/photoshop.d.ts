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
  /** `Constants.BitsPerChannelType` */
  export type BitsPerChannel = "eight" | "sixteen" | "thirtyTwo" | (string & {});

  export interface PhotoshopLayer {
    readonly id: number;
    readonly name: string;
    /** `Constants.LayerKind`. 값 목록이 버전에 따라 늘어난다. */
    readonly kind: string;
    readonly visible: boolean;
    /** 그룹 레이어의 자식. 그룹이 아니면 빈 배열이거나 `undefined`. */
    readonly layers?: readonly PhotoshopLayer[];
  }

  export interface PhotoshopDocument {
    readonly id: number;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly bitsPerChannel: BitsPerChannel;
    /** `Constants.DocumentMode` */
    readonly mode: string;
    readonly layers: readonly PhotoshopLayer[];
  }

  export interface PhotoshopApp {
    readonly activeDocument: PhotoshopDocument | null;
    readonly documents: readonly PhotoshopDocument[];
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

  export const app: PhotoshopApp;
  export const core: PhotoshopCore;
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
  export const storage: unknown;
}
