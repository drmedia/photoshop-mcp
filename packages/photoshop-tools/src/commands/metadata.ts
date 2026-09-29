import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 촬영 정보. (CORE_API §5.12, ROADMAP §76)
 *
 * **픽셀이 "지금 어떤가" 라면 EXIF 는 "왜 그런가" 다.** `document.statistics`
 * 가 σ 를 주지만 그것이 ISO 6400 의 노이즈인지 ISO 200 의 것인지는 말하지
 * 않는다. 초점 거리를 모르면 별이 흐른 것인지 초점이 나간 것인지도 못 가른다.
 *
 * **위치와 사람 이름은 담지 않는다.** 촬영 정보를 물었을 뿐인데 GPS 좌표가
 * 대화에 올라가는 것이 기본값이면 안 된다 — 있는지만 알린다.
 * (`window.capture` 를 `external` 로 둔 것과 같은 판단)
 */

export const METADATA_GET = "METADATA_GET";

/** 받을 것이 없다. 활성 문서를 읽는다. `.strict()` 로 오타를 거른다. */
export const MetadataGetParamsSchema = z.object({}).strict();

export type MetadataGetParams = z.infer<typeof MetadataGetParamsSchema>;

export const MetadataGetResultSchema = z.object({
  document: z.object({ id: z.number().int(), name: z.string() }),
  camera: z.object({
    make: z.string().nullable(),
    model: z.string().nullable(),
    lens: z.string().nullable(),
  }),
  exposure: z.object({
    /** 사람이 읽는 형태. `"1/125s"` · `"30s"`. */
    exposureTime: z.string().nullable(),
    /** 같은 값을 초로. 길이 비교는 이쪽으로 한다. */
    exposureSeconds: z.number().nullable(),
    fNumber: z.number().nullable(),
    iso: z.number().int().nullable(),
    /** mm. 환산이 아니라 실제 값이다. */
    focalLength: z.number().nullable(),
    exposureBias: z.number().nullable(),
  }),
  /** **고치지 않고 그대로 낸다** — 시간대가 없을 수 있다. */
  capturedAt: z.string().nullable(),
  software: z.string().nullable(),
  /** **좌표는 담지 않는다.** 있는지만 말한다. */
  hasLocation: z.boolean(),
  /** XMP 전체의 길이. 여기 담지 않은 것이 얼마나 되는지 말한다. */
  xmpBytes: z.number().int().nonnegative(),
});

export type MetadataInfo = z.infer<typeof MetadataGetResultSchema>;

export const metadataGetCommand: CommandHandler<MetadataGetParams, MetadataInfo> = async (
  command,
  context,
) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = MetadataGetResultSchema.safeParse(raw);
  if (!parsed.success) {
    /* 형태가 다르면 짐작해서 채우지 않는다. 이 Tool 의 쓸모가 "무엇을 어떻게
     * 찍었는가" 를 정확히 말하는 것인데, 빈 값을 채우면 그 쓸모가 사라진다. */
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "촬영 정보가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return parsed.data;
};
