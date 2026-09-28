import type { CommandHandler } from "@photoshop-mcp/command-engine";
import { ErrorCode, PhotoshopMcpError } from "@photoshop-mcp/photoshop-bridge";
import { z } from "zod";

/**
 * 호스트 정보. (CORE_API §5 P1, §8)
 *
 * `capabilities.get` 과 `version.get` 이 여기로 흡수됐다 — 버전과 지원 기능을
 * 따로 물을 이유가 없다. 외부 처리기를 다루는 `capability.list` 와는 다른
 * 물건이고, 이름이 거의 같아 충돌했던 것을 §8 에서 정리했다.
 *
 * **담는 것은 이 플러그인이 실제로 쓰는 API 의 유무다.** 버전 문자열만
 * 돌려주면 "이 Photoshop 에서 무엇이 되는가" 에는 여전히 답하지 못한다.
 * 이 프로젝트는 그 질문을 네 번 실기에서 확인했다(§17.13 · §17.19 · §17.25 · §28).
 */

export const HOST_GET = "HOST_GET";

/** 받을 것이 없다. `.strict()` 로 오타를 거른다. */
export const HostGetParamsSchema = z.object({}).strict();

export type HostGetParams = z.infer<typeof HostGetParamsSchema>;

/**
 * 기능 유무.
 *
 * **모르면 `false` 가 아니라 `null` 이다.** `document.*` 는 활성 문서가 있어야
 * 확인할 수 있고, 문서가 없을 때 `false` 로 답하면 "이 Photoshop 에는 없다"
 * 는 틀린 사실을 말하게 된다. (`LayerInfo.isBackground` 와 같은 원칙)
 */
const HostFeaturesSchema = z.object({
  imagingGetPixels: z.boolean(),
  imagingGetLayerMask: z.boolean(),
  saveOptionsDoNotSave: z.boolean(),
  rasterizeEntireLayer: z.boolean(),
  notifications: z.boolean(),
  documentRotate: z.boolean().nullable(),
  documentHistogram: z.boolean().nullable(),
  selectionDom: z.boolean().nullable(),
  /**
   * **이 서버가 Tool 로 노출한 것이 아니다.** 호스트가 가졌는지를 말할 뿐이고,
   * 만들 수 있는지 미리 판단하는 근거다. 어제 `imaging.getLayerMask` 를
   * 필요해진 뒤에야 확인한 일이 있어서 미리 알 수 있게 담는다.
   */
  layerComps: z.boolean().nullable(),
  pathItems: z.boolean().nullable(),
});

export const HostInfoSchema = z.object({
  name: z.string().nullable(),
  version: z.string().nullable(),
  uxp: z.string().nullable(),
  /** 열려 있는 문서 수. `features` 의 `null` 이 왜 나왔는지 설명한다. */
  openDocuments: z.number().int().nonnegative(),
  features: HostFeaturesSchema,
});

/** 플러그인이 보내는 부분. `platform` 은 서버가 붙인다 — 아래 참조. */
export type HostInfoFromPlugin = z.infer<typeof HostInfoSchema>;

/**
 * 호출자가 받는 것.
 *
 * **`platform` 은 서버의 `process.platform` 이다.** UXP 가 플랫폼을 알려주는지
 * 확인되지 않아 짐작하지 않고 확실한 쪽을 쓴다. Bridge 가 localhost WebSocket
 * 이므로 서버와 Photoshop 은 같은 기계다 — §17.11 이 `window.capture` 를 서버가
 * 직접 찍게 한 근거와 같다.
 *
 * 값이 하나여야 어긋나지 않는다. Plugin 과 서버가 각자 보내면 다를 수 있고,
 * 그러면 "무엇이 되는지" 를 알려주는 Tool 이 거짓말을 한다.
 * (`layer.get_active` 의 `layer` 를 서버가 뽑는 것과 같은 규칙)
 */
export const HostGetResultSchema = HostInfoSchema.extend({
  platform: z.string(),
});

export type HostInfo = z.infer<typeof HostGetResultSchema>;

export const hostGetCommand: CommandHandler<HostGetParams, HostInfo> = async (command, context) => {
  const raw = await context.bridge.executeCommand<unknown>(command);
  const parsed = HostInfoSchema.safeParse(raw);
  if (!parsed.success) {
    /* 형태가 다르면 짐작해서 채우지 않는다. 이 Tool 의 쓸모가 "무엇이 되는지"
     * 를 정확히 말하는 것인데, 빈 값을 채워 돌려주면 그 쓸모가 사라진다. */
    throw new PhotoshopMcpError(ErrorCode.PROTOCOL_ERROR, "호스트 정보가 예상과 다릅니다.", {
      details: { issues: parsed.error.issues },
      cause: parsed.error,
    });
  }
  return { ...parsed.data, platform: process.platform };
};
