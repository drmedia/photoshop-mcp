import { action } from "photoshop";
import { xmp, type XmpMeta } from "uxp";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { cleanText, formatExposureTime, parseRational, round, toInteger } from "./exif-values.js";

/**
 * 촬영 정보. (ROADMAP §76)
 *
 * ## 왜 필요했는가
 *
 * **LLM 이 자기가 무엇을 보고 있는지 몰랐다.** `document.statistics` 로 σ 는
 * 재지만 그것이 ISO 6400 의 노이즈인지 ISO 200 의 노이즈인지 알 방법이
 * 없었고, 초점 거리를 모르면 별이 흐른 것인지 초점이 나간 것인지 가릴 수
 * 없었다. 픽셀은 "지금 어떤가" 이고 EXIF 는 "왜 그런가" 다.
 *
 * ## DOM 에 없다 — 레퍼런스가 그렇게 말한다
 *
 * Adobe `Document` 레퍼런스의 속성 목록에 `metadata` 가 없다. 그래서
 * batchPlay 인데, **`get` 은 읽기라 알림 캡처가 필요 없다**(§54 와 같은 길).
 * 키는 `XMPMetadataAsUTF8` 이다.
 *
 * ## 파싱은 UXP 의 XMP 모듈이 한다
 *
 * 정규식으로 XML 을 긁지 않는다. 같은 값이 속성으로도 자식 요소로도 오고
 * 배열은 `rdf:Alt` 로 감싸여 있어 **직접 긁으면 어떤 파일에서 조용히 빈
 * 값이 된다.** `require("uxp").xmp` 가 Adobe 의 XMP Core 를 그대로 준다.
 *
 * **Photoshop 25.0(UXP 7.2) 부터다.** manifest 의 최소 버전은 24.0 이라
 * 없을 수 있고, 그때는 지어내지 않고 실패한다.
 *
 * ## 실기에서 두 파일로 확인했다
 *
 * ```text
 * TIFF(Camera Raw 거친 것)  Z5_2 · 230s · f/2.2 · ISO 3200 · 35mm  · lens null
 * NEF(카메라에서 바로)      Z5_2 · 1/2s · f/8   · ISO 800  · 300mm · VR 200-500mm f/5.6E
 * ```
 *
 * **`aux:Lens` 하나로 렌즈가 나온다.** `exifEX:LensModel` 을 대안으로 함께
 * 넣어 봤지만 그것 없이 나와서 지웠다. TIFF 의 `lens` 가 `null` 인 것은
 * **그 파일에 없는 것**이다.
 *
 * ## 위치는 담지 않는다
 *
 * EXIF 에는 GPS 좌표가 들어 있다. 촬영 정보를 물었을 뿐인데 **집 좌표가
 * 대화에 올라가는 것**이 기본값이면 안 된다. 있는지만 `hasLocation` 으로
 * 알리고 값은 내지 않는다. 사람 이름(`dc:creator`)도 같은 이유로 뺐다.
 *
 * ## 아는 것만 낸다
 *
 * XMP 전체는 Camera Raw 설정과 편집 이력까지 담아 수십 KB 다. 그대로
 * 돌려주면 토큰만 먹고 위의 위치 문제도 되살아난다. **고른 것만 낸다** —
 * `raw` 를 두지 않는 자리다. 얼마나 더 있는지는 `xmpBytes` 가 말한다.
 */

export interface MetadataCamera {
  make: string | null;
  model: string | null;
  /** 렌즈 이름. Camera Raw 가 `aux:Lens` 에 넣는다. */
  lens: string | null;
}

export interface MetadataExposure {
  /** 사람이 읽는 형태. `"1/125s"` · `"30s"`. */
  exposureTime: string | null;
  /** 같은 값을 초로. 길이를 비교할 때 쓴다. */
  exposureSeconds: number | null;
  /** 조리개. `f/2.8` 의 2.8. */
  fNumber: number | null;
  iso: number | null;
  /** 초점 거리(mm). 환산이 아니라 실제 값이다. */
  focalLength: number | null;
  /** 노출 보정(EV). */
  exposureBias: number | null;
}

export interface MetadataInfo {
  /** 어느 문서를 읽었는지. 활성 문서가 바뀌는 프로젝트라 함께 담는다. */
  document: { id: number; name: string };
  camera: MetadataCamera;
  exposure: MetadataExposure;
  /** `exif:DateTimeOriginal`. **고치지 않고 그대로 낸다** — 시간대가 없을 수 있다. */
  capturedAt: string | null;
  /** `xmp:CreatorTool`. 어떤 프로그램을 거쳐 왔는지. */
  software: string | null;
  /** **좌표는 담지 않는다.** 있는지만 알린다. */
  hasLocation: boolean;
  /** XMP 전체의 길이. 여기 담지 않은 것이 얼마나 되는지 말한다. */
  xmpBytes: number;
}

const NS_EXIF = "http://ns.adobe.com/exif/1.0/";
const NS_TIFF = "http://ns.adobe.com/tiff/1.0/";
const NS_AUX = "http://ns.adobe.com/exif/1.0/aux/";
const NS_XMP = "http://ns.adobe.com/xap/1.0/";

/**
 * XMP Core 의 생성자. 없으면 `null`.
 *
 * **호스트가 25.0 미만이면 없다.** 있다고 치고 부르면 `undefined is not a
 * constructor` 가 나고, 그 오류로는 "이 Photoshop 에는 없다" 를 알 수 없다.
 */
function xmpMetaCtor(): (new (serialized: string) => XmpMeta) | null {
  const ctor = xmp?.XMPMeta;
  return typeof ctor === "function" ? ctor : null;
}

/** `getProperty` 는 없으면 `undefined` 를 주고 던지기도 한다. 둘 다 `null` 로. */
function read(meta: XmpMeta, namespace: string, path: string): string | null {
  try {
    const found = meta.getProperty(namespace, path);
    return found === undefined || found === null ? null : cleanText(found.value);
  } catch {
    return null;
  }
}

function exists(meta: XmpMeta, namespace: string, path: string): boolean {
  try {
    return meta.doesPropertyExist(namespace, path);
  } catch {
    return false;
  }
}

export async function metadataGet(): Promise<MetadataInfo> {
  const document = requireActiveDocument();

  let xmpText: string | null = null;
  try {
    const results = await action.batchPlay(
      [
        {
          _obj: "get",
          _target: [{ _property: "XMPMetadataAsUTF8" }, { _ref: "document", _id: document.id }],
        },
      ],
      {},
    );
    xmpText = cleanText(results[0]?.["XMPMetadataAsUTF8"]);
  } catch {
    /* 못 읽으면 아래에서 거절한다. 빈 값을 성공으로 내지 않는다. */
    xmpText = null;
  }

  if (xmpText === null) {
    throw new DispatchError(
      "COMMAND_FAILED",
      "이 문서에서 XMP 메타데이터를 읽지 못했습니다. 새로 만든 문서에는 촬영 정보가 없습니다.",
      { recoverable: true, details: { documentId: document.id } },
    );
  }

  const xmpBytes = xmpText.length;
  const XmpMetaCtor = xmpMetaCtor();
  if (XmpMetaCtor === null) {
    throw new DispatchError(
      "COMMAND_NOT_SUPPORTED",
      "이 Photoshop 에는 UXP XMP 모듈이 없습니다(25.0 이상이 필요합니다).",
      { recoverable: false, details: { xmpBytes } },
    );
  }

  let meta: XmpMeta;
  try {
    meta = new XmpMetaCtor(xmpText);
  } catch {
    throw new DispatchError("COMMAND_FAILED", "XMP 를 해석하지 못했습니다.", {
      recoverable: true,
      details: { xmpBytes },
    });
  }

  const exposureRaw = read(meta, NS_EXIF, "ExposureTime");
  /* **ISO 는 두 곳에 있다.** 옛 `exif:ISOSpeedRatings` 는 배열(`rdf:Seq`)이고
   * 새 `exifEX:PhotographicSensitivity` 는 값 하나다. 실기에서 어느 쪽이
   * 오는지 모르므로 둘 다 본다 — 짐작해서 하나만 보면 조용히 `null` 이 된다. */
  const iso = toInteger(read(meta, NS_EXIF, "ISOSpeedRatings[1]"));

  return {
    document: { id: document.id, name: document.name },
    camera: {
      make: read(meta, NS_TIFF, "Make"),
      model: read(meta, NS_TIFF, "Model"),
      lens: read(meta, NS_AUX, "Lens"),
    },
    exposure: {
      exposureTime: formatExposureTime(exposureRaw),
      exposureSeconds: round(parseRational(exposureRaw), 6),
      fNumber: round(parseRational(read(meta, NS_EXIF, "FNumber")), 2),
      iso,
      focalLength: round(parseRational(read(meta, NS_EXIF, "FocalLength")), 2),
      exposureBias: round(parseRational(read(meta, NS_EXIF, "ExposureBiasValue")), 3),
    },
    capturedAt: read(meta, NS_EXIF, "DateTimeOriginal"),
    software: read(meta, NS_XMP, "CreatorTool"),
    /* **있는지만 본다.** 값을 읽지 않으므로 좌표가 결과에 실릴 길이 없다. */
    hasLocation: exists(meta, NS_EXIF, "GPSLatitude") || exists(meta, NS_EXIF, "GPSLongitude"),
    xmpBytes,
  };
}
