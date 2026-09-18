import { z } from "zod";

/**
 * 파일 접근 계약. (ROADMAP §8.5, §13)
 *
 * UXP 샌드박스는 임의 경로 쓰기를 막는다. 실기에서 확인한 내용:
 *
 * ```text
 * storage.createEntryWithUrl("file:///C:/Temp/a.png")
 *   → Could not find an entry of 'file:///C:/Temp'
 * batchPlay save 에 경로 문자열 전달
 *   → invalid file token used
 * ```
 *
 * 저장은 UXP 세션 토큰을 요구하고, 토큰은 storage API 로 얻은 entry 에서만 만들 수 있다.
 * 자동화와 맞는 유일한 방법은 **사용자가 폴더를 한 번 승인하고 그 토큰을 보관**하는 것이다.
 *
 * 승인은 플러그인 패널의 버튼으로만 할 수 있다. `getFolder()` 가 사용자 제스처를
 * 요구하므로 서버가 소켓으로 띄울 수 없다. 이것은 제약이자 안전장치다 —
 * LLM 은 저장 폴더를 고를 수 없고, 사람이 고른 폴더 안에서만 쓸 수 있다.
 */

/** 승인된 작업 폴더 상태. */
export const WorkspaceStatusSchema = z.object({
  /** 승인된 폴더가 있는지. */
  approved: z.boolean(),
  /** 승인된 폴더의 실제 경로. 승인 전이면 `null`. */
  path: z.string().nullable(),
});

export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

/**
 * 레이어를 유지하는 저장 형식. `save_as` 용.
 *
 * `psb` 는 2GB 를 넘거나 30000px 를 넘는 문서에 필요하다.
 */
export const LayeredFormatSchema = z.enum(["psd", "psb", "tiff"]);
export type LayeredFormat = z.infer<typeof LayeredFormatSchema>;

/** 합쳐서 내보내는 형식. `export` 용. */
export const FlatFormatSchema = z.enum(["png", "jpg"]);
export type FlatFormat = z.infer<typeof FlatFormatSchema>;

/**
 * 파일 이름.
 *
 * 경로 구분자와 `..` 를 허용하지 않는다. 승인된 폴더 **안**으로 가두기 위함이다.
 * 확장자는 형식에서 결정하므로 붙이지 않아도 된다. 붙이면 그대로 쓴다.
 */
export const FilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\\/:*?"<>|]+$/u, {
    message: '파일 이름에 \\ / : * ? " < > | 를 쓸 수 없습니다.',
  })
  .refine((value) => !value.split(".").includes(".."), {
    message: "파일 이름에 '..' 를 쓸 수 없습니다.",
  })
  .refine((value) => value !== "." && value !== "..", {
    message: "파일 이름이 '.' 또는 '..' 일 수 없습니다.",
  });

/** 형식별 확장자. `tiff` 는 Photoshop 관례대로 `.tif` 로 쓴다. */
const EXTENSION: Record<string, string> = {
  psd: "psd",
  psb: "psb",
  tiff: "tif",
  png: "png",
  jpg: "jpg",
};

/**
 * 파일 이름에 확장자를 맞춘다.
 *
 * 붙이지 않았으면 형식에 맞춰 붙이고, 이미 맞으면 그대로 둔다.
 * 다른 확장자를 붙였으면 **덧붙인다** — 사용자가 고른 이름을 바꿔치기하지 않는다.
 *
 * Plugin 과 Mock Bridge 가 같은 결과를 내야 하므로 contracts 계층에 둔다.
 * 양쪽에 따로 두었더니 곧바로 어긋날 수 있는 형태였다.
 */
export function withExtension(filename: string, format: string): string {
  const extension = EXTENSION[format] ?? format;
  const lower = filename.toLowerCase();
  // tiff 는 .tif 와 .tiff 를 모두 인정한다.
  const accepted = format === "tiff" ? ["tif", "tiff"] : [extension];
  return accepted.some((candidate) => lower.endsWith(`.${candidate}`))
    ? filename
    : `${filename}.${extension}`;
}

/** 저장 결과. */
export const SaveResultSchema = z.object({
  /** 저장된 파일의 실제 경로. */
  path: z.string(),
  /** 승인된 폴더 기준 파일 이름. */
  filename: z.string(),
  format: z.string(),
});

export type SaveResult = z.infer<typeof SaveResultSchema>;
