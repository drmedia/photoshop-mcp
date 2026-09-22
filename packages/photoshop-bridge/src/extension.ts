import { z } from "zod";
import type { ExtensionCapabilityRegistry } from "./capability.js";
import type { ExtensionEventBus } from "./event.js";
import type { ExtensionJobRegistry } from "./job.js";
import type { ToolDefinition } from "./tool.js";

/**
 * Extension 계약. (ARCHITECTURE §14~§17)
 *
 * Core 는 Extension 을 참조하지 않는다. 그런데 Extension 을 **적재하는** 쪽(Core)과
 * **구현하는** 쪽(Extension)이 같은 타입을 알아야 한다. 그래서 `ToolDefinition` 과
 * 같은 이유로 contracts 계층에 둔다.
 *
 * `@photoshop-mcp/extension-api` 가 이것을 재노출하며, Extension 작성자는 그 패키지만 쓴다.
 */

/**
 * Extension namespace.
 *
 * 소문자로 시작하고 소문자·숫자·하이픈만 쓴다. Tool 이름의 앞부분이 되므로
 * 점을 포함할 수 없다.
 */
export const NamespaceSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, {
    message: "namespace 는 소문자로 시작하고 소문자·숫자·하이픈만 쓸 수 있습니다.",
  });

/** Core 가 예약한 namespace. Extension 이 쓸 수 없다. (ARCHITECTURE §17) */
export const RESERVED_NAMESPACES = ["photoshop"] as const;

/**
 * Permission 선언. (ARCHITECTURE §22)
 *
 * **강제된다.** 선언 밖의 권한을 요구하는 Tool 은 등록 자체가 막히고,
 * Command 호출과 Capability 실행에도 같은 상한이 걸린다.
 * (`mcp-core/src/extensions/manager.ts` 의 `grantedLevels`)
 *
 * **선언하지 않으면 아무 권한도 없다.** 기본값을 주면 권한을 적지 않은
 * Extension 이 조용히 편집 권한을 얻는다.
 */
export const PermissionSchema = z.enum([
  "photoshop.read",
  "photoshop.edit",
  "photoshop.external",
  "photoshop.destructive",
]);

export type Permission = z.infer<typeof PermissionSchema>;

/** `extension.json`. (ARCHITECTURE §15) */
export const ExtensionManifestSchema = z
  .object({
    /** 역방향 도메인 표기 권장. 예: `com.example.milky-scape` */
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    /** semver 를 권장하지만 강제하지 않는다. */
    version: z.string().min(1).max(64),
    namespace: NamespaceSchema,
    /** 진입점. 패키지 루트 기준 상대 경로. */
    main: z.string().min(1).max(512),
    description: z.string().max(1000).optional(),
    requires: z
      .object({
        /** 요구하는 Core 버전 범위. 아직 검증하지 않는다. */
        photoshopMcp: z.string().min(1).max(64),
      })
      .optional(),
    /** 강제된다. 생략하면 아무 권한도 없다 — `PermissionSchema` 참조. */
    permissions: z.array(PermissionSchema).optional(),
  })
  .strict();

export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>;

/** 진단 로그. correlation ID 추적에 쓴다. (ARCHITECTURE §31) */
export interface Logger {
  debug(message: string, details?: unknown): void;
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

/**
 * Extension 에 주어지는 Core 접근 통로. (ARCHITECTURE §16)
 *
 * ROADMAP §9.3 의 `photoshop` 은 아직 정의되지 않은 구성 요소다. 대응하는 런타임이
 * 생길 때 추가한다. 동작하지 않는 껍데기를 두지 않는다.
 *
 * `capabilities` 는 Phase 8, `jobs` 는 Phase 10, `events` 는 Phase 11,
 * `resources` 는 Phase 12 에서 각각 런타임이 생겼을 때 추가했다.
 */
export interface ExtensionContext {
  /** 자신의 manifest. namespace 확인 등에 쓴다. */
  manifest: ExtensionManifest;
  /**
   * Tool 등록.
   *
   * 전체 `ToolRegistry` 가 아니라 등록에 필요한 것만 준다. 최소 권한 원칙이며,
   * Extension 이 다른 Tool 을 조회·해제·호출할 수 없게 한다.
   */
  tools: ExtensionToolRegistry;
  /**
   * Command 실행.
   *
   * Extension 은 MCP Tool 을 다시 호출하지 않고 이것을 쓴다. (ARCHITECTURE §3.2)
   * 타입은 Core 의 `CommandEngine` 이며, 순환을 피하려고 구조만 선언한다.
   */
  commands: ExtensionCommandEngine;
  /**
   * 외부 처리기. (ARCHITECTURE §19)
   *
   * Extension 은 특정 프로그램이 아니라 기능을 요청한다.
   * 등록·설정 변경은 노출하지 않는다 — 요청만 할 수 있다.
   *
   * 실행에는 `photoshop.external` 권한이 필요하다.
   */
  capabilities: ExtensionCapabilityRegistry;
  /**
   * 긴 작업. (ARCHITECTURE §25)
   *
   * MCP 요청은 60초 안에 끝나야 한다. 외부 처리기는 더 걸린다.
   * 오래 걸리는 Tool 은 여기에 등록하고 Job ID 를 즉시 돌려준다.
   *
   * 자신이 시작한 Job 만 조회할 수 있다.
   */
  jobs: ExtensionJobRegistry;
  /**
   * Photoshop 과 Command 의 변화. (ARCHITECTURE §21)
   *
   * 구독은 Extension 이 unload 될 때 자동으로 해제된다.
   * 발행은 노출하지 않는다 — 일어난 일을 들을 수 있을 뿐이다.
   */
  events: ExtensionEventBus;
  /**
   * MCP Resource. (ARCHITECTURE §20)
   *
   * Extension 은 자기 namespace 의 URI 만 등록할 수 있다 — `milky://state` 처럼.
   * Tool 의 namespace 규칙과 같은 이유다. unload 하면 함께 해제된다.
   */
  resources: ExtensionResourceRegistry;
  logger: Logger;
}

/**
 * Extension 이 쓰는 Resource 등록 표면.
 *
 * 읽기·구독은 노출하지 않는다. Extension 은 자기 리소스를 **제공**할 뿐,
 * 다른 Extension 이나 Core 의 리소스를 들여다볼 수 없다. (ARCHITECTURE §17)
 */
export interface ExtensionResourceRegistry {
  register(definition: {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
    read: () => Promise<unknown>;
  }): void;
  /** 이 리소스가 바뀌었다고 알린다. 구독한 클라이언트에게 전달된다. */
  touch(uri: string): void;
}

/**
 * Extension 이 쓰는 Tool 등록 표면.
 *
 * 자신의 namespace 로 시작하는 이름만 등록할 수 있다. Manager 가 강제한다.
 */
export interface ExtensionToolRegistry {
  register<TInput, TResult>(tool: ToolDefinition<TInput, TResult>): void;
  /** 이름이 이미 쓰이는지 확인한다. 중복 등록 전에 볼 수 있다. */
  has(name: string): boolean;
}

/**
 * Extension 이 쓰는 Command Engine 표면.
 *
 * `@photoshop-mcp/command-engine` 의 `CommandEngine` 이 이 모양을 만족한다.
 * contracts 계층이 command-engine 을 참조하면 순환이 생기므로 구조만 선언한다.
 */
export interface ExtensionCommandEngine {
  execute<TResult>(
    command: { type: string; documentId?: number; params: unknown },
    options?: { requestId?: string },
  ): Promise<TResult>;
}

/** Extension 진입점. (ARCHITECTURE §16) */
export interface PhotoshopMcpExtension {
  activate(context: ExtensionContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
