import { action, constants } from "photoshop";
import type { PhotoshopDocument } from "photoshop";
import type { SaveResult } from "@photoshop-mcp/photoshop-bridge";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { requireActiveDocument } from "./document.js";
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
function tiffDescriptor(token: string): Record<string, unknown> {
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

    // 복제본에서 작업한다. 평탄화와 비트 심도 변경이 원본에 남으면 안 된다.
    const work = await original.duplicate();
    try {
      await work.flatten();

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

      return { path, filename: params.filename, format: "tiff", bitDepth };
    } finally {
      // 복제본은 반드시 저장하지 않고 닫는다. 남기면 사용자 문서 목록이 더러워지고
      // 다음 Command 의 activeDocument 가 복제본이 된다.
      try {
        await work.close(constants.SaveOptions?.DONOTSAVECHANGES ?? "no");
      } catch {
        // 닫기에 실패해도 내보내기 결과는 유효하다. 사용자가 직접 닫으면 된다.
      }
    }
  });
}
