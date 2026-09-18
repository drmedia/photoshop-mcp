import { action, app } from "photoshop";

/**
 * Photoshop 알림을 Bridge 로 흘린다. (ARCHITECTURE §21, ROADMAP §15)
 *
 * ## 이름을 짐작하지 않는다
 *
 * UXP 알림은 batchPlay 액션 이름으로 온다 — `make` · `delete` · `set` · `select`.
 * `layer.created` 같은 친절한 이름이 아니다. 같은 `make` 가 레이어일 수도 문서일
 * 수도 채널일 수도 있고, 그 구분은 descriptor 안에 있다.
 *
 * 확신할 수 있는 것만 해석하고 나머지는 **원본을 그대로 보낸다.**
 * 서버가 `photoshop.unknown` 으로 기록하므로 나중에 실제로 무엇이 오는지 볼 수 있다.
 *
 * 이 프로젝트는 `bitDepth` · `layer.kind` · `blendMode` 에서 같은 방식으로 세 번
 * 실제 버그를 잡았다. 그럴듯한 이름으로 덮으면 틀린 것을 알 수 없다.
 */

/** 구독할 액션. 너무 넓게 잡으면 사용자가 조금만 움직여도 쏟아진다. */
const WATCHED = [
  "open",
  "close",
  "make",
  "delete",
  "select",
  "set",
  "hide",
  "show",
  "duplicate",
  "move",
] as const;

/** descriptor 에서 대상 종류를 뽑는다. 확신할 수 없으면 `null`. */
function targetOf(descriptor: Record<string, unknown>): string | null {
  const target = descriptor["_target"];
  if (!Array.isArray(target) || target.length === 0) {
    return null;
  }
  const first = target[0] as { _ref?: unknown } | undefined;
  return typeof first?._ref === "string" ? first._ref : null;
}

/**
 * 액션과 대상을 이벤트 이름으로 바꾼다.
 *
 * 실기에서 확인한 조합만 매핑한다. 모르는 것은 `null` 을 돌려주고 호출자가
 * 원본을 그대로 보낸다.
 */
function nameFor(action_: string, target: string | null): string | null {
  if (action_ === "open") {
    return "photoshop.document.opened";
  }
  if (action_ === "close") {
    return "photoshop.document.closed";
  }
  if (target === "layer") {
    if (action_ === "make") {
      return "photoshop.layer.created";
    }
    if (action_ === "delete") {
      return "photoshop.layer.deleted";
    }
    if (action_ === "select") {
      return "photoshop.layer.selected";
    }
    if (action_ === "duplicate") {
      return "photoshop.layer.duplicated";
    }
  }
  if (target === "channel" && action_ === "set") {
    // 선택 영역 변경은 channel/selection 에 set 으로 온다.
    return "photoshop.selection.changed";
  }
  return null;
}

export interface NotificationSink {
  (event: string, payload: unknown): void;
}

/**
 * 알림 구독을 시작한다.
 *
 * 성공·실패를 **이벤트로 보고한다.** 조용히 실패하면 왜 아무 알림도 오지 않는지
 * 알 수 없다. 실기에서 실제로 그렇게 막혔다 — Bridge 를 보호하려고 오류를 삼켰더니
 * 진단이 불가능해졌다.
 *
 * @returns 해제 함수. 실패해도 아무것도 하지 않는 함수를 돌려준다 —
 *   알림은 부가 기능이고 Bridge 가 본체다. 여기서 죽으면 안 된다.
 */
export function startNotifications(send: NotificationSink): () => void {
  const api = (action as { addNotificationListener?: unknown }).addNotificationListener;
  if (typeof api !== "function") {
    send("photoshop.notifications.unavailable", {
      reason: "action.addNotificationListener 가 없습니다.",
      uxpApi: typeof api,
    });
    return () => {
      // 등록하지 않았으므로 해제할 것도 없다.
    };
  }

  const listener = (event: string, descriptor: Record<string, unknown>): void => {
    try {
      const target = targetOf(descriptor);
      const mapped = nameFor(event, target);

      // 해석했든 못 했든 원본을 함께 보낸다. 해석이 틀렸을 때 확인할 수 있어야 한다.
      send(mapped ?? event, {
        action: event,
        target,
        documentId: app.activeDocument?.id ?? null,
        descriptor,
      });
    } catch {
      // 알림 처리가 실패해도 Photoshop 동작을 막으면 안 된다.
    }
  };

  try {
    const result = action.addNotificationListener(
      WATCHED.map((event) => ({ event })),
      listener,
    );
    // Promise 를 돌려준다면 등록 실패도 비동기로 온다. 그것도 보고한다.
    void Promise.resolve(result).then(
      () => {
        send("photoshop.notifications.started", { events: [...WATCHED] });
      },
      (error: unknown) => {
        send("photoshop.notifications.unavailable", {
          reason: error instanceof Error ? error.message : String(error),
          phase: "async",
        });
      },
    );
  } catch (error) {
    send("photoshop.notifications.unavailable", {
      reason: error instanceof Error ? error.message : String(error),
      phase: "sync",
    });
    return () => {
      // 등록에 실패했으므로 해제할 것도 없다.
    };
  }

  return () => {
    try {
      action.removeNotificationListener?.(
        WATCHED.map((event) => ({ event })),
        listener,
      );
    } catch {
      // 해제 실패는 무시한다. 플러그인이 내려가는 중일 수 있다.
    }
  };
}
