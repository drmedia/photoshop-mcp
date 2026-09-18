import { z } from "zod";

/**
 * Capability 계약. (ARCHITECTURE §19, ROADMAP §12)
 *
 * Extension 은 특정 프로그램이 아니라 **기능**을 요청한다.
 *
 * ```typescript
 * ctx.capabilities.execute("gradientRemoval", { input: "a.tif", output: "b.tif" });
 * ```
 *
 * ## 안전 원칙
 *
 * batchPlay descriptor 규칙과 같다. (ARCHITECTURE §23.2)
 * LLM 이 임의의 batchPlay 를 실행할 수 없듯, **임의의 프로그램과 인자도 실행할 수 없다.**
 *
 * - 실행 파일 경로는 **설정에서만** 온다. 호출자가 정할 수 없다.
 * - 인자는 Provider 정의가 검증된 파라미터로 **조립한다.** 호출자가 argv 를 넘기는
 *   통로를 만들지 않는다.
 * - 프로세스는 shell 없이 실행한다. 인자 배열을 그대로 넘기므로 shell 주입이 없다.
 * - 입출력은 승인된 작업 폴더 안의 **파일 이름**으로만 지정한다. (ROADMAP §8.5 와 같은 규칙)
 */

/**
 * Capability 이름.
 *
 * 열거형으로 고정하지 않는다. 어떤 기능이 필요한지는 도메인(천체사진 · 인물 보정 등)마다
 * 다르고, Core 가 미리 알 수 없다. 이름 형식만 강제한다.
 */
export const CapabilityIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][A-Za-z0-9]*$/u, {
    message: "Capability 이름은 소문자로 시작하는 영숫자여야 합니다. 예: gradientRemoval",
  });

/** Provider 식별자. */
export const ProviderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, {
    message: "Provider id 는 소문자로 시작하고 소문자·숫자·하이픈만 쓸 수 있습니다.",
  });

/**
 * Provider 가 받는 파라미터 선언.
 *
 * 이 선언에 없는 값은 인자로 들어갈 수 없다. 자유 문자열을 그대로 argv 에 넣지 않는
 * 것이 요점이다 — 그렇게 하면 "임의 실행 금지" 가 무너진다.
 */
export const ParameterSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("enum"),
    /** 허용되는 값. 이 목록 밖의 값은 거부된다. */
    values: z.array(z.string().min(1)).min(1).max(32),
    default: z.string().optional(),
  }),
  z.object({
    type: z.literal("number"),
    min: z.number().optional(),
    max: z.number().optional(),
    /** 정수만 허용할지. */
    integer: z.boolean().optional(),
    default: z.number().optional(),
  }),
  z.object({
    type: z.literal("boolean"),
    default: z.boolean().optional(),
  }),
]);

export type ParameterSpec = z.infer<typeof ParameterSpecSchema>;

/** 인자 템플릿에서 쓸 수 있는 내장 자리표시자. */
export const BUILTIN_PLACEHOLDERS = ["input", "output"] as const;

/**
 * 추가 출력 선언.
 *
 * 출력이 하나뿐인 처리기가 많지만 그렇지 않은 것도 있다. StarNet2 는 별을 지운
 * 이미지와 **별만 남긴 이미지**를 함께 만든다.
 *
 * ```text
 * --input <in> --output <starless> --unscreen <stars>
 * ```
 *
 * `restore_stars` 워크플로에는 별 이미지가 있어야 하므로 출력 하나로는 부족하다.
 * 템플릿에서는 `{{output.stars}}` 처럼 참조한다.
 */
export const ExtraOutputSchema = z
  .object({
    /** 사람이 읽을 설명. 무엇이 나오는 파일인지. */
    description: z.string().min(1).max(200).optional(),
  })
  .strict();

export type ExtraOutput = z.infer<typeof ExtraOutputSchema>;

/**
 * Provider 설정. 설정 파일에서 읽는다.
 *
 * `args` 의 `{{name}}` 은 `input` · `output` 또는 `params` 에 선언한 이름이어야 한다.
 * 선언하지 않은 이름을 쓰면 설정 오류다 — 조용히 빈 문자열로 바꾸지 않는다.
 */
export const ProviderConfigSchema = z
  .object({
    id: ProviderIdSchema,
    capability: CapabilityIdSchema,
    /** 사람이 읽을 이름. 생략하면 `id` 를 쓴다. */
    label: z.string().min(1).max(200).optional(),
    /**
     * 실행 파일의 절대 경로.
     *
     * **설정에서만 온다.** 호출자가 바꿀 수 없다.
     */
    executable: z.string().min(1).max(1024),
    /**
     * 인자 템플릿. `{{name}}` 이 치환된다.
     *
     * 배열 그대로 프로세스에 넘긴다. shell 을 거치지 않으므로 주입이 없다.
     */
    args: z.array(z.string().max(1024)).max(64),
    /** 받을 파라미터 선언. */
    params: z.record(ParameterSpecSchema).optional(),
    /**
     * 주 출력 외에 함께 만들어지는 파일.
     *
     * 선언하면 호출자가 반드시 이름을 줘야 하고, 실행 후 실제로 만들어졌는지 확인한다.
     */
    outputs: z.record(ExtraOutputSchema).optional(),
    /** 실행 제한 시간. 생략하면 10분. 외부 처리기는 오래 걸린다. */
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(60 * 60 * 1000)
      .optional(),
    /** 우선순위. 같은 Capability 에 여러 Provider 가 있을 때 큰 값을 먼저 고른다. */
    priority: z.number().int().min(0).max(1000).optional(),
    /**
     * 처리기가 실제로 만드는 파일이 요청한 이름과 다를 때 붙는 꼬리.
     *
     * GraXpert 3.0.2 는 `-output out.tif` 를 줘도 `out.tif.fits` 를 만든다.
     * 출력 형식 옵션이 없어 우회할 수 없다.
     */
    outputSuffix: z.string().min(1).max(32).optional(),
    /**
     * 실제 파일을 요청한 형식으로 바꾼다.
     *
     * `fitsToTiff` — FITS 를 16비트 TIFF 로. Photoshop 은 FITS 를 못 읽는다.
     */
    convert: z.enum(["fitsToTiff"]).optional(),
  })
  .strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** 설정 파일 전체. */
export const CapabilityConfigSchema = z
  .object({
    providers: z.array(ProviderConfigSchema).max(64),
  })
  .strict();

export type CapabilityConfig = z.infer<typeof CapabilityConfigSchema>;

/** Provider 의 사용 가능 여부. */
export interface ProviderAvailability {
  id: string;
  capability: string;
  label: string;
  /** 실행 파일이 실제로 있고 실행 가능한지. */
  available: boolean;
  /** 사용할 수 없는 이유. 사용 가능하면 `null`. */
  reason: string | null;
  executable: string;
  priority: number;
  /** 받을 수 있는 파라미터 이름. */
  parameters: string[];
  /** 주 출력 외에 함께 만들어지는 파일의 이름. */
  extraOutputs: string[];
}

/** Capability 실행 요청. */
export interface CapabilityRequest {
  /** 승인된 작업 폴더 안의 입력 파일 이름. */
  input: string;
  /** 승인된 작업 폴더 안의 주 출력 파일 이름. 템플릿의 `{{output}}`. */
  output: string;
  /**
   * 추가 출력 파일 이름. Provider 가 `outputs` 로 선언한 것과 일치해야 한다.
   *
   * 템플릿에서는 `{{output.<이름>}}` 으로 참조한다.
   */
  outputs?: Record<string, string>;
  /** Provider 가 선언한 파라미터. 선언되지 않은 이름은 거부된다. */
  params?: Record<string, string | number | boolean>;
  /** 특정 Provider 를 지정한다. 생략하면 우선순위로 고른다. */
  provider?: string;
}

/** Capability 실행 결과. */
export interface CapabilityResult {
  capability: string;
  /** 실제로 사용된 Provider. */
  provider: string;
  /** 주 출력 파일의 실제 경로. */
  outputPath: string;
  /**
   * 모든 출력의 실제 경로. 주 출력은 `output` 키에 담긴다.
   *
   * 추가 출력이 없으면 `{ output: … }` 하나뿐이다.
   */
  outputPaths: Record<string, string>;
  /** 실행에 걸린 시간(ms). */
  durationMs: number;
  /** 형식을 바꾼 출력이 있으면 그 내용. 없으면 없다. */
  converted?: Record<string, string>;
}

/**
 * Extension 에 주어지는 Capability 표면.
 *
 * 등록·설정 변경은 노출하지 않는다. Extension 은 기능을 **요청**할 수 있을 뿐
 * Provider 를 추가하거나 실행 파일을 바꿀 수 없다. (ARCHITECTURE §17, §23)
 */
export interface ExtensionCapabilityRegistry {
  /** 사용 가능한 Capability 이름. */
  list(): string[];
  /** 그 Capability 를 실제로 쓸 수 있는지. */
  has(capability: string): boolean;
  /** Provider 들의 상태. 무엇이 왜 안 되는지 알 수 있어야 한다. */
  describe(capability?: string): ProviderAvailability[];
  /**
   * @param options.signal 취소 신호. 주면 외부 프로세스를 실제로 죽인다.
   *   Job 안에서 실행할 때 `JobContext.signal` 을 그대로 넘긴다.
   */
  execute(
    capability: string,
    request: CapabilityRequest,
    options?: { signal?: AbortSignal },
  ): Promise<CapabilityResult>;
}
