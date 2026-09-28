import { action, app } from "photoshop";
import type { PhotoshopDocument } from "photoshop";
import type { SaveResult } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
import { closeWorkDocument } from "./close-work-document.js";
import { resolveDuplicatedDocumentId } from "./duplicated-document.js";
import { toArray } from "./layers.js";
import { runModal } from "./modal.js";
import { fileSystem } from "./workspace.js";

/**
 * 16비트 TIFF 내보내기.
 *
 * 외부 천체사진 처리기(GraXpert · StarNet2 · BXT)의 교환 형식이다.
 * PNG 8비트로 내보내면 계조가 무너지므로 이 경로가 없으면 그 도구들을 쓸 수 없다.
 *
 * UXP DOM 에 `saveAs.tif` 가 없어 batchPlay 로 저장한다. (ARCHITECTURE §13)
 * descriptor 는 검증된 파라미터로 이 모듈이 조립한다. (ARCHITECTURE §23.2)
 *
 * 절차는 기존 CEP 패널이 검증해 둔 것과 같다.
 * **복제본**에서 작업한다 — 원본의 레이어 구조와 비트 심도를 건드리지 않기 위함이다.
 */

/** TIFF 저장 descriptor. 압축 없이, 레이어 없이 저장한다. */
export function tiffDescriptor(token: string): Record<string, unknown> {
  return {
    _obj: "save",
    as: {
      _obj: "TIFF",
      byteOrder: { _enum: "platform", _value: "IBMPC" },
      // 외부 처리기는 압축 해제 비용을 치를 이유가 없다. 임시 교환 파일이다.
      layerCompression: { _enum: "encoding", _value: "RLE" },
      embedProfiles: true,
      saveTransparency: false,
    },
    in: { _path: token, _kind: "local" },
    copy: true,
    lowerCase: true,
  };
}

export interface TiffExportParams {
  filename: string;
  /** 8 또는 16. 생략하면 문서의 현재 심도를 그대로 쓴다. */
  bitDepth?: 8 | 16;
}

/** 내보낸 TIFF 의 실제 비트 심도를 함께 돌려준다. */
export interface TiffExportResult extends SaveResult {
  bitDepth: number | null;
}

/** `bitsPerChannel` 문자열에서 숫자를 뽑는다. `mappings.ts` 와 같은 규칙. */
function depthOf(document: PhotoshopDocument): number | null {
  const match = /^bitDepth(\d+)$/u.exec(String(document.bitsPerChannel));
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

export async function exportTiff(
  file: unknown,
  path: string,
  params: TiffExportParams,
): Promise<TiffExportResult> {
  return runModal("Export TIFF", async () => {
    const original = requireActiveDocument();

    /* 복제본에서 작업한다. 평탄화와 비트 심도 변경이 원본에 남으면 안 된다.
     *
     * **`duplicate()` 가 돌려준 객체를 그대로 쓰지 않는다.** 실기에서 `id` 가
     * `undefined` 인 객체가 돌아와 `The 문서 with an id of undefined does not
     * exist.` 로 끝났다. 목록의 차이로 복제본을 찾는다 —
     * `duplicated-document.ts` 에 이유를 적었다. */
    const beforeIds = toArray<{ id: number }>(app.documents).map((entry) => entry.id);
    const returned = await original.duplicate();

    const open = toArray<PhotoshopDocument>(app.documents);
    const workId = resolveDuplicatedDocumentId(
      beforeIds,
      (returned as { id?: unknown } | null | undefined)?.id,
      open.map((entry) => entry.id),
    );
    const work = open.find((entry) => entry.id === workId);
    if (work === undefined) {
      /* 어느 것이 복제본인지 모른다. **원본일 수도 있는 문서를 평탄화하지
       * 않는다.** 복제본이 열린 채 남았을 수 있다는 것까지 말한다 — 조용히
       * 두면 사용자가 원본으로 착각하고 편집한다.
       *
       * **무엇을 보고 못 찾았는지 함께 담는다.** 이 실패는 실기에서만 나고
       * 그때 호출자가 볼 수 있는 것은 이 객체뿐이다. 값이 없으면 다음 사람이
       * 또 짐작으로 고친다 — 이 버그를 쫓으며 이미 한 번 그랬다. */
      throw new DispatchError(
        "COMMAND_FAILED",
        "복제본을 찾지 못해 TIFF 내보내기를 중단했습니다. " +
          "이름 없는 문서가 열려 있으면 저장하지 말고 닫으십시오.",
        {
          details: {
            filename: params.filename,
            format: "tiff",
            before: beforeIds,
            after: open.map((entry) => entry.id),
            returnedId: String((returned as { id?: unknown } | null | undefined)?.id),
            returnedType: returned === null || returned === undefined ? "없음" : typeof returned,
            // `app.documents` 가 배열 유사가 아니면 `toArray` 가 조용히 빈 배열을 준다.
            documentsLength: String((app.documents as unknown as { length?: unknown })?.length),
          },
        },
      );
    }

    try {
      await work.flatten();
      const alphaRemoved = await removeAlphaChannels(work);

      if (params.bitDepth !== undefined) {
        // UXP 는 문자열 상수를 쓴다. 숫자를 그대로 대입하면 조용히 무시된다.
        const target = params.bitDepth === 16 ? "bitDepth16" : "bitDepth8";
        if (String(work.bitsPerChannel) !== target) {
          work.bitsPerChannel = target as PhotoshopDocument["bitsPerChannel"];
        }
      }

      const bitDepth = depthOf(work);
      const token = fileSystem().createSessionToken(
        file as Parameters<ReturnType<typeof fileSystem>["createSessionToken"]>[0],
      );

      const results = await action.batchPlay([tiffDescriptor(token)], {});
      const failure = results.find((result) => result["message"] !== undefined);
      if (failure !== undefined) {
        throw new DispatchError("FILE_WRITE_FAILED", String(failure["message"]), {
          details: { filename: params.filename, format: "tiff" },
        });
      }

      /* **지운 알파 채널 수를 담는다.** 0 이어야 정상이 아니라, 문서에 알파가
       * 있었으면 지워졌다는 사실이 보여야 한다 — 안 지워졌는데 성공으로
       * 보고하면 외부 처리기가 거절할 때까지 모른다. */
      return {
        path,
        filename: params.filename,
        format: "tiff",
        bitDepth,
        ...(alphaRemoved === 0 ? {} : { alphaRemoved }),
      };
    } finally {
      /* 복제본은 반드시 저장하지 않고 닫는다. 남기면 사용자 문서 목록이
       * 더러워지고 다음 Command 의 activeDocument 가 복제본이 된다.
       *
       * **짐작해서 닫지 않는다.** `?? "no"` 로 두면 상수가 없는 호스트에서
       * 저장 여부를 묻는 창이 뜨고 플러그인이 멈춘다 — `try/catch` 는 도움이
       * 안 된다. 닫지 못하면 남겨 두고 알린다. (ROADMAP §30) */
      const closeFailure = await closeWorkDocument(work);
      if (closeFailure !== null) {
        /* 내보내기 결과는 이미 유효하므로 실패로 만들지 않는다. 다만
         * **조용히 넘기지도 않는다** — 남은 복제본은 다음 Command 의
         * `activeDocument` 가 되어 사용자가 원본으로 착각한다. */
        console.error(`[photoshop-mcp] ${closeFailure}`);
      }
    }
  });
}

/**
 * 알파 채널을 지운다.
 *
 * **평탄화는 알파 채널을 지우지 않는다.** 실기에서 문서에 알파 채널이 여섯 개
 * 쌓인 상태로 내보냈더니 TIFF 가 9채널이 되었고 StarXTerminator 가 거절했다.
 *
 * ```text
 * unsupported number of channels (9); only grayscale or RGB images are supported
 * ```
 *
 * 하늘 마스크가 4채널로 나왔던 것과 같은 유형인데, 그때는 **읽는 쪽만** 고쳤다.
 * 내보내는 쪽이 남아 있었다.
 *
 * 채널 배열은 구성 채널이 앞, 알파가 뒤다. RGB 는 앞의 셋이므로 그 뒤를 지운다.
 * **이름으로 고르지 않는다** — 구성 채널 이름이 언어에 따라 다르다.
 *
 * 복제본에서만 하므로 원본 문서의 채널은 그대로다.
 */
async function removeAlphaChannels(work: PhotoshopDocument): Promise<number> {
  const channels = (work as unknown as { channels?: unknown }).channels;
  if (!Array.isArray(channels) || channels.length <= 3) {
    return 0;
  }
  let removed = 0;
  // 뒤에서부터 지운다. 앞에서 지우면 인덱스가 밀린다.
  for (let i = channels.length - 1; i >= 3; i -= 1) {
    const channel = channels[i] as { remove?: () => void } | undefined;
    if (channel === undefined || typeof channel.remove !== "function") {
      continue;
    }
    try {
      channel.remove();
      removed += 1;
    } catch {
      // 지우지 못해도 내보내기는 계속한다. 결과의 개수로 드러난다.
    }
  }
  return removed;
}
