import { z } from "zod";
import { ErrorCode, PhotoshopMcpError } from "./protocol/errors.js";

/**
 * Permission 모델. (ARCHITECTURE §22, ROADMAP §13)
 *
 * 모든 Tool 과 Command 는 Permission Level 을 **반드시** 선언한다.
 * 선택 필드로 두면 새로 추가한 Command 가 조용히 관대한 기본값을 갖는다.
 *
 * 강제 지점은 **Command Engine** 이다. Extension 은 Tool 을 거치지 않고
 * `commands.execute` 를 직접 호출하므로(ARCHITECTURE §3.2), Tool 에서만 막으면
 * 우회로가 생긴다. Tool 의 레벨은 `tools/list` 노출용 메타데이터이자
 * 빠른 실패용이며, 실제 차단은 Command 에서 한다.
 */

/**
 * Permission Level.
 *
 * - `read` — Photoshop 상태를 읽기만 한다. 문서를 바꾸지 않는다.
 * - `edit` — 문서를 바꾸지만 되돌릴 수 있다. 조정 레이어·마스크 등 비파괴 작업.
 * - `external` — Photoshop 밖의 자원에 닿는다. 파일 쓰기, 외부 프로그램 실행.
 * - `destructive` — 되돌릴 수 없거나 데이터를 잃을 수 있다. 삭제·병합·저장하지 않고 닫기.
 */
export const PermissionLevelSchema = z.enum(["read", "edit", "external", "destructive"]);

export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

/** 위험도 오름차순. 정책 비교와 표시 순서에 쓴다. */
export const PERMISSION_LEVELS = ["read", "edit", "external", "destructive"] as const;

/** 기본 허용 레벨. `external` 과 `destructive` 는 명시적으로 켜야 한다. */
export const DEFAULT_ALLOWED_LEVELS: readonly PermissionLevel[] = ["read", "edit"];

/**
 * Extension manifest 의 permission 문자열을 Level 로 바꾼다.
 *
 * manifest 는 `photoshop.read` 처럼 접두사를 쓴다. Extension 이 선언하는 것은
 * "Photoshop 에 대한" 권한이며, 나중에 다른 접두사가 생길 수 있기 때문이다.
 */
export function permissionToLevel(permission: string): PermissionLevel | null {
  const suffix = permission.startsWith("photoshop.") ? permission.slice("photoshop.".length) : null;
  const parsed = PermissionLevelSchema.safeParse(suffix);
  return parsed.success ? parsed.data : null;
}

/** 판정에 쓰인 맥락. 거부 메시지와 로그에 남긴다. */
export interface PermissionSubject {
  /** `tool` · `command` 중 무엇을 검사했는지. */
  kind: "tool" | "command";
  /** Tool 이름 또는 Command 타입. */
  name: string;
  /** Extension 을 통한 호출이면 그 namespace. */
  namespace?: string;
}

/**
 * Permission 정책.
 *
 * 대화형 승인을 하지 않는다. MCP 서버는 stdio 를 전송에 쓰므로 프롬프트를 띄울 수 없고,
 * MCP elicitation 은 클라이언트 지원이 고르지 않아 안전장치로 삼으면 클라이언트가
 * 무시할 때 보장이 사라진다. 대화형 승인은 MCP 클라이언트의 역할로 둔다.
 *
 * 대신 결정적인 설정 기반 정책을 쓴다. 같은 입력이면 항상 같은 판정이 나오므로
 * 테스트할 수 있다.
 */
export class PermissionPolicy {
  readonly #allowed: ReadonlySet<PermissionLevel>;

  constructor(allowed: Iterable<PermissionLevel> = DEFAULT_ALLOWED_LEVELS) {
    this.#allowed = new Set(allowed);
  }

  /** 허용된 레벨 목록. 위험도 오름차순. */
  get allowed(): PermissionLevel[] {
    return PERMISSION_LEVELS.filter((level) => this.#allowed.has(level));
  }

  isAllowed(level: PermissionLevel): boolean {
    return this.#allowed.has(level);
  }

  /**
   * 허용되지 않으면 던진다.
   *
   * @throws {PhotoshopMcpError} `PERMISSION_DENIED`
   */
  assert(level: PermissionLevel, subject: PermissionSubject): void {
    if (this.#allowed.has(level)) {
      return;
    }
    const where = subject.namespace === undefined ? "" : ` (Extension ${subject.namespace})`;
    throw new PhotoshopMcpError(
      ErrorCode.PERMISSION_DENIED,
      `${subject.name} 은 '${level}' 권한을 요구하지만 허용되어 있지 않습니다${where}. ` +
        `현재 허용: ${this.allowed.join(", ") || "(없음)"}`,
      {
        details: {
          required: level,
          allowed: this.allowed,
          kind: subject.kind,
          name: subject.name,
          ...(subject.namespace === undefined ? {} : { namespace: subject.namespace }),
        },
      },
    );
  }

  /** 허용 레벨을 좁힌 정책을 만든다. 넓힐 수는 없다. Extension 에 씌울 때 쓴다. */
  restrictTo(levels: Iterable<PermissionLevel>): PermissionPolicy {
    const requested = new Set(levels);
    return new PermissionPolicy(
      PERMISSION_LEVELS.filter((l) => this.#allowed.has(l) && requested.has(l)),
    );
  }
}

/**
 * 쉼표로 구분된 목록을 Level 집합으로 바꾼다.
 *
 * 알 수 없는 값은 조용히 버리지 않고 돌려준다. 오타 때문에 권한이 빠진 것을
 * 사용자가 알아야 한다.
 */
export function parsePermissionLevels(raw: string | undefined): {
  levels: PermissionLevel[];
  unknown: string[];
} {
  if (raw === undefined || raw.trim().length === 0) {
    return { levels: [...DEFAULT_ALLOWED_LEVELS], unknown: [] };
  }

  const levels = new Set<PermissionLevel>();
  const unknown: string[] = [];

  for (const token of raw.split(",")) {
    const value = token.trim().toLowerCase();
    if (value.length === 0) {
      continue;
    }
    if (value === "all") {
      for (const level of PERMISSION_LEVELS) {
        levels.add(level);
      }
      continue;
    }
    if (value === "none") {
      continue;
    }
    const parsed = PermissionLevelSchema.safeParse(value);
    if (parsed.success) {
      levels.add(parsed.data);
    } else {
      unknown.push(token.trim());
    }
  }

  return { levels: PERMISSION_LEVELS.filter((level) => levels.has(level)), unknown };
}
