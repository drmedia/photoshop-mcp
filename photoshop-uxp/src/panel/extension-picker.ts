import {
  addRegisteredFolder,
  readRegistered,
  writeRegistered,
  type RegisteredExtension,
} from "../dom/extension-registry.js";

/**
 * Extension 등록 모달. (ROADMAP §18.3)
 *
 * **기본은 "아무 패널도 안 깔려 있다" 다.** 사용자가 설치한 것만 여기서 고른다.
 *
 * UXP 모달에서 실기로 배운 것을 그대로 따른다(§17.36).
 *
 * - 버튼은 `<sp-action-button size="s">` 다 — plain `<button>` 은 크기를 직접
 *   못 박아야 하고 그러다 글자가 잘린다
 * - 대화상자는 **텍스트 색을 물려주지 않는다** — 명시한다
 * - `<form method="dialog">` 제출로 **닫히지 않는다** — `dialog.close(값)` 을 건다
 * - UXP CSS 에 **`gap` 이 없다** — 간격은 margin 으로 준다
 *
 * **저장 버튼을 두지 않는다.** 추가는 `getFolder()` 제스처가 곧 의사 표시이고,
 * 제거는 그 자리에서 사라지는 것이 사용자가 기대하는 결과다. 한쪽만 즉시면
 * 같은 창에서 두 규칙이 섞여 무엇이 저장됐는지 알 수 없다.
 */

/* **색을 하드코딩하지 않는다.** Photoshop 은 테마가 넷(Darkest·Dark·Light·
 * Lightest)이라 `#e8e8e8` 은 어두운 둘에서만 맞는다. 호스트가 주는 변수를 쓴다.
 *
 * 대화상자는 패널과 달리 텍스트 색을 물려받지 않으므로 **명시는 해야 한다**.
 *
 * **`var()` 의 두 번째 인자로 예전 값을 남긴다.** 변수가 해석되지 않으면
 * 배경과 글자가 함께 비어 아무것도 안 보인다 — 대화상자 안에서 호스트 변수가
 * 닿는지 확인할 방법이 없다(`window.capture` 가 UXP 패널을 못 찍는다).
 * 최악이어도 예전과 같은 화면이 된다. */
const TEXT = "var(--uxp-host-text-color, #e8e8e8)";
const DIM = "var(--uxp-host-text-color-secondary, #b0b0b0)";
const LINE = "var(--uxp-host-border-color, #6a6a6a)";
const BACK = "var(--uxp-host-background-color, #323232)";

function row(entry: RegisteredExtension, index: number): string {
  const when = entry.addedAt === 0 ? "" : new Date(entry.addedAt).toLocaleDateString();
  return [
    // UXP 는 flex 의 `gap` 을 지원하지 않는다. 간격은 margin 으로 준다.
    '<div style="display:flex;align-items:center;padding:4px 0;',
    `border-bottom:1px solid ${LINE};color:${TEXT}">`,
    '<div style="flex:1;word-break:break-all;font-size:11px;margin-right:6px">',
    entry.path,
    when === "" ? "" : `<span style="opacity:.6"> · ${when}</span>`,
    "</div>",
    `<sp-action-button size="s" id="ep-drop-${String(index)}" style="cursor:pointer">제거</sp-action-button>`,
    "</div>",
  ].join("");
}

/**
 * 모달을 연다. **패널 버튼에서만 부를 수 있다** — `getFolder()` 가 사용자
 * 제스처를 요구하고, 그것이 곧 안전장치다(LLM 이 임의 폴더를 적재시킬 수 없다).
 */
export async function openExtensionPicker(): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.style.cssText = `width:520px;color:${TEXT};background:${BACK}`;

  let entries = readRegistered();

  const fail = (message: string): void => {
    const box = dialog.querySelector("#ep-error");
    if (box !== null) {
      box.textContent = message;
      (box as HTMLElement).style.display = "block";
    }
  };

  const clearError = (): void => {
    const box = dialog.querySelector("#ep-error");
    if (box !== null) {
      (box as HTMLElement).style.display = "none";
    }
  };

  const render = (): void => {
    const count = dialog.querySelector("#ep-count");
    if (count !== null) {
      count.textContent =
        entries.length === 0 ? "등록된 것이 없습니다" : `${String(entries.length)}개 등록`;
    }

    const list = dialog.querySelector("#ep-list");
    if (list === null) {
      return;
    }
    list.innerHTML =
      entries.length === 0
        ? '<div style="opacity:.7;padding:8px 0;font-size:11px">아래 <b>폴더 추가</b> 로 고르세요.</div>'
        : entries.map(row).join("");

    // 제거는 즉시 저장한다. `innerHTML` 을 다시 쓰므로 버튼도 매번 다시 건다.
    entries.forEach((_, index) => {
      list.querySelector(`#ep-drop-${String(index)}`)?.addEventListener("click", (event) => {
        event.preventDefault();
        entries = entries.filter((__, other) => other !== index);
        writeRegistered(entries);
        clearError();
        render();
      });
    });
  };

  dialog.innerHTML = [
    /* **목록이 남는 공간을 채운다.**
     *
     * 예전에는 `max-height:240px` 을 걸어 8개쯤부터 스크롤이 생겼는데,
     * 대화상자 아래는 크게 비어 있었다 — 실기 캡처에서 확인했다.
     * 패널과 같은 골격이다: 위아래는 고정, 가운데만 늘어나고 스크롤된다. */
    `<div style="height:100%;min-height:0;display:flex;flex-direction:column;`,
    `padding:10px;font-family:sans-serif;color:${TEXT}">`,
    '<div style="flex-shrink:0">',
    '<div style="font-size:13px;margin-bottom:2px">Extension 등록</div>',
    `<div style="font-size:11px;color:${DIM};margin-bottom:8px">`,
    "설치한 Extension 폴더를 고릅니다. <b>extension.json</b> 이 들어 있어야 합니다.",
    "</div>",
    '<div style="display:flex;align-items:center;margin-bottom:6px">',
    '<sp-action-button size="s" id="ep-add" style="margin-right:6px;cursor:pointer">폴더 추가…</sp-action-button>',
    '<div id="ep-count" style="flex:1;font-size:11px;margin-right:6px"></div>',
    '<sp-action-button size="s" id="ep-close" style="cursor:pointer">닫기</sp-action-button>',
    "</div>",
    "</div>",
    '<div id="ep-list" style="flex:1;min-height:0;overflow-y:auto"></div>',
    '<div style="flex-shrink:0">',
    // 오류는 눈에 띄어야 하지만 테마가 넷이다. 글자색은 변수로 둔다.
    `<div id="ep-error" style="margin-top:8px;padding:4px;background:#a33;`,
    `color:${TEXT};font-size:11px;word-break:break-all;display:none"></div>`,
    `<div style="margin-top:8px;font-size:11px;color:${DIM}">`,
    "바꾼 뒤에는 <b>MCP 서버를 다시 연결</b>해야 Tool 목록에 반영됩니다.",
    "</div>",
    "</div></div>",
  ].join("");

  dialog.querySelector("#ep-add")?.addEventListener("click", (event) => {
    event.preventDefault();
    void addRegisteredFolder()
      .then((result) => {
        entries = result.entries;
        if (result.duplicate) {
          fail("이미 등록된 폴더입니다.");
        } else {
          clearError();
        }
        render();
      })
      .catch((error: unknown) => {
        fail(error instanceof Error ? error.message : String(error));
      });
  });

  dialog.querySelector("#ep-close")?.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.close("close");
  });

  document.body.appendChild(dialog);
  render();
  try {
    await (dialog as unknown as { uxpShowModal: (o: unknown) => Promise<unknown> }).uxpShowModal({
      title: "Extension 등록",
      resize: "both",
      size: { width: 520, height: 380 },
    });
  } finally {
    dialog.remove();
  }
}
