import { action, app, constants, imaging } from "photoshop";
import { host, versions } from "uxp";

/**
 * 호스트 정보와 **이 플러그인이 실제로 쓰는 API 의 유무**.
 *
 * ## 버전만 돌려주는 Tool 로 두지 않는다
 *
 * 이 프로젝트는 같은 질문을 여러 번 실기에서 확인했다.
 *
 * ```text
 * document.histogram        §17.13 — 없었다. 두 경로를 준비해 재 보고 알았다
 * document.rotate           §17.19 — 있었다. 짐작으로 골랐으면 틀렸을 수 있다
 * SaveOptions.DONOTSAVE…    §17.25 — 없으면 시험 삼아 부르지 않고 실패한다
 * imaging.getLayerMask      §28   — 마스크를 재려고 확인했다
 * ```
 *
 * **넷 다 "있는지 몰라서" 판 자리다.** 한 번에 답하면 다음 사람이 같은 자리를
 * 다시 파지 않는다.
 *
 * ## 모르면 `false` 가 아니라 `null`
 *
 * `document.*` 는 활성 문서가 있어야 확인할 수 있다. 문서가 없을 때 `false` 로
 * 답하면 **"이 Photoshop 에는 없다" 는 틀린 사실**을 말하게 된다.
 * `LayerInfo.isBackground` 와 같은 원칙이다.
 */

export interface HostFeatures {
  /** 캡처·통계의 전제. 없으면 `document.capture` 계열이 전부 막힌다. */
  imagingGetPixels: boolean;
  /** 마스크를 보고 재는 길. (ROADMAP §28) */
  imagingGetLayerMask: boolean;
  /** 문서를 닫을 때 쓴다. 없으면 `document.close` 가 실패한다. (§17.25) */
  saveOptionsDoNotSave: boolean;
  /** 스마트 오브젝트를 통째로 굽는다. */
  rasterizeEntireLayer: boolean;
  /** `action.addNotificationListener`. descriptor 를 잡는 길. (§17.28) */
  notifications: boolean;
  /** `document.rotate`. **활성 문서가 없으면 `null`.** (§17.19) */
  documentRotate: boolean | null;
  /** `document.histogram`. 실기에서 **없었다.** (§17.13) */
  documentHistogram: boolean | null;
  /** `document.selection`. 선택 영역을 DOM 으로 읽는다. */
  selectionDom: boolean | null;
  /**
   * `document.layerComps` · `document.pathItems`.
   *
   * **이 서버는 아직 쓰지 않는다.** 호스트가 가졌는지를 말할 뿐이고 Tool 이
   * 있다는 뜻이 아니다 — 만들 수 있는지 미리 판단하는 근거다.
   */
  layerComps: boolean | null;
  pathItems: boolean | null;
}

export interface HostInfoResult {
  /** 호스트 이름. UXP 가 주는 값 그대로. */
  name: string | null;
  /** Photoshop 버전. */
  version: string | null;
  /** UXP 런타임 버전. */
  uxp: string | null;
  /** 열려 있는 문서 수. `features` 의 `null` 이 왜 나왔는지 설명한다. */
  openDocuments: number;
  features: HostFeatures;
}

/** 문자열이 아니면 `null`. 빈 문자열도 `null` 이다 — 없는 것과 같다. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function hostGet(): HostInfoResult {
  const document = app.activeDocument;
  const documents = app.documents;
  const openDocuments = Array.isArray(documents) ? documents.length : 0;

  /* **활성 문서가 없으면 `null` 이다.** 문서 메서드는 문서에 붙어 있으므로
   * 문서 없이는 있는지 없는지 알 수 없다. */
  const onDocument = (name: string): boolean | null => {
    if (document === null || document === undefined) {
      return null;
    }
    return typeof (document as unknown as Record<string, unknown>)[name] === "function";
  };

  /** 메서드가 아니라 **속성**인 것. 있기만 하면 된다. */
  const onDocumentProperty = (name: string): boolean | null => {
    if (document === null || document === undefined) {
      return null;
    }
    return (document as unknown as Record<string, unknown>)[name] !== undefined;
  };

  return {
    name: text((host as { name?: unknown } | undefined)?.name),
    version: text((host as { version?: unknown } | undefined)?.version),
    uxp: text((versions as { uxp?: unknown } | undefined)?.uxp),
    openDocuments,
    features: {
      imagingGetPixels: typeof imaging?.getPixels === "function",
      imagingGetLayerMask: typeof imaging?.getLayerMask === "function",
      /* **소비처와 같은 판정을 쓴다.** 처음에 `typeof === "string"` 으로
       * 검사했다가 실기에서 `saveOptionsDoNotSave: false` 가 나왔다 —
       * `document.close` 는 `=== undefined` 만 보는데도 "없다" 고 보고한
       * 것이다. 타입 선언이 `string` 이라 그걸 믿은 것이 원인이었고,
       * 선언 자체가 검증되지 않은 것이었다.
       *
       * **`host.get` 이 가장 하지 말아야 할 거짓말이 이것이다** — 되는데
       * 안 된다고 하면 호출자가 멀쩡한 경로를 피한다. */
      saveOptionsDoNotSave: constants.SaveOptions?.DONOTSAVECHANGES !== undefined,
      rasterizeEntireLayer: constants.RasterizeType?.ENTIRELAYER !== undefined,
      notifications: typeof action?.addNotificationListener === "function",
      documentRotate: onDocument("rotate"),
      documentHistogram: onDocument("histogram"),
      /* 메서드가 아니라 속성이다. `typeof === "function"` 으로 보면 안 된다 —
       * `saveOptionsDoNotSave` 에서 같은 실수를 했다. */
      selectionDom: onDocumentProperty("selection"),
      layerComps: onDocumentProperty("layerComps"),
      pathItems: onDocumentProperty("pathItems"),
    },
  };
}
