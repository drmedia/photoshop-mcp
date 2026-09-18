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
 * **Photoshop 27.8 / manifestVersion 4 에서는 알림이 전달되지 않는다.**
 * API 는 있고 등록도 성공하는데(문자열 배열·객체 배열 양쪽 모두) 실제 알림이
 * 하나도 오지 않았다. 플러그인 자신의 동작과 사용자 편집 모두 확인했다.
 * 원인을 찾지 못했고, 추측으로 코드를 더 넣지 않았다.
 *
 * 배선은 남겨둔다. 자기 상태를 보고하므로 해가 없고, 다른 환경이나 이후 버전에서
 * 전달이 되면 그대로 동작한다.
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

  /**
   * 인자 형태가 UXP 버전마다 다르다.
   *
   * 실기에서 `[{ event: "make" }]` 로 넘겼더니 **등록은 성공하는데 알림이 하나도
   * 오지 않았다.** 아무 이벤트도 매칭되지 않으면서 오류도 나지 않는다.
   *
   * 문서형인 문자열 배열을 먼저 쓰고, 거부하면 객체 형태로 물러난다.
   * 어느 쪽이 먹었는지 보고한다 — 다음 사람이 같은 데서 막히지 않도록.
   */
  const forms: { label: string; events: unknown }[] = [
    { label: "string[]", events: [...WATCHED] },
    { label: "{event}[]", events: WATCHED.map((event) => ({ event })) },
  ];

  let registered: string | null = null;
  let lastError: unknown = null;

  for (const form of forms) {
    try {
      const result = (
        action.addNotificationListener as unknown as (events: unknown, listener: unknown) => unknown
      )(form.events, listener);
      void Promise.resolve(result).catch(() => {
        // 비동기 거부는 아래 보고에서 다루지 않는다. 동기 성공만으로 등록으로 본다.
      });
      registered = form.label;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (registered === null) {
    send("photoshop.notifications.unavailable", {
      reason: lastError instanceof Error ? lastError.message : String(lastError),
      tried: forms.map((form) => form.label),
    });
    return () => {
      // 등록에 실패했으므로 해제할 것도 없다.
    };
  }

  // "started" 라고만 보내면 동작하는 것처럼 읽힌다. 실기에서는 등록이 성공해도
  // 알림이 하나도 오지 않았다. 등록과 전달은 별개라는 것을 이름과 내용에 담는다.
  send("photoshop.notifications.registered", {
    events: [...WATCHED],
    form: registered,
    delivery: "unverified",
    note:
      "등록은 성공했습니다. Photoshop 27.8 / manifestVersion 4 에서는 실제 알림이 " +
      "전달되지 않는 것을 확인했습니다. 이 이벤트 이후 photoshop.* 이 하나도 오지 " +
      "않으면 이 환경에서는 지원되지 않는 것입니다.",
  });

  return () => {
    try {
      const events = registered === "string[]" ? [...WATCHED] : WATCHED.map((event) => ({ event }));
      (
        action.removeNotificationListener as unknown as
          ((events: unknown, listener: unknown) => void) | undefined
      )?.(events, listener);
    } catch {
      // 해제 실패는 무시한다. 플러그인이 내려가는 중일 수 있다.
    }
  };
}
