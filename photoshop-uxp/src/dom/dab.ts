import { action } from "photoshop";
import { DispatchError } from "../dispatcher/dispatcher.js";
import { featherFor } from "./dab-geometry.js";

/**
 * 얼룩 칠하기의 공통 경로. (ROADMAP §17.31, §17.32)
 *
 * `dodge_burn.dab` 이 쓰던 것을 떼어냈다. `paint.dab` · `mask.dab` 이 같은 일을
 * 하고 **채우는 내용만 다르다** — 세 곳에 같은 루프를 두면 한 곳만 고쳐지는 날이 온다.
 *
 * 타원 선택 → 페더 → 채우기. `retouch.remove_spots`(§17.14)와 같은 길이며
 * descriptor 는 검증된 파라미터로만 조립한다. (ARCHITECTURE §23)
 */

export interface Dab {
  x: number;
  y: number;
  radius: number;
  /** 1–100. 채우기 불투명도로 간다. */
  strength: number;
  /** 0–100. 0 이면 가장 부드럽다. */
  hardness?: number;
}

export function px(value: number): { _unit: string; _value: number } {
  return { _unit: "pixelsUnit", _value: value };
}

export async function play(label: string, descriptor: Record<string, unknown>): Promise<void> {
  const results = await action.batchPlay([descriptor], {});
  const failure = results.find((result) => result["message"] !== undefined);
  if (failure !== undefined) {
    throw new DispatchError("COMMAND_FAILED", String(failure["message"]), {
      details: { step: label },
    });
  }
}

/**
 * 얼룩을 차례로 찍는다.
 *
 * `fillFor` 가 얼룩마다 채우기 descriptor 를 만든다 — 닷징은 흰색, 버닝은 검정,
 * 칠하기는 지정한 색이다.
 *
 * **선택을 `finally` 에서 해제한다.** 남기면 다음 Command 가 조용히 그 범위에만 걸린다.
 *
 * @returns 실제로 찍힌 수. 중간에 실패하면 요청 수와 다르다.
 */
export async function applyDabs(
  dabs: readonly Dab[],
  document: { width: number; height: number },
  fillFor: (dab: Dab) => Record<string, unknown>,
): Promise<number> {
  let applied = 0;
  try {
    for (const dab of dabs) {
      const left = dab.x - dab.radius;
      const top = dab.y - dab.radius;
      const right = dab.x + dab.radius;
      const bottom = dab.y + dab.radius;

      // 문서 밖이면 선택이 비고, 빈 선택에 채우기를 걸면 Photoshop 이 원인을 알 수
      // 없는 메시지로 거절한다. 여기서 이유를 말한다.
      if (right <= 0 || bottom <= 0 || left >= document.width || top >= document.height) {
        throw new DispatchError(
          "INVALID_PARAMETER",
          `얼룩 (${dab.x}, ${dab.y}) 반지름 ${dab.radius} 가 ` +
            `문서(${document.width}×${document.height}) 밖입니다.`,
          { recoverable: true, details: { dab, applied } },
        );
      }

      await play("Select dab", {
        _obj: "set",
        _target: [{ _ref: "channel", _property: "selection" }],
        to: {
          _obj: "ellipse",
          top: px(top),
          left: px(left),
          bottom: px(bottom),
          right: px(right),
        },
      });

      const feather = featherFor(dab.radius, dab.hardness ?? 0);
      if (feather > 0) {
        await play("Feather", { _obj: "feather", radius: px(feather) });
      }

      await play("Fill", fillFor(dab));
      applied += 1;
    }
  } finally {
    await play("Deselect", {
      _obj: "set",
      _target: [{ _ref: "channel", _property: "selection" }],
      to: { _enum: "ordinal", _value: "none" },
    }).catch(() => {
      // 이미 실패한 길이면 해제 실패까지 덮어쓰지 않는다.
    });
  }
  return applied;
}

/** 흰색·검정 채우기. 마스크에서 흰색은 보이는 쪽이다. */
export function monochromeFill(
  color: "white" | "black",
  strength: number,
): Record<string, unknown> {
  return {
    _obj: "fill",
    using: { _enum: "fillContents", _value: color },
    opacity: { _unit: "percentUnit", _value: strength },
    mode: { _enum: "blendMode", _value: "normal" },
  };
}
